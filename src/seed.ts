import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { privateKeyToAccount } from 'viem/accounts'
import { config } from './config.js'
import { load, mutate } from './store.js'
import { artDate } from './period.js'

const genKey = () => `0x${randomBytes(32).toString('hex')}` as `0x${string}`

const workersFile = join(config.dataDir, 'demo-workers.json')

type WorkerKey = { name: string; privateKey: `0x${string}`; address: `0x${string}` }

const ensureWorkerKeys = (names: string[]): WorkerKey[] => {
  mkdirSync(config.dataDir, { recursive: true })
  if (existsSync(workersFile)) {
    const existing = JSON.parse(readFileSync(workersFile, 'utf8')) as WorkerKey[]
    if (existing.length === names.length) return existing
  }
  const keys = names.map((name) => {
    const privateKey = genKey()
    return { name, privateKey, address: privateKeyToAccount(privateKey).address }
  })
  writeFileSync(workersFile, JSON.stringify(keys, null, 2), 'utf8')
  return keys
}

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const people = [
  { name: 'Lucía Fernández', role: 'Bakery assistant', rate: 7_500_00, cap: 1_800_000_00, start: 1 },
  { name: 'Ramón Benítez', role: 'Baker', rate: 9_200_00, cap: 2_000_000_00, start: 1 },
  { name: 'Sofía Aguirre', role: 'Front of house', rate: 6_800_00, cap: 1_500_000_00, start: 2 },
  { name: 'Diego Sosa', role: 'Delivery', rate: 6_500_00, cap: 1_400_000_00, start: 3 },
]

const keys = ensureWorkerKeys(people.map((p) => p.name))
const today = artDate()
const dow = new Date(`${today}T00:00:00.000Z`).getUTCDay()
const monday = addDays(today, -(dow === 0 ? 6 : dow - 1))

await mutate((db) => {
  db.business = {
    ...db.business,
    name: 'Los Andes Bakery',
    owner: 'Marta Quiroga',
    city: 'Rosario',
    pilot: false,
    monthlyTotalCapCentavos: db.business.monthlyTotalCapCentavos || 180_000_00,
    approvalThresholdCentavos: db.business.approvalThresholdCentavos || 60_000_00,
    maxHoursPerWeek: db.business.maxHoursPerWeek || 48,
  }
  db.workers = people.map((p, i) => ({
    id: `w${i + 1}`,
    name: p.name,
    role: p.role,
    hourlyRateCentavos: p.rate,
    monthlyCapCentavos: p.cap,
    wallet: keys[i].address,
    active: true,
  }))

  db.shifts = []
  // Four weeks of history so the agent has a baseline to compare against.
  for (let week = 4; week >= 1; week--) {
    const start = addDays(monday, -7 * week)
    people.forEach((p, i) => {
      const days = [p.start, p.start + 2, p.start + 4]
      days.forEach((offset, n) => {
        db.shifts.push({
          id: `seed_${week}_${i}_${n}`,
          workerId: `w${i + 1}`,
          date: addDays(start, offset - 1),
          hours: 6 + (n % 2) * 2,
        })
      })
    })
  }
  // Current week: half-day pilot shifts, kept small so the mainnet run stays cheap.
  people.forEach((p, i) => {
    db.shifts.push({ id: `seed_now_${i}`, workerId: `w${i + 1}`, date: monday, hours: 0.5, note: 'Turno de prueba' })
  })

  db.runs = []
  db.agent = {}
})

const db = load()
const total = db.shifts
  .filter((s) => s.date >= monday)
  .reduce((sum, s) => {
    const w = db.workers.find((x) => x.id === s.workerId)!
    return sum + Math.round(s.hours * w.hourlyRateCentavos)
  }, 0)

console.log(`Sembrado: ${db.workers.length} personas, semana del ${monday}, nómina ${(total / 100).toFixed(2)} ARS`)
for (const w of db.workers) console.log(`  ${w.name.padEnd(18)} ${w.wallet}  $${(w.hourlyRateCentavos / 100).toFixed(2)}/h`)
