import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { arsToWars, formatArs, parseArsInput, warsToArs } from '../src/money.js'
import { artDate, previousWeeks, weekRange } from '../src/period.js'

describe('money', () => {
  it('maps one peso to one wARS', () => {
    assert.equal(arsToWars(100), 10n ** 18n)
    assert.equal(arsToWars(1), 10n ** 16n)
  })

  it('round-trips through wei', () => {
    assert.equal(warsToArs(arsToWars(123_456)), 123_456)
  })

  it('formats pesos the way an Argentine reads them', () => {
    assert.match(formatArs(1_234_56), /1\.234,56/)
  })

  it('parses both "1500" and "1.500,50"', () => {
    assert.equal(parseArsInput('1500'), 150_000)
    assert.equal(parseArsInput('1.500,50'), 150_050)
  })
})

describe('period', () => {
  it('returns Monday to Sunday for a Wednesday', () => {
    const { start, end } = weekRange(new Date('2026-11-04T15:00:00.000Z'))
    assert.equal(start, '2026-11-02')
    assert.equal(end, '2026-11-08')
  })

  it('uses Argentina time, not UTC', () => {
    assert.equal(artDate(new Date('2026-11-05T02:30:00.000Z')), '2026-11-04')
  })

  it('looks back four whole weeks', () => {
    const { start, end } = previousWeeks(4, new Date('2026-11-04T15:00:00.000Z'))
    assert.equal(start, '2026-10-05')
    assert.equal(end, '2026-11-01')
  })
})
