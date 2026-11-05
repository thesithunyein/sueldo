import { getAddress, isAddress, zeroAddress } from 'viem'
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
  const refusals: Reason[] = []
  const holds: Reason[] = []
  const skips: Reason[] = []

  if (!worker.active) {
    skips.push(r('W_INACTIVE', `${worker.name} está dado de baja.`))
  }
  if (hours <= 0) {
    skips.push(r('W_SIN_HORAS', 'No hay horas cargadas en el período.'))
  }
  if (grossCentavos <= 0) {
    skips.push(r('W_SIN_MONTO', 'El importe calculado es cero.'))
  }
  if (!isAddress(worker.wallet) || getAddress(worker.wallet) === zeroAddress) {
    refusals.push(r('G_BILLETERA', 'La billetera de cobro no es válida.', worker.wallet))
  }

  if (hours > business.maxHoursPerWeek) {
    refusals.push(
      r('G_HORAS', 'Las horas superan el máximo semanal.', `${hours} h contra un máximo de ${business.maxHoursPerWeek} h`),
    )
  }

  if (input.alreadyPaidWorkerCentavos > 0) {
    refusals.push(r('G_DUPLICADO', 'Esta persona ya cobró en esta semana.'))
  }

  const capRoom = worker.monthlyCapCentavos - input.workerPaidThisMonthCentavos
  if (grossCentavos > capRoom) {
    refusals.push(
      r('G_TOPE_TRABAJADOR', 'Supera el tope mensual acordado con esta persona.', `Quedan ${formatArs(capRoom)} de margen`),
    )
  }

  const businessRoom = business.monthlyTotalCapCentavos - input.alreadyPaidBusinessCentavos
  if (input.runTotalCentavos + grossCentavos > businessRoom) {
    refusals.push(
      r('G_TOPE_NEGOCIO', 'Supera el tope mensual de la nómina.', `Quedan ${formatArs(businessRoom)} de margen`),
    )
  }

  if (input.treasuryCentavos !== null && input.treasuryCentavos < input.runTotalCentavos + grossCentavos) {
    refusals.push(
      r(
        'G_FONDOS',
        'No alcanza el saldo en pesos del agente.',
        `Hay ${formatArs(input.treasuryCentavos)} y esta nómina necesita ${formatArs(input.runTotalCentavos + grossCentavos)}`,
      ),
    )
  }

  if (input.trailingAverageHours > 0 && hours > input.trailingAverageHours * 1.4) {
    holds.push(
      r(
        'G_ANOMALIA',
        'Las horas se apartan del promedio de las últimas 4 semanas.',
        `${hours} h contra un promedio de ${input.trailingAverageHours.toFixed(1)} h`,
      ),
    )
  }

  if (grossCentavos > business.approvalThresholdCentavos && !input.approved) {
    holds.push(
      r(
        'G_APROBACION',
        'El importe supera el umbral y necesita tu aprobación.',
        `Umbral: ${formatArs(business.approvalThresholdCentavos)}`,
      ),
    )
  }

  if (refusals.length > 0) return { action: 'refuse', reasons: [...refusals, ...holds] }
  if (holds.length > 0) return { action: 'hold', reasons: holds }
  if (skips.length > 0) return { action: 'skip', reasons: skips }
  return { action: 'pay', reasons: [] }
}
