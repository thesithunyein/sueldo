import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.js'

export type Business = {
  name: string
  cuit: string
  owner: string
  city: string
  monthlyTotalCapCentavos: number
  approvalThresholdCentavos: number
  maxHoursPerWeek: number
  pilot: boolean
}

export type Worker = {
  id: string
  name: string
  role: string
  hourlyRateCentavos: number
  monthlyCapCentavos: number
  wallet: `0x${string}`
  active: boolean
}

export type Shift = {
  id: string
  workerId: string
  date: string // YYYY-MM-DD
  hours: number
  note?: string
}

export type Reason = { code: string; message: string; detail?: string }

export type Decision = {
  workerId: string
  workerName: string
  hours: number
  grossCentavos: number
  action: 'pay' | 'hold' | 'refuse' | 'skip'
  reasons: Reason[]
  txHash?: `0x${string}`
  status?: 'pending' | 'sent' | 'confirmed' | 'failed'
  offRampUrl?: string
  attribution?: { codes: string[]; schemaId: number } | null
}

export type PayrollRun = {
  id: string
  mode: 'dry' | 'live'
  periodStart: string
  periodEnd: string
  startedAt: string
  finishedAt?: string
  decisions: Decision[]
  totals: { paidCentavos: number; heldCentavos: number; refusedCentavos: number }
  treasuryBeforeCentavos: number
  trigger: 'owner' | 'schedule'
}

export type Db = {
  business: Business
  workers: Worker[]
  shifts: Shift[]
  runs: PayrollRun[]
  agent: { erc8004Id?: string; registeredAt?: string; agentUri?: string }
}

const emptyDb = (): Db => ({
  business: {
    name: 'Panadería Los Andes',
    cuit: '30-71234567-8',
    owner: 'Marta Quiroga',
    city: 'Rosario, Santa Fe',
    monthlyTotalCapCentavos: 180_000_00,
    approvalThresholdCentavos: 60_000_00,
    maxHoursPerWeek: 48,
    pilot: true,
  },
  workers: [],
  shifts: [],
  runs: [],
  agent: {},
})

const dbPath = () => join(config.dataDir, 'db.json')

const ensureDir = () => {
  if (!existsSync(config.dataDir)) mkdirSync(config.dataDir, { recursive: true })
}

export const load = (): Db => {
  ensureDir()
  const p = dbPath()
  if (!existsSync(p)) {
    const db = emptyDb()
    save(db)
    return db
  }
  return JSON.parse(readFileSync(p, 'utf8')) as Db
}

export const save = (db: Db): void => {
  ensureDir()
  const p = dbPath()
  const tmp = `${p}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8')
  renameSync(tmp, p)
}

let queue: Promise<unknown> = Promise.resolve()

/** Serialise read-modify-write so two requests can never interleave. */
export const mutate = <T>(fn: (db: Db) => T): Promise<T> => {
  const next = queue.then(() => {
    const db = load()
    const result = fn(db)
    save(db)
    return result
  })
  queue = next.catch(() => undefined)
  return next
}

export const newId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
