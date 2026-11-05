import express from 'express'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAddress, isAddress, zeroAddress } from 'viem'
import { agentAddress, formatNative, formatUsdc, isConfigured, readTreasury } from './chain.js'
import { config } from './config.js'
import { formatWars, parseArsInput } from './money.js'
import { asLang, say, type Lang } from './lang.js'
import { artDate, monthOf, isPaydayWindow, periodLabel, weekRange } from './period.js'
import { buildPlan, isRunning, listReceipts, runPayroll } from './payroll.js'
import { load, mutate, newId, type Db, type Worker } from './store.js'

const here = dirname(fileURLToPath(import.meta.url))
const webDir = existsSync(join(here, '..', 'web')) ? join(here, '..', 'web') : join(process.cwd(), 'web')
const app = express()
app.use(express.json({ limit: '64kb' }))
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  next()
})

const paidToWorkerThisMonth = (db: Db, workerId: string): number => {
  const month = monthOf(artDate())
  return db.runs
    .filter((r) => r.mode === 'live' && monthOf(artDate(new Date(r.startedAt))) === month)
    .flatMap((r) => r.decisions)
    .filter((d) => d.workerId === workerId && d.action === 'pay' && d.status === 'confirmed')
    .reduce((sum, d) => sum + d.grossCentavos, 0)
}

const toCentavos = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.round((value + Number.EPSILON) * 100)
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      return parseArsInput(value.replace(/\$/g, '').replace(/\s/g, ''))
    } catch {
      return null
    }
  }
  return null
}

const cleanWallet = (value: unknown): `0x${string}` | 'invalid' | 'empty' => {
  if (value === undefined || value === null || String(value).trim() === '') return 'empty'
  const v = String(value).trim()
  if (!isAddress(v)) return 'invalid'
  return getAddress(v)
}

const csvCell = (value: string | number): string => {
  const s = String(value)
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const requestLang = (req: express.Request): Lang => asLang(req.get('x-lang') || req.query.lang)

app.get('/api/state', async (req, res, next) => {
  try {
    const lang = requestLang(req)
    const db = load()
    const plan = await buildPlan(db, { lang })
    const treasury = await readTreasury().catch(() => null)
    const month = monthOf(artDate())
    const paidThisMonth = db.runs
      .filter((r) => r.mode === 'live' && monthOf(r.startedAt.slice(0, 10)) === month)
      .flatMap((r) => r.decisions)
      .filter((d) => d.action === 'pay' && d.status === 'confirmed')
      .reduce((sum, d) => sum + d.grossCentavos, 0)

    res.json({
      business: db.business,
      week: { ...plan.period, ...weekRange() },
      workers: db.workers.map((w) => ({
        ...w,
        hasWallet: isAddress(w.wallet) && getAddress(w.wallet) !== zeroAddress,
        walletShort:
          isAddress(w.wallet) && getAddress(w.wallet) !== zeroAddress
            ? `${w.wallet.slice(0, 6)}…${w.wallet.slice(-4)}`
            : null,
        hoursThisWeek: db.shifts
          .filter((s) => s.workerId === w.id && s.date >= plan.period.start && s.date <= plan.period.end)
          .reduce((sum, s) => sum + s.hours, 0),
        paidThisMonthCentavos: paidToWorkerThisMonth(db, w.id),
      })),
      shifts: db.shifts
        .filter((s) => s.date >= plan.period.start && s.date <= plan.period.end)
        .sort((a, b) => b.date.localeCompare(a.date)),
      plan,
      treasury: treasury
        ? {
            connected: true,
            address: treasury.address,
            wars: formatWars(treasury.warsWei),
            arsCentavos: treasury.warsCentavos,
            usdc: formatUsdc(treasury.usdcWei),
            celo: formatNative(treasury.nativeWei),
          }
        : { connected: false, address: agentAddress(), wars: '0', arsCentavos: 0, usdc: '0', celo: '0' },
      receipts: listReceipts(db, lang).slice(0, 40),
      month: { key: month, paidCentavos: paidThisMonth, capCentavos: db.business.monthlyTotalCapCentavos },
      run: (() => {
        const weekRun = db.runs.find((r) => r.mode === 'live' && r.periodStart === plan.period.start)
        if (!weekRun) return null
        return {
          id: weekRun.id,
          running: isRunning(),
          finished: Boolean(weekRun.finishedAt),
          startedAt: weekRun.startedAt,
          totals: weekRun.totals,
          decisions: weekRun.decisions.map((d) => ({
            workerId: d.workerId,
            workerName: d.workerName,
            action: d.action,
            status: d.status ?? null,
            grossCentavos: d.grossCentavos,
            hours: d.hours,
            txHash: d.txHash ?? null,
            reasons: d.reasons,
          })),
        }
      })(),
      agent: {
        tag: config.attributionTag,
        erc8004Id: db.agent.erc8004Id ?? null,
        address: agentAddress(),
        configured: isConfigured(),
        running: isRunning(),
        schedule: config.scheduleEnabled ? 'viernes 18:00 (ART)' : null,
        paydayNow: isPaydayWindow(),
      },
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/plan', async (req, res, next) => {
  try {
    const approvedWorkerIds = Array.isArray(req.body?.approvedWorkerIds) ? req.body.approvedWorkerIds : []
    const plan = await buildPlan(load(), { approvedWorkerIds, lang: requestLang(req) })
    res.json(plan)
  } catch (error) {
    next(error)
  }
})

app.post('/api/shifts', async (req, res) => {
  const lang = requestLang(req)
  const { workerId, date, note } = req.body ?? {}
  const hours = req.body?.hours
  if (typeof workerId !== 'string' || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: say(lang, 'Add a person and a date.', 'Falta la persona o la fecha.') })
  }
  const h = typeof hours === 'number' ? hours : Number(String(hours ?? '').replace(',', '.'))
  if (!Number.isFinite(h) || h <= 0 || h > 16 || Math.abs(h * 2 - Math.round(h * 2)) > 1e-6) {
    return res.status(400).json({ error: say(lang, 'Use half hours, from 0.5 to 16.', 'Las horas van de media en media, entre 0,5 y 16.') })
  }
  const week = weekRange()
  if (date < week.start || date > week.end) {
    return res.status(400).json({
      error: say(
        lang,
        `Not this week (${periodLabel(week.start, week.end, lang)}). Pick a day in that range.`,
        `No es esta semana (${periodLabel(week.start, week.end, lang)}). Elegí un día de ese rango.`,
      ),
    })
  }
  const cleanNote = typeof note === 'string' ? note.trim().slice(0, 140) : ''
  try {
    const shift = await mutate((db) => {
      if (!db.workers.some((w) => w.id === workerId)) throw new Error(say(lang, 'That person is not on the team.', 'Esa persona no está en el equipo.'))
      const created = { id: newId('sh'), workerId, date, hours: Math.round(h * 2) / 2, note: cleanNote || undefined }
      db.shifts.push(created)
      return created
    })
    res.status(201).json(shift)
  } catch (error) {
    res.status(400).json({ error: (error as Error).message })
  }
})

app.delete('/api/shifts/:id', async (req, res) => {
  await mutate((db) => {
    db.shifts = db.shifts.filter((s) => s.id !== req.params.id)
  })
  res.status(204).end()
})

app.post('/api/business', async (req, res) => {
  const lang = requestLang(req)
  const body = req.body ?? {}
  const current = load()
  const creating = !current.business.name
  const name = body.name !== undefined ? String(body.name).trim().slice(0, 80) : current.business.name
  const owner = body.owner !== undefined ? String(body.owner).trim().slice(0, 80) : current.business.owner
  const city = body.city !== undefined ? String(body.city).trim().slice(0, 80) : current.business.city
  if (!name || !owner || !city) {
    return res.status(400).json({ error: say(lang, 'Add the shop name, your name, and the city.', 'Hacen falta el nombre del negocio, el tuyo y la ciudad.') })
  }
  let monthly = current.business.monthlyTotalCapCentavos
  let threshold = current.business.approvalThresholdCentavos
  let maxHours = current.business.maxHoursPerWeek
  if (body.monthlyCap !== undefined && String(body.monthlyCap).trim() !== '') {
    const v = toCentavos(body.monthlyCap)
    if (v === null || v <= 0) {
      return res.status(400).json({ error: say(lang, 'Monthly limit was not a number. Try 180000.', 'El tope del mes no es un número. Probá 180000.') })
    }
    monthly = v
  }
  if (body.approvalThreshold !== undefined && String(body.approvalThreshold).trim() !== '') {
    const v = toCentavos(body.approvalThreshold)
    if (v === null || v < 0) {
      return res.status(400).json({ error: say(lang, 'That limit was not a number. A bigger payment waits for you.', 'Ese límite no es un número. Un pago más grande espera tu OK.') })
    }
    threshold = v
  }
  if (body.maxHoursPerWeek !== undefined && String(body.maxHoursPerWeek).trim() !== '') {
    const h = Number(body.maxHoursPerWeek)
    if (!Number.isInteger(h) || h < 1 || h > 80) {
      return res.status(400).json({ error: say(lang, 'Hour limit must be a whole number from 1 to 80.', 'El tope de horas tiene que ser un entero entre 1 y 80.') })
    }
    maxHours = h
  }
  const business = await mutate((d) => {
    d.business = {
      ...d.business,
      name,
      owner,
      city,
      monthlyTotalCapCentavos: monthly,
      approvalThresholdCentavos: threshold,
      maxHoursPerWeek: maxHours,
      pilot: false,
    }
    return d.business
  })
  res.status(creating ? 201 : 200).json(business)
})

const readWorkerBody = (body: Record<string, unknown>, lang: Lang, prev?: Worker) => {
  const name = body.name !== undefined ? String(body.name).trim().slice(0, 80) : (prev?.name ?? '')
  const role = body.role !== undefined ? String(body.role).trim().slice(0, 80) : (prev?.role ?? '')
  const rate = body.hourlyRate !== undefined && String(body.hourlyRate).trim() !== '' ? toCentavos(body.hourlyRate) : (prev?.hourlyRateCentavos ?? null)
  const cap = body.monthlyCap !== undefined && String(body.monthlyCap).trim() !== '' ? toCentavos(body.monthlyCap) : (prev?.monthlyCapCentavos ?? null)
  const walletRaw = body.wallet !== undefined ? cleanWallet(body.wallet) : prev ? (getAddress(prev.wallet) === zeroAddress ? 'empty' : prev.wallet) : 'empty'
  if (!name) return { error: say(lang, 'Add a name.', 'Falta el nombre.') }
  if (!role) return { error: say(lang, 'Add a job. For example, baker.', 'Falta el trabajo. Por ejemplo, panadero.') }
  if (rate === null || rate <= 0) return { error: say(lang, 'Pay per hour was not a number. Try 6800.', 'El valor por hora no es un número. Probá 6800.') }
  if (cap === null || cap <= 0) return { error: say(lang, 'Monthly limit was not a number. Try 400000.', 'El tope del mes no es un número. Probá 400000.') }
  if (walletRaw === 'invalid') {
    return { error: say(lang, 'That pay account is not valid. Paste it again, or leave it empty.', 'Esa cuenta no sirve. Pegala de nuevo o dejala vacía.') }
  }
  return {
    name,
    role,
    hourlyRateCentavos: rate,
    monthlyCapCentavos: cap,
    wallet: (walletRaw === 'empty' ? zeroAddress : walletRaw) as `0x${string}`,
  }
}

app.post('/api/workers', async (req, res) => {
  const parsed = readWorkerBody(req.body ?? {}, requestLang(req))
  if ('error' in parsed) return res.status(400).json(parsed)
  const worker = await mutate((db) => {
    const created: Worker = { id: newId('w'), ...parsed, active: true }
    db.workers.push(created)
    return created
  })
  res.status(201).json(worker)
})

app.patch('/api/workers/:id', async (req, res) => {
  const db = load()
  const prev = db.workers.find((w) => w.id === req.params.id)
  if (!prev) return res.status(404).json({ error: say(requestLang(req), 'That person is not on the team.', 'Esa persona no está en el equipo.') })
  const parsed = readWorkerBody(req.body ?? {}, requestLang(req), prev)
  if ('error' in parsed) return res.status(400).json(parsed)
  const worker = await mutate((d) => {
    const row = d.workers.find((w) => w.id === req.params.id)
    if (!row) throw new Error(say(requestLang(req), 'That person is not on the team.', 'Esa persona no está en el equipo.'))
    Object.assign(row, parsed)
    return row
  })
  res.json(worker)
})

app.delete('/api/workers/:id', async (req, res) => {
  const id = req.params.id
  await mutate((db) => {
    db.workers = db.workers.filter((w) => w.id !== id)
    db.shifts = db.shifts.filter((s) => s.workerId !== id)
  })
  res.status(204).end()
})

app.get('/api/export.csv', (req, res) => {
  const lang = requestLang(req)
  const db = load()
  const monthKey =
    typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : monthOf(artDate())
  const header = ['person', 'role', 'hours', 'amount', 'period', 'date', 'status', 'transaction']
  const lines = [header.join(';')]
  const statusLabel: Record<string, string> = { confirmed: 'paid', failed: 'failed', pending: 'pending', sent: 'sent' }
  for (const run of db.runs) {
    if (run.mode !== 'live' || monthOf(artDate(new Date(run.startedAt))) !== monthKey) continue
    for (const d of run.decisions) {
      if (d.action !== 'pay') continue
      const worker = db.workers.find((w) => w.id === d.workerId)
      const amount = (d.grossCentavos / 100).toFixed(2)
      lines.push(
        [
          d.workerName,
          worker?.role ?? '',
          String(d.hours),
          amount,
          periodLabel(run.periodStart, run.periodEnd, lang),
          artDate(new Date(run.startedAt)),
          statusLabel[d.status ?? 'pending'] ?? d.status ?? '',
          d.paidHow === 'cash' ? 'cash' : (d.txHash ?? ''),
        ]
          .map(csvCell)
          .join(';'),
      )
    }
  }
  res.setHeader('content-type', 'text/csv; charset=utf-8')
  res.setHeader('content-disposition', `attachment; filename="payroll-${monthKey}.csv"`)
  res.send(`\uFEFF${lines.join('\n')}\n`)
})

app.post('/api/run', async (req, res) => {
  try {
    const approvedWorkerIds = Array.isArray(req.body?.approvedWorkerIds) ? req.body.approvedWorkerIds : []
    const run = await runPayroll({ trigger: 'owner', approvedWorkerIds, lang: requestLang(req) })
    res.json(run)
  } catch (error) {
    res.status(400).json({ error: (error as Error).message })
  }
})

app.get('/api/agent.json', (_req, res) => {
  const db = load()
  const base = process.env.PUBLIC_URL ?? `http://localhost:${config.port}`
  res.json({
    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
    name: 'Sueldo',
    description:
      'Payroll agent for small businesses. It computes the weekly wage from hours worked, applies caps and approvals, and pays in wARS on Celo mainnet. Each payment leaves a receipt with its transaction.',
    image: `${base}/icon.svg`,
    services: [{ name: 'web', endpoint: base, version: '1.0.0' }],
    active: true,
    x402Support: false,
    registrations: db.agent.erc8004Id ? [{ agentId: Number(db.agent.erc8004Id), agentRegistry: 'eip155:42220:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' }] : [],
    supportedTrust: ['reputation'],
  })
})

app.get('/health', (_req, res) => res.json({ ok: true }))
app.get('/api/explorer', (_req, res) => res.json({ tx: 'https://celoscan.io/tx/' }))

app.use(express.static(webDir, { index: false }))
app.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache')
  res.sendFile(join(webDir, 'index.html'))
})
app.get('/app', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache')
  res.sendFile(join(webDir, 'app.html'))
})
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' })
  res.status(404).sendFile(join(webDir, '404.html'))
})

app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[sueldo]', error)
  res.status(500).json({ error: error.message })
})

const tick = async () => {
  if (!config.scheduleEnabled || !isConfigured() || isRunning() || !isPaydayWindow()) return
  const db = load()
  const week = weekRange()
  if (db.runs.some((r) => r.mode === 'live' && r.periodStart === week.start)) return
  try {
    const run = await runPayroll({ trigger: 'schedule' })
    console.log(`[sueldo] nómina automática ${run.id} · ${run.totals.paidCentavos / 100} ARS pagados`)
  } catch (error) {
    console.error('[sueldo] la nómina automática falló:', (error as Error).message)
  }
}

export default app

if (!process.env.VERCEL) {
  app.listen(config.port, '0.0.0.0', () => {
    const week = weekRange()
    console.log(`Sueldo en http://localhost:${config.port}`)
    console.log(`Semana ${periodLabel(week.start, week.end)} · agente ${agentAddress() ?? 'sin clave'}`)
    if (config.scheduleEnabled) setInterval(tick, 60_000)
  })
}
