import { getAddress, isAddress, zeroAddress } from 'viem'
import { say, type Lang } from './lang.js'
import { formatArs } from './money.js'
import type { Business, Reason, Worker } from './store.js'

export type GuardInput = {
  business: Pick<Business, 'monthlyTotalCapCentavos' | 'approvalThresholdCentavos' | 'maxHoursPerWeek'>
  worker: Worker
  hours: number
  grossCentavos: number
  /** Confirmed pay already made to this worker inside the current week. */
  alreadyPaidWorkerCentavos: number
  /** Confirmed pay already made to everyone inside the current calendar month. */
  alreadyPaidBusinessCentavos: number
  /** Confirmed pay already made to this worker inside the current calendar month. */
  workerPaidThisMonthCentavos: number
  /** Sum of the pay decisions already accepted earlier in this same run. */
  runTotalCentavos: number
  treasuryCentavos: number | null
  /** Mean weekly hours over the previous four weeks, 0 when there is no history. */
  trailingAverageHours: number
  approved: boolean
  /** Cash weeks skip the pay-account and balance checks. The owner hands over the pesos. */
  channel?: 'cash' | 'account'
  lang?: Lang
}

export type GuardVerdict = {
  action: 'pay' | 'hold' | 'refuse' | 'skip'
  reasons: Reason[]
}

const r = (code: string, message: string, detail?: string): Reason => ({ code, message, detail })

/**
 * Every rule that stands between a computed wage and a transfer. Refusals win over
 * holds, so a worker never waits for approval on a payment that could not clear anyway.
 */
export const decide = (input: GuardInput): GuardVerdict => {
  const { business, worker, hours, grossCentavos } = input
  const cash = input.channel === 'cash'
  const lang = input.lang ?? 'en'
  const money = (c: number) => formatArs(c, lang)
  const refusals: Reason[] = []
  const holds: Reason[] = []
  const skips: Reason[] = []

  if (!worker.active) {
    skips.push(r('W_INACTIVE', say(lang, `${worker.name} is not active.`, `${worker.name} no está activo.`)))
  }
  if (hours <= 0) {
    skips.push(r('W_SIN_HORAS', say(lang, 'No hours this week.', 'No hay horas esta semana.')))
  }
  if (grossCentavos <= 0) {
    skips.push(r('W_SIN_MONTO', say(lang, 'The amount is zero.', 'El importe es cero.')))
  }
  if (!cash && (!isAddress(worker.wallet) || getAddress(worker.wallet) === zeroAddress)) {
    const missing = isAddress(worker.wallet) && getAddress(worker.wallet) === zeroAddress
    refusals.push(
      r(
        'G_BILLETERA',
        missing ? say(lang, 'No pay account.', 'Falta la cuenta de cobro.') : say(lang, 'Pay account is not valid.', 'La cuenta de cobro no sirve.'),
        missing ? say(lang, 'Add it on their profile.', 'Agregala en la ficha.') : undefined,
      ),
    )
  }

  if (hours > business.maxHoursPerWeek) {
    refusals.push(
      r(
        'G_HORAS',
        say(lang, 'Too many hours this week.', 'Demasiadas horas esta semana.'),
        say(lang, `${hours} h. Limit is ${business.maxHoursPerWeek} h.`, `${hours} h. El tope es ${business.maxHoursPerWeek} h.`),
      ),
    )
  }

  if (input.alreadyPaidWorkerCentavos > 0) {
    refusals.push(r('G_DUPLICADO', say(lang, 'Already paid this week.', 'Ya cobró esta semana.')))
  }

  const capRoom = worker.monthlyCapCentavos - input.workerPaidThisMonthCentavos
  if (grossCentavos > capRoom) {
    refusals.push(
      r(
        'G_TOPE_TRABAJADOR',
        say(lang, 'Over their monthly limit.', 'Supera su tope del mes.'),
        say(lang, `${money(capRoom)} left.`, `Quedan ${money(capRoom)}.`),
      ),
    )
  }

  const businessRoom = business.monthlyTotalCapCentavos - input.alreadyPaidBusinessCentavos
  if (input.runTotalCentavos + grossCentavos > businessRoom) {
    refusals.push(
      r(
        'G_TOPE_NEGOCIO',
        say(lang, 'Over the shop monthly limit.', 'Supera el tope del mes del negocio.'),
        say(lang, `${money(businessRoom)} left.`, `Quedan ${money(businessRoom)}.`),
      ),
    )
  }

  if (!cash && input.treasuryCentavos !== null && input.treasuryCentavos < input.runTotalCentavos + grossCentavos) {
    refusals.push(
      r(
        'G_FONDOS',
        say(lang, 'Not enough money.', 'No alcanza la plata.'),
        say(
          lang,
          `You have ${money(input.treasuryCentavos)}. This pay needs ${money(input.runTotalCentavos + grossCentavos)}.`,
          `Hay ${money(input.treasuryCentavos)}. Este pago necesita ${money(input.runTotalCentavos + grossCentavos)}.`,
        ),
      ),
    )
  }

  if (input.trailingAverageHours > 0 && hours > input.trailingAverageHours * 1.4 && !input.approved) {
    holds.push(
      r(
        'G_ANOMALIA',
        say(lang, 'Hours are much higher than usual.', 'Las horas están muy por encima de lo usual.'),
        say(
          lang,
          `${hours} h. Usual is ${input.trailingAverageHours.toFixed(1)} h.`,
          `${hours} h. Lo usual es ${input.trailingAverageHours.toFixed(1)} h.`,
        ),
      ),
    )
  }

  if (grossCentavos > business.approvalThresholdCentavos && !input.approved) {
    holds.push(
      r(
        'G_APROBACION',
        say(lang, 'Too big. Needs your OK.', 'Es mucho. Necesita tu OK.'),
        say(lang, `Limit is ${money(business.approvalThresholdCentavos)}.`, `El límite es ${money(business.approvalThresholdCentavos)}.`),
      ),
    )
  }

  if (refusals.length > 0) return { action: 'refuse', reasons: [...refusals, ...holds] }
  if (holds.length > 0) return { action: 'hold', reasons: holds }
  if (skips.length > 0) return { action: 'skip', reasons: skips }
  return { action: 'pay', reasons: [] }
}
