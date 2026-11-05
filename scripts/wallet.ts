import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { privateKeyToAccount } from 'viem/accounts'

const ENV = '.env'
const template = existsSync('.env.example') ? readFileSync('.env.example', 'utf8') : 'AGENT_KEY=\nRPC_URL=https://forno.celo.org\n'

let env = existsSync(ENV) ? readFileSync(ENV, 'utf8') : template
const match = env.match(/^AGENT_KEY=(.*)$/m)
const current = match?.[1]?.trim() ?? ''
const isPlaceholder = !current || /^0x0+$/.test(current) || current.length !== 66

const key = isPlaceholder ? (`0x${randomBytes(32).toString('hex')}` as `0x${string}`) : (current as `0x${string}`)
const account = privateKeyToAccount(key)

if (isPlaceholder) {
  env = match ? env.replace(/^AGENT_KEY=.*$/m, `AGENT_KEY=${key}`) : `AGENT_KEY=${key}\n${env}`
  if (!/^ATTRIBUTION_TAG=/m.test(env)) env += `\nATTRIBUTION_TAG=celo_cd9bddf67435\n`
  writeFileSync(ENV, env.endsWith('\n') ? env : `${env}\n`, 'utf8')
  console.log('Clave nueva escrita en .env (ignorada por git).')
} else {
  console.log('La clave existente en .env se mantiene.')
}

console.log(`Dirección del agente: ${account.address}`)
console.log(`Verificación:         cast wallet address --private-key <la clave de .env> debe dar la misma dirección`)
console.log('')
console.log('Para operar en Celo mainnet hace falta wARS en esa dirección y un poco de gas (USDC o CELO).')
