import 'dotenv/config'

const num = (v: string | undefined, fallback: number) => (v && Number.isFinite(Number(v)) ? Number(v) : fallback)

export const config = {
  port: num(process.env.PORT, 3000),
  rpcUrl: process.env.RPC_URL ?? 'https://forno.celo.org',
  agentKey: (process.env.AGENT_KEY ?? '') as `0x${string}`,
  attributionTag: process.env.ATTRIBUTION_TAG ?? 'celo_cd9bddf67435',
  feeCurrencyMode: (process.env.FEE_CURRENCY ?? 'USDC').toUpperCase() as 'USDC' | 'CELO',
  dataDir: process.env.DATA_DIR ?? (process.env.VERCEL ? '/tmp/sueldo' : '.data'),
  scheduleEnabled: process.env.VERCEL ? false : process.env.AGENT_SCHEDULE !== '0',
  // Payday: Friday 18:00 Argentina time.
  payday: { weekday: 5, hour: 18, timezone: 'America/Argentina/Buenos_Aires' },
} as const

export const tokens = {
  wARS: '0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d',
  USDC: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
  USAT: '0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771',
} as const

/**
 * CIP-64 charges gas through an adapter that the FeeCurrencyDirectory lists, not
 * through the token address. Both are read back from the directory before use.
 */
export const feeCurrencies = {
  directory: '0x15F344b9E6c3Cb6F0376A36A64928b13F62C6276',
  USDC: '0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B',
  USAT: '0x0357EE22278c922e1D36cFe6b899269b161880C4',
} as const

export const registries = {
  identity: '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432',
  reputation: '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63',
} as const
