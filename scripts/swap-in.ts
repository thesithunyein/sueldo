import { createWalletClient, encodeFunctionData, erc20Abi, formatUnits, http, parseAbi, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { celo } from 'viem/chains'
import { toDataSuffix } from '@celo/attribution-tags'
import { config, feeCurrencies, tokens } from '../src/config.js'
import { publicClient } from '../src/chain.js'

const LI_FI = 'https://li.quest/v1'
// Gas is paid in USA₮, so the swap must leave a little of it behind.
const GAS_BUFFER = 50_000n

if (!config.agentKey || config.agentKey.length !== 66) {
  console.error('Falta AGENT_KEY en .env. Corré: npm run wallet')
  process.exit(1)
}

const account = privateKeyToAccount(config.agentKey)
const wallet = createWalletClient({ account, chain: celo, transport: http(config.rpcUrl) })

const balance = await publicClient.readContract({
  address: tokens.USAT,
  abi: erc20Abi,
  functionName: 'balanceOf',
  args: [account.address],
})
const requested = balance - GAS_BUFFER
if (requested <= 0n) {
  console.error(`Saldo USA₮ insuficiente: ${formatUnits(balance, 6)}`)
  process.exit(1)
}

const query = new URLSearchParams({
  fromChain: '42220',
  toChain: '42220',
  fromToken: tokens.USAT,
  toToken: tokens.wARS,
  fromAddress: account.address,
  toAddress: account.address,
  fromAmount: requested.toString(),
  slippage: '0.03',
  integrator: 'sueldo',
})

console.log(`cambiando ${formatUnits(requested, 6)} USA₮ a wARS …`)
const response = await fetch(`${LI_FI}/quote?${query}`)
if (!response.ok) {
  console.error('LI.FI rechazó la cotización:', response.status, (await response.text()).slice(0, 300))
  process.exit(1)
}
const quote = (await response.json()) as {
  estimate?: { approvalAddress?: Address; toAmount?: string }
  transactionRequest?: { to: Address; data: Hex; value?: string; gasLimit?: string }
}

if (!quote.transactionRequest) {
  console.error('La ruta no devolvió una transacción. Probá en unos minutos.')
  process.exit(1)
}
console.log(`recibirías ~${formatUnits(BigInt(quote.estimate?.toAmount ?? '0'), 18)} wARS`)

const approvalTarget = quote.estimate?.approvalAddress ?? quote.transactionRequest.to
const allowance = await publicClient.readContract({
  address: tokens.USAT,
  abi: erc20Abi,
  functionName: 'allowance',
  args: [account.address, approvalTarget],
})

const tag = toDataSuffix(config.attributionTag)
const feeCurrency = feeCurrencies.USAT

if (allowance < requested) {
  console.log(`aprobando ${approvalTarget} …`)
  const data = `${encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [approvalTarget, requested] })}${tag.slice(2)}` as Hex
  const hash = await wallet.sendTransaction({ to: tokens.USAT, data, feeCurrency } as never)
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
