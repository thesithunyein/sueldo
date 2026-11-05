import { formatUnits, parseUnits } from 'viem'

/**
 * All money in this app is integer centavos of ARS. wARS is 1:1 with the peso,
 * so 1 centavo = 10^16 wei: 100 centavos make 1 ARS, 10^18 wei make 1 wARS.
 */
const WEI_PER_CENTAVO = 10n ** 16n

export const arsToWars = (centavos: number): bigint => {
  if (!Number.isInteger(centavos) || centavos < 0) throw new Error(`invalid centavos: ${centavos}`)
  return BigInt(centavos) * WEI_PER_CENTAVO
}

export const warsToArs = (wei: bigint): number => Number(wei / WEI_PER_CENTAVO)

export const formatArs = (centavos: number): string =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centavos / 100)

export const formatWars = (wei: bigint): string => formatUnits(wei, 18)

export const parseArsInput = (value: string): number => {
  const normalized = value.trim().replace(/\./g, '').replace(',', '.')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`importe inválido: ${value}`)
  return Math.round(parsed * 100)
}

export const parseTokenAmount = (value: string, decimals = 18): bigint => parseUnits(value, decimals)
