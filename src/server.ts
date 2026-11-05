import express from 'express'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { agentAddress, formatNative, formatUsdc, isConfigured, readTreasury } from './chain.js'
import { config } from './config.js'
import { formatWars } from './money.js'
import { monthOf, isPaydayWindow, periodLabel, weekRange } from './period.js'
import { buildPlan, isRunning, listReceipts, runPayroll } from './payroll.js'
import { load, mutate, newId, type Db } from './store.js'

const here = dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json({ limit: '64kb' }))

const paidToWorkerThisMonth = (db: Db, workerId: string): number => {
  const month = monthOf(new Date().toISOString().slice(0, 10))
  return db.runs
    .filter((r) => r.mode === 'live' && monthOf(r.startedAt.slice(0, 10)) === month)
    .flatMap((r) => r.decisions)
    .filter((d) => d.workerId === workerId && d.action === 'pay' && d.status === 'confirmed')
    .reduce((sum, d) => sum + d.grossCentavos, 0)
}

app.get('/api/state', async (_req, res, next) => {
  try {
    const db = load()
    const plan = await buildPlan(db)
    const treasury = await readTreasury().catch(() => null)
    const month = monthOf(new Date().toISOString().slice(0, 10))
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
        walletShort: `${w.wallet.slice(0, 6)}…${w.wallet.slice(-4)}`,
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
      receipts: listReceipts(db).slice(0, 40),
      month: { key: month, paidCentavos: paidThisMonth, capCentavos: db.business.monthlyTotalCapCentavos },
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
    const plan = await buildPlan(load(), { approvedWorkerIds })
    res.json(plan)
  } catch (error) {
    next(error)
  }
})

app.post('/api/shifts', async (req, res) => {
  const { workerId, date, hours, note } = req.body ?? {}
  if (typeof workerId !== 'string' || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Datos incompletos: hacen falta trabajador y fecha.' })
  }
  const h = Number(hours)
  if (!Number.isFinite(h) || h <= 0 || h > 16) {
    return res.status(400).json({ error: 'Las horas tienen que estar entre 0 y 16.' })
  }
  try {
    const shift = await mutate((db) => {
      if (!db.workers.some((w) => w.id === workerId)) throw new Error('Ese trabajador no existe.')
      const created = { id: newId('sh'), workerId, date, hours: Math.round(h * 2) / 2, note: note || undefined }
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

app.post('/api/run', async (req, res) => {
  try {
    const approvedWorkerIds = Array.isArray(req.body?.approvedWorkerIds) ? req.body.approvedWorkerIds : []
    const run = await runPayroll({ trigger: 'owner', approvedWorkerIds })
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
      'Agente de nómina para PyMEs argentinas. Calcula el sueldo semanal desde las horas trabajadas, aplica topes y aprobaciones, y paga en wARS sobre Celo mainnet. Cada pago deja un comprobante con su transacción.',
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

app.use(express.static(join(here, '..', 'web')))
app.get('/', (_req, res) => res.sendFile(join(here, '..', 'web', 'index.html')))

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

app.listen(config.port, () => {
  const week = weekRange()
  console.log(`Sueldo en http://localhost:${config.port}`)
  console.log(`Semana ${periodLabel(week.start, week.end)} · agente ${agentAddress() ?? 'sin clave'}`)
  if (config.scheduleEnabled) setInterval(tick, 60_000)
})
