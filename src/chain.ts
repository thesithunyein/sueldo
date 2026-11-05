import { createPublicClient, createWalletClient, encodeFunctionData, erc20Abi, formatUnits, http, parseAbi, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { celo } from 'viem/chains'
import { toDataSuffix, verifyTx } from '@celo/attribution-tags'
import { config, feeCurrencies, tokens } from './config.js'
import { warsToArs } from './money.js'

const account = config.agentKey && config.agentKey.length === 66 ? privateKeyToAccount(config.agentKey) : null

export const publicClient = createPublicClient({ chain: celo, transport: http(config.rpcUrl) })

const wallet = account ? createWalletClient({ account, chain: celo, transport: http(config.rpcUrl) }) : null

export const isConfigured = (): boolean => wallet !== null
export const agentAddress = (): Address | null => account?.address ?? null

export type Treasury = {
  address: Address
  warsWei: bigint
  warsCentavos: number
  usdcWei: bigint
  nativeWei: bigint
}

export const readTreasury = async (): Promise<Treasury | null> => {
  if (!account) return null
  const [warsWei, usdcWei, nativeWei] = await Promise.all([
    publicClient.readContract({ address: tokens.wARS, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
    publicClient.readContract({ address: tokens.USDC, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
    publicClient.getBalance({ address: account.address }),
  ])
  return { address: account.address, warsWei, warsCentavos: warsToArs(warsWei), usdcWei, nativeWei }
}

/** CIP-64: pay gas in a stablecoin the agent already holds, or fall back to CELO. */
let allowedFeeCurrencies: string[] | null = null
const allowed = async (): Promise<string[]> => {
  if (allowedFeeCurrencies) return allowedFeeCurrencies
  const list = await publicClient.readContract({
    address: feeCurrencies.directory,
    abi: parseAbi(['function getCurrencies() view returns (address[])']),
    functionName: 'getCurrencies',
  })
  allowedFeeCurrencies = list.map((a) => a.toLowerCase())
  return allowedFeeCurrencies
}

const pickFeeCurrency = async (): Promise<Address | undefined> => {
  if (config.feeCurrencyMode !== 'USDC' || !account) return undefined
  const [usdc, usat, list] = await Promise.all([
    publicClient.readContract({ address: tokens.USDC, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
    publicClient.readContract({ address: tokens.USAT, abi: erc20Abi, functionName: 'balanceOf', args: [account.address] }),
    allowed(),
  ])
  if (usdc >= 50_000n && list.includes(feeCurrencies.USDC.toLowerCase())) return feeCurrencies.USDC
  if (usat >= 50_000n && list.includes(feeCurrencies.USAT.toLowerCase())) return feeCurrencies.USAT
  return undefined
}

export type PaymentResult = {
  hash: Hex
  feeCurrency: Address | undefined
  gasUsed: bigint
  attribution: { codes: string[]; schemaId: number } | null
}

// The SDK declares its own copy of viem's PublicClient type; the values are identical.
const verifyTag = verifyTx as unknown as (args: {
  client: typeof publicClient
  hash: Hex
}) => Promise<{ codes: string[]; schemaId: number } | null>

/**
 * ERC-20 transfer with the ERC-8021 attribution suffix appended to the calldata.
 * Solidity's dispatcher ignores the trailing bytes, so the transfer decodes normally
 * and the tag travels with the transaction.
 */
export const sendWars = async (to: Address, amountWei: bigint): Promise<PaymentResult> => {
  if (!wallet || !account) throw new Error('AGENT_KEY no configurada: el agente no puede firmar')
  if (amountWei <= 0n) throw new Error('importe cero')

  const call = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, amountWei] })
  const data = `${call}${toDataSuffix(config.attributionTag).slice(2)}` as Hex
  const feeCurrency = await pickFeeCurrency()

  const hash = await wallet.sendTransaction({ to: tokens.wARS, data, feeCurrency } as never)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`la transacción ${hash} revirtió`)

  return {
    hash,
    feeCurrency,
    gasUsed: receipt.gasUsed,
    attribution: await verifyTag({ client: publicClient, hash }),
  }
}

export const verify = (hash: Hex) => verifyTag({ client: publicClient, hash })

export const formatUsdc = (wei: bigint): string => formatUnits(wei, 6)
export const formatNative = (wei: bigint): string => formatUnits(wei, 18)
