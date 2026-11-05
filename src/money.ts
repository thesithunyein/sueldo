import { formatUnits, parseUnits } from 'viem'
import type { Lang } from './lang.js'

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

export const formatArs = (centavos: number, lang: Lang = 'en'): string =>
  new Intl.NumberFormat(lang === 'es' ? 'es-AR' : 'en-US', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centavos / 100)

export const formatWars = (wei: bigint): string => formatUnits(wei, 18)

export const parseArsInput = (value: string): number => {
  const trimmed = value.trim().replace(/\$/g, '').replace(/\s/g, '').replace(/ars/gi, '')
  let normalized = trimmed
  const hasComma = trimmed.includes(',')
  const hasDot = trimmed.includes('.')
  if (hasComma && hasDot) {
    if (trimmed.lastIndexOf('.') > trimmed.lastIndexOf(',')) normalized = trimmed.replace(/,/g, '')
    else normalized = trimmed.replace(/\./g, '').replace(',', '.')
  } else if (hasComma) {
    const parts = trimmed.split(',')
    if (parts.length === 2 && parts[1].length <= 2) normalized = trimmed.replace(',', '.')
    else normalized = trimmed.replace(/,/g, '')
  } else if (hasDot) {
    const parts = trimmed.split('.')
    if (!(parts.length === 2 && parts[1].length <= 2)) normalized = trimmed.replace(/\./g, '')
  }
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`invalid amount: ${value}`)
  return Math.round(parsed * 100)
}

export const parseTokenAmount = (value: string, decimals = 18): bigint => parseUnits(value, decimals)
