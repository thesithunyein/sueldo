import { getAddress, isAddress } from 'viem'
import { formatNative, formatUsdc, isConfigured, readTreasury, sendWars, verify } from '../src/chain.js'
import { arsToWars, formatArs, formatWars } from '../src/money.js'

const argv = process.argv.slice(2)
const sendIdx = argv.indexOf('--send')

if (!isConfigured()) {
  console.error('Falta AGENT_KEY en .env. Corré: npm run wallet')
  process.exit(1)
}

const treasury = await readTreasury()
if (!treasury) process.exit(1)

console.log(`agente      ${treasury.address}`)
console.log(`wARS        ${formatWars(treasury.warsWei)} (${formatArs(treasury.warsCentavos)})`)
console.log(`USDC gas    ${formatUsdc(treasury.usdcWei)}`)
console.log(`CELO gas    ${formatNative(treasury.nativeWei)}`)

if (sendIdx === -1) process.exit(0)

const to = argv[sendIdx + 1]
const ars = argv[sendIdx + 2] ?? '1'
if (!to || !isAddress(to)) {
  console.error('Uso: npm run smoke -- --send 0xDestino 1.5')
  process.exit(1)
}

const centavos = Math.round(Number(ars.replace(',', '.')) * 100)
console.log(`\nenviando ${formatArs(centavos)} a ${getAddress(to)} …`)
const result = await sendWars(getAddress(to), arsToWars(centavos))
console.log(`tx          https://celoscan.io/tx/${result.hash}`)
console.log(`gas         ${result.gasUsed.toString()} · pagado en ${result.feeCurrency ? 'USDC (CIP-64)' : 'CELO'}`)
console.log(`attribution ${result.attribution?.codes.join(',') ?? 'NO ENCONTRADA'}`)

const check = await verify(result.hash)
if (!check?.codes.includes('celo_cd9bddf67435')) {
  console.error('La transacción salió pero el tag no se pudo verificar.')
  process.exit(2)
}
console.log('tag verificado en cadena.')
