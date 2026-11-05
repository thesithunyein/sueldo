import { getAddress } from 'viem'
import { agentAddress, isConfigured, readTreasury, sendWars } from './chain.js'
import { decide } from './guardrails.js'
import { arsToWars } from './money.js'
import { monthOf, periodLabel, previousWeeks, weekRange } from './period.js'
import { load, mutate, newId, type Db, type Decision, type PayrollRun, type Shift } from './store.js'

export type Plan = {
  period: { start: string; end: string; label: string }
  decisions: Decision[]
  totals: {
    computedCentavos: number
    payCentavos: number
    holdCentavos: number
    refuseCentavos: number
    skipCentavos: number
    headcount: number
  }
  treasuryCentavos: number | null
  wallet: `0x${string}` | null
  canExecute: boolean
  blocked: string | null
}

const hoursInRange = (shifts: Shift[], workerId: string, start: string, end: string): number =>
  shifts.filter((s) => s.workerId === workerId && s.date >= start && s.date <= end).reduce((sum, s) => sum + s.hours, 0)

const confirmedPay = (run: PayrollRun, workerId: string): number =>
  run.decisions
    .filter((d) => d.workerId === workerId && d.action === 'pay' && d.status === 'confirmed')
    .reduce((sum, d) => sum + d.grossCentavos, 0)

const confirmedPayTotal = (run: PayrollRun): number =>
  run.decisions.filter((d) => d.action === 'pay' && d.status === 'confirmed').reduce((sum, d) => sum + d.grossCentavos, 0)

export const buildPlan = async (
  db: Db,
  opts: { approvedWorkerIds?: string[]; ref?: Date } = {},
): Promise<Plan> => {
  const ref = opts.ref ?? new Date()
  const week = weekRange(ref)
  const prior = previousWeeks(4, ref)
  const month = monthOf(week.start)
  const approved = new Set(opts.approvedWorkerIds ?? [])

  const liveRuns = db.runs.filter((r) => r.mode === 'live')
  const thisWeekRuns = liveRuns.filter((r) => r.periodStart === week.start)
  const monthRuns = liveRuns.filter((r) => monthOf(r.startedAt.slice(0, 10)) === month)

  const alreadyPaidBusinessCentavos = monthRuns.reduce((sum, r) => sum + confirmedPayTotal(r), 0)

  const treasury = await readTreasury().catch(() => null)
  const treasuryCentavos = treasury ? treasury.warsCentavos : null

  const decisions: Decision[] = []
  let runTotalCentavos = 0

  for (const worker of [...db.workers].sort((a, b) => a.name.localeCompare(b.name, 'es'))) {
    const hours = hoursInRange(db.shifts, worker.id, week.start, week.end)
    const grossCentavos = Math.round(hours * worker.hourlyRateCentavos)
    const paidThisWeek = thisWeekRuns.reduce((sum, r) => sum + confirmedPay(r, worker.id), 0)
    const paidThisMonth = monthRuns.reduce((sum, r) => sum + confirmedPay(r, worker.id), 0)
    const priorHours = hoursInRange(db.shifts, worker.id, prior.start, prior.end)

    const verdict = decide({
      business: db.business,
      worker,
      hours,
      grossCentavos,
      alreadyPaidWorkerCentavos: paidThisWeek,
      alreadyPaidBusinessCentavos,
      workerPaidThisMonthCentavos: paidThisMonth,
      runTotalCentavos,
      treasuryCentavos,
      trailingAverageHours: priorHours / 4,
      approved: approved.has(worker.id),
    })

    if (verdict.action === 'pay') runTotalCentavos += grossCentavos

    decisions.push({
      workerId: worker.id,
      workerName: worker.name,
      hours,
      grossCentavos,
      action: verdict.action,
      reasons: verdict.reasons,
      status: verdict.action === 'pay' ? 'pending' : undefined,
    })
  }

  const sum = (action: Decision['action']) =>
    decisions.filter((d) => d.action === action).reduce((s, d) => s + d.grossCentavos, 0)

  return {
    period: { ...week, label: periodLabel(week.start, week.end) },
    decisions,
    totals: {
      computedCentavos: decisions.reduce((s, d) => s + d.grossCentavos, 0),
      payCentavos: sum('pay'),
      holdCentavos: sum('hold'),
      refuseCentavos: sum('refuse'),
      skipCentavos: sum('skip'),
      headcount: decisions.filter((d) => d.action === 'pay').length,
    },
    treasuryCentavos,
    wallet: agentAddress(),
    canExecute: isConfigured() && decisions.some((d) => d.action === 'pay'),
    blocked: isConfigured() ? null : 'Falta la clave del agente (AGENT_KEY) para poder firmar.',
  }
}

const offRampUrl = (wallet: string, centavos: number): string => {
  const ars = (centavos / 100).toFixed(2)
  return `https://ramp.ripio.com/offramp?country=AR&chain=42220&token=WARS&amount=${ars}&address=${wallet}`
}

let inFlight = false
export const isRunning = (): boolean => inFlight

export const runPayroll = async (opts: {
  trigger: 'owner' | 'schedule'
  approvedWorkerIds?: string[]
}): Promise<PayrollRun> => {
  if (inFlight) throw new Error('Ya hay una nómina en curso.')
  if (!isConfigured()) throw new Error('Falta AGENT_KEY: el agente no puede firmar transacciones.')

  inFlight = true
  try {
    const db = load()
    const plan = await buildPlan(db, { approvedWorkerIds: opts.approvedWorkerIds })
    if (plan.totals.payCentavos === 0) {
      throw new Error(plan.totals.computedCentavos === 0 ? 'No hay horas cargadas en esta semana.' : 'Ningún pago pasó las reglas.')
    }

    const run: PayrollRun = {
      id: newId('run'),
      mode: 'live',
      periodStart: plan.period.start,
      periodEnd: plan.period.end,
      startedAt: new Date().toISOString(),
      decisions: plan.decisions.map((d) => (d.action === 'pay' ? { ...d, status: 'pending' } : d)),
      totals: { paidCentavos: 0, heldCentavos: plan.totals.holdCentavos, refusedCentavos: plan.totals.refuseCentavos },
      treasuryBeforeCentavos: plan.treasuryCentavos ?? 0,
      trigger: opts.trigger,
    }
    await mutate((d) => {
      d.runs.unshift(run)
    })

    if (plan.blocked) throw new Error(plan.blocked)

    const workerById = new Map(db.workers.map((w) => [w.id, w]))

    for (const decision of run.decisions) {
      if (decision.action !== 'pay') continue
      const worker = workerById.get(decision.workerId)
      if (!worker) continue

      try {
        const result = await sendWars(getAddress(worker.wallet), arsToWars(decision.grossCentavos))
        await mutate((d) => {
          const target = d.runs.find((r) => r.id === run.id)
          const row = target?.decisions.find((x) => x.workerId === decision.workerId)
          if (!target || !row) return
          row.txHash = result.hash
          row.status = 'confirmed'
          row.attribution = result.attribution
          row.offRampUrl = offRampUrl(worker.wallet, decision.grossCentavos)
          target.totals.paidCentavos += decision.grossCentavos
        })
        decision.txHash = result.hash
        decision.status = 'confirmed'
        decision.attribution = result.attribution
        decision.offRampUrl = offRampUrl(worker.wallet, decision.grossCentavos)
      } catch (error) {
        await mutate((d) => {
          const target = d.runs.find((r) => r.id === run.id)
          const row = target?.decisions.find((x) => x.workerId === decision.workerId)
          if (!row) return
          row.status = 'failed'
          row.reasons = [
            ...row.reasons,
            { code: 'X_ENVIO', message: 'No se pudo enviar el pago.', detail: (error as Error).message },
          ]
        })
        decision.status = 'failed'
      }
    }

    const finishedAt = new Date().toISOString()
    await mutate((d) => {
      const target = d.runs.find((r) => r.id === run.id)
      if (target) target.finishedAt = finishedAt
    })
    run.finishedAt = finishedAt
    return run
  } finally {
    inFlight = false
  }
}

export const listReceipts = (db: Db) =>
  db.runs
    .filter((r) => r.mode === 'live')
    .flatMap((run) =>
      run.decisions
        .filter((d) => d.action === 'pay')
        .map((d) => ({
          runId: run.id,
          workerName: d.workerName,
          workerId: d.workerId,
          hours: d.hours,
          amountCentavos: d.grossCentavos,
          period: periodLabel(run.periodStart, run.periodEnd),
          status: d.status ?? 'pending',
          txHash: d.txHash,
          offRampUrl: d.offRampUrl,
          attribution: d.attribution,
          at: run.finishedAt ?? run.startedAt,
        })),
    )
