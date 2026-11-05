import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decide, type GuardInput } from '../src/guardrails.js'
import type { Worker } from '../src/store.js'

const worker: Worker = {
  id: 'w1',
  name: 'Lucía',
  role: 'Ayudante',
  hourlyRateCentavos: 750_000,
  monthlyCapCentavos: 1_800_000_00,
  wallet: '0x1111111111111111111111111111111111111111',
  active: true,
}

const base = (over: Partial<GuardInput> = {}): GuardInput => ({
  business: { monthlyTotalCapCentavos: 7_000_000_00, approvalThresholdCentavos: 400_000_00, maxHoursPerWeek: 48 },
  worker,
  hours: 8,
  grossCentavos: 8 * worker.hourlyRateCentavos,
  alreadyPaidWorkerCentavos: 0,
  alreadyPaidBusinessCentavos: 0,
  workerPaidThisMonthCentavos: 0,
  runTotalCentavos: 0,
  treasuryCentavos: 5_000_000_00,
  trailingAverageHours: 20,
  approved: false,
  ...over,
})

describe('decide', () => {
  it('pays a clean line', () => {
    assert.equal(decide(base()).action, 'pay')
  })

  it('skips a worker with no hours', () => {
    const v = decide(base({ hours: 0, grossCentavos: 0 }))
    assert.equal(v.action, 'skip')
    assert.equal(v.reasons[0].code, 'W_SIN_HORAS')
  })

  it('skips an inactive worker', () => {
    assert.equal(decide(base({ worker: { ...worker, active: false } })).action, 'skip')
  })

  it('refuses a second payment in the same week', () => {
    const v = decide(base({ alreadyPaidWorkerCentavos: 60_000_00 }))
    assert.equal(v.action, 'refuse')
    assert.ok(v.reasons.some((r) => r.code === 'G_DUPLICADO'))
  })

  it('refuses past the worker monthly cap', () => {
    const v = decide(base({ workerPaidThisMonthCentavos: worker.monthlyCapCentavos - 100 }))
    assert.equal(v.action, 'refuse')
    assert.ok(v.reasons.some((r) => r.code === 'G_TOPE_TRABAJADOR'))
  })

  it('refuses past the business monthly cap', () => {
    const v = decide(base({ alreadyPaidBusinessCentavos: 6_999_000_00 }))
    assert.equal(v.action, 'refuse')
    assert.ok(v.reasons.some((r) => r.code === 'G_TOPE_NEGOCIO'))
  })

  it('refuses when the treasury cannot cover the run', () => {
    const v = decide(base({ treasuryCentavos: 10_000_00 }))
    assert.equal(v.action, 'refuse')
    assert.ok(v.reasons.some((r) => r.code === 'G_FONDOS'))
  })

  it('counts what the run already committed against the treasury', () => {
    const v = decide(base({ treasuryCentavos: 70_000_00, runTotalCentavos: 60_000_00 }))
    assert.equal(v.action, 'refuse')
  })

  it('refuses an impossible week of hours', () => {
    const v = decide(base({ hours: 60, grossCentavos: 60 * worker.hourlyRateCentavos }))
    assert.equal(v.action, 'refuse')
    assert.ok(v.reasons.some((r) => r.code === 'G_HORAS'))
  })

  it('refuses a zero wallet', () => {
    const v = decide(base({ worker: { ...worker, wallet: '0x0000000000000000000000000000000000000000' } }))
    assert.equal(v.action, 'refuse')
    assert.ok(v.reasons.some((r) => r.code === 'G_BILLETERA'))
  })

  it('holds a payment above the approval threshold', () => {
    const v = decide(base({ business: { monthlyTotalCapCentavos: 7_000_000_00, approvalThresholdCentavos: 10_000_00, maxHoursPerWeek: 48 } }))
    assert.equal(v.action, 'hold')
    assert.equal(v.reasons[0].code, 'G_APROBACION')
  })

  it('pays the same line once the owner approves it', () => {
    const business = { monthlyTotalCapCentavos: 7_000_000_00, approvalThresholdCentavos: 10_000_00, maxHoursPerWeek: 48 }
    assert.equal(decide(base({ business, approved: true })).action, 'pay')
  })

  it('holds hours that jump above the four-week average', () => {
    const v = decide(base({ hours: 30, grossCentavos: 30 * worker.hourlyRateCentavos, trailingAverageHours: 20 }))
    assert.equal(v.action, 'hold')
    assert.ok(v.reasons.some((r) => r.code === 'G_ANOMALIA'))
  })

  it('does not flag an anomaly without history', () => {
    assert.equal(decide(base({ trailingAverageHours: 0 })).action, 'pay')
  })

  it('lets a refusal win over a hold', () => {
    const v = decide(base({ alreadyPaidWorkerCentavos: 1, business: { monthlyTotalCapCentavos: 7_000_000_00, approvalThresholdCentavos: 1, maxHoursPerWeek: 48 } }))
    assert.equal(v.action, 'refuse')
    assert.ok(v.reasons.some((r) => r.code === 'G_APROBACION'), 'el motivo de la retención igual se muestra')
  })
})
