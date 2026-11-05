import { createWalletClient, encodeFunctionData, erc721Abi, http, parseEventLogs, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { celo } from 'viem/chains'
import { toDataSuffix } from '@celo/attribution-tags'
import { agentAddress, isConfigured, publicClient, verify } from './chain.js'
import { config, registries } from './config.js'
import { load, mutate } from './store.js'

const identityAbi = [
  {
    type: 'function',
    name: 'register',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'agentURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
  },
] as const

const db = load()
if (db.agent.erc8004Id) {
  console.log(`Ya registrado como agente #${db.agent.erc8004Id} (${db.agent.agentUri})`)
  process.exit(0)
}
if (!isConfigured()) {
  console.error('Falta AGENT_KEY en .env')
  process.exit(1)
}

const base = process.env.PUBLIC_URL
const agentUri =
  base !== undefined
    ? `${base.replace(/\/$/, '')}/api/agent.json`
    : `data:application/json;base64,${Buffer.from(
        JSON.stringify({
          type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
          name: 'Sueldo',
          description:
            'Agente de nómina para PyMEs argentinas: calcula la nómina semanal desde las horas trabajadas, aplica topes y aprobaciones, y paga en wARS sobre Celo mainnet.',
          active: true,
          x402Support: false,
          supportedTrust: ['reputation'],
        }),
      ).toString('base64')}`

const data = `${encodeFunctionData({ abi: identityAbi, functionName: 'register', args: [agentUri] })}${toDataSuffix(
  config.attributionTag,
).slice(2)}` as Hex

const account = privateKeyToAccount(config.agentKey)
const client = createWalletClient({ account, chain: celo, transport: http(config.rpcUrl) })

if (process.argv.includes('--dry-run')) {
  const { data: returned } = await publicClient.call({ account, to: registries.identity, data })
  console.log(`simulación sobre el registro real: devolvería el agente #${returned ? BigInt(returned) : 0n}`)
  console.log(`agentURI: ${agentUri.startsWith('data:') ? 'data URI (self-contained)' : agentUri}`)
  process.exit(0)
}

const hash = await client.sendTransaction({ to: registries.identity, data } as never)
const receipt = await publicClient.waitForTransactionReceipt({ hash })
console.log(`registro ${hash} · estado ${receipt.status}`)

const transfers = parseEventLogs({ abi: erc721Abi, eventName: 'Transfer', logs: receipt.logs }).filter(
  (log) =>
    log.address.toLowerCase() === registries.identity.toLowerCase() &&
    log.args.to?.toLowerCase() === account.address.toLowerCase(),
)
const agentId = transfers.at(-1)?.args.tokenId

if (!agentId || receipt.status !== 'success') {
  console.error('No pude leer el agentId del recibo. Revisá la transacción:', `https://celoscan.io/tx/${hash}`)
  process.exit(1)
}

const attribution = await verify(hash)
await mutate((d) => {
  d.agent = { erc8004Id: agentId.toString(), registeredAt: new Date().toISOString(), agentUri }
})

console.log(`agente ERC-8004 #${agentId} · dueño ${agentAddress()}`)
console.log(`tag en la transacción: ${attribution?.codes.join(',') ?? 'no encontrado'}`)
console.log(`https://8004scan.io/agents/celo/${agentId}`)
console.log(`tokenURI: ${agentUri.startsWith('data:') ? 'data URI (self-contained)' : agentUri}`)
