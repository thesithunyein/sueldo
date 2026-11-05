import { createWalletClient, encodeFunctionData, erc20Abi, formatUnits, http, parseAbi, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { celo } from 'viem/chains'
import { toDataSuffix } from '@celo/attribution-tags'
import { config, feeCurrencies, tokens } from '../src/config.js'
import { publicClient } from '../src/chain.js'

const LI_FI = 'https://li.quest/v1'
// Gas is paid in the same stablecoin, so the swap must leave a little of it behind.
const GAS_BUFFER = 50_000n // 0.05 with 6 decimals

const sources = [
  { name: 'USDC', address: tokens.USDC, fee: feeCurrencies.USDC },
  { name: 'USAT', address: tokens.USAT, fee: feeCurrencies.USAT },
] as const

if (!config.agentKey || config.agentKey.length !== 66) {
  console.error('Falta AGENT_KEY en .env. Corré: npm run wallet')
  process.exit(1)
}

const account = privateKeyToAccount(config.agentKey)
const wallet = createWalletClient({ account, chain: celo, transport: http(config.rpcUrl) })

const args = process.argv.slice(2)
const requestedName = args.find((a) => Number.isNaN(Number(a)))?.toUpperCase()
const requestedAmount = args.map(Number).find((n) => Number.isFinite(n))

const balances = await Promise.all(
  sources.map((s) =>
    publicClient.readContract({
      address: s.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [account.address],
    }),
  ),
)

const candidates = sources.map((s, i) => ({ ...s, balance: balances[i] }))
const source = requestedName
  ? candidates.find((c) => c.name === requestedName)
  : candidates.sort((a, b) => (a.balance === b.balance ? 0 : a.balance > b.balance ? -1 : 1))[0]

if (!source) {
  console.error(`Token desconocido: ${requestedName}. Usá USDC o USAT.`)
  process.exit(1)
}

const requested = requestedAmount !== undefined
  ? BigInt(Math.round(requestedAmount * 1_000_000))
  : source.balance - GAS_BUFFER

const available = source.balance > GAS_BUFFER ? source.balance - GAS_BUFFER : 0n
if (requested <= 0n || requested > available) {
  console.error(
    `Saldo ${source.name} insuficiente: hay ${formatUnits(source.balance, 6)} y se reservan 0.05 para gas.`,
  )
  process.exit(1)
}

const query = new URLSearchParams({
  fromChain: '42220',
  toChain: '42220',
  fromToken: source.address,
  toToken: tokens.wARS,
  fromAddress: account.address,
  toAddress: account.address,
  fromAmount: requested.toString(),
  slippage: '0.03',
  integrator: 'sueldo',
})

console.log(`cambiando ${formatUnits(requested, 6)} ${source.name} a wARS …`)
const response = await fetch(`${LI_FI}/quote?${query}`)
if (!response.ok) {
  console.error('LI.FI rechazó la cotización:', response.status, (await response.text()).slice(0, 300))
  process.exit(1)
}
const quote = (await response.json()) as {
  estimate?: { approvalAddress?: Address; toAmount?: string; tool?: string }
  transactionRequest?: { to: Address; data: Hex; value?: string; gasLimit?: string }
}

if (!quote.transactionRequest) {
  console.error('La ruta no devolvió una transacción. Probá en unos minutos.')
  process.exit(1)
}
console.log(`ruta ${quote.estimate?.tool ?? '?'}: recibirías ~${formatUnits(BigInt(quote.estimate?.toAmount ?? '0'), 18)} wARS`)

const approvalTarget = quote.estimate?.approvalAddress ?? quote.transactionRequest.to
const allowance = await publicClient.readContract({
  address: source.address,
  abi: erc20Abi,
  functionName: 'allowance',
  args: [account.address, approvalTarget],
})

const tag = toDataSuffix(config.attributionTag)
const feeCurrency = source.fee

if (allowance < requested) {
  console.log(`aprobando ${approvalTarget} …`)
  const data = `${encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [approvalTarget, requested] })}${tag.slice(2)}` as Hex
  const hash = await wallet.sendTransaction({ to: source.address, data, feeCurrency } as never)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') {
    console.error('La aprobación falló:', `https://celoscan.io/tx/${hash}`)
    process.exit(1)
  }
  console.log(`aprobación https://celoscan.io/tx/${hash}`)
}

const swapData = `${quote.transactionRequest.data}${tag.slice(2)}` as Hex
const hash = await wallet.sendTransaction({
  to: quote.transactionRequest.to,
  data: swapData,
  value: BigInt(quote.transactionRequest.value ?? '0'),
  gas: quote.transactionRequest.gasLimit ? BigInt(quote.transactionRequest.gasLimit) : undefined,
  feeCurrency,
} as never)
const receipt = await publicClient.waitForTransactionReceipt({ hash })
console.log(`swap ${receipt.status} https://celoscan.io/tx/${hash}`)
if (receipt.status !== 'success') process.exit(1)

const wars = await publicClient.readContract({
  address: tokens.wARS,
  abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
  functionName: 'balanceOf',
  args: [account.address],
})
console.log(`saldo wARS: ${formatUnits(wars, 18)}`)
if (wars === 0n) {
  console.log('La ruta puede tardar unos minutos. Volvé a correr npm run smoke para ver el saldo.')
}
