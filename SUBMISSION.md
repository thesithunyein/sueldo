# Sueldo — submission

**Track:** Stable Agents: LatAm (Ripio × Celo Core Co.)
**Tagline:** Payroll for small Argentine businesses, paid in wARS on Celo mainnet. The wage never becomes a dollar.

## Short description

Sueldo is a payroll agent for the businesses that pay wages in cash. The owner logs the week's shifts in one Spanish screen; the agent computes each person's wage, checks it against the caps and approvals the owner set, and pays every worker in wARS on Celo mainnet. Each payment carries the entry's ERC-8021 tag, and each receipt links to the transaction and to a Ripio off-ramp so the worker can turn pesos on-chain into pesos in the bank.

## Longer description

A bakery in Rosario with four employees pays wages in cash. Every week that means counting cash, a trip to the bank for change, a hand-written receipt per person, and a shoebox of paper that has to agree with the accountant at month end. If the owner is away on Friday, payday slips.

Sueldo replaces the shoebox. The owner logs hours; the agent does the arithmetic, applies the rules, and pays. The rules are the point: a payment is refused when it would break the person's monthly cap, the business's monthly cap, the weekly hours limit, or the agent's float; it is held for approval when it is above the owner's threshold or when someone's hours jump more than 40% above their four-week average. Every refusal comes back in Spanish, in pesos, with the number that caused it.

Money stays in pesos end to end. wARS is one peso, so there is no conversion, no spread and no dollar leg. Gas is paid in a stablecoin through CIP-64. Workers who want bank pesos use a Ripio off-ramp link on the receipt.

## Celo stack used

| Piece | Where |
| --- | --- |
| wARS (`0x0dc4f928…d90d`) | The payroll currency, 1:1 with the peso |
| ERC-8004 identity | The agent is registered from its own wallet; card served at `/api/agent.json` |
| ERC-8021 attribution | Suffix appended to every transfer and verified back from the chain |
| CIP-64 fee currency | Gas in USDC or USA₮ through the FeeCurrencyDirectory adapter, CELO as fallback |
| Ripio off-ramp | Per-receipt URL built from the ramp query parameters |

## Proof

- Agent wallet: `0x4563137FA379b077b9C5743E660553245518e29a`
- ERC-8004 agent ID: [10042](https://8004scan.io/agents/celo/10042)
- Registration: [`0x967b4c06…a9c03`](https://celoscan.io/tx/0x967b4c061e03619a2115546206f7c5569d5e6cb62fe0264f9ac63eede0ba9c03)
- Attribution tag: `celo_cd9bddf67435`
- Float swap, CELO to wARS: [`0x2a1bb3a7…a2e75`](https://celoscan.io/tx/0x2a1bb3a793d24f376c4b4333a0a770483a986599fa41232b3db62aebfc7a2e75)
- Tagged wages, 2,700 wARS total:
  - Diego Sosa, 585: [`0xeee4a900…06db2`](https://celoscan.io/tx/0xeee4a9002edc661661c98c755015801eddc33a5805742758302d06749f306db2)
  - Lucía Fernández, 675: [`0xb80e5286…01b97`](https://celoscan.io/tx/0xb80e5286e1f81df8d69061f58ab075b80acc60a1c933c7324911587c66d01b97)
  - Ramón Benítez, 828: [`0xc8251244…7afa9`](https://celoscan.io/tx/0xc82512441edb87e70ee3399d439e4f473bdd85582b41a5065937273b0687afa9)
  - Sofía Aguirre, 612: [`0x845981bc…93bd0`](https://celoscan.io/tx/0x845981bcfdab867420a23200ad62848aae63e8ef41ef473ee770bb59f2893bd0)
- Repo: [github.com/thesithunyein/sueldo](https://github.com/thesithunyein/sueldo)
- Site: [sueldo-pay.vercel.app](https://sueldo-pay.vercel.app)

## Who it is for, and who has used it

The buyer is the owner of a small Argentine business with fewer than ten employees who currently pays wages in cash — bakeries, kiosks, workshops, family restaurants. The person on the other end is a worker who wants pesos in a bank account or a wallet, not a shoebox of bills.

## Honest status

Pilot. The four workers in the repository's seed are test wallets created for the pilot. On 6 November 2026 the agent paid them 585, 675, 828 and 612 wARS, 2,700 in total, each transfer carrying `celo_cd9bddf67435`. By the hackathon's definition these wallets are not independent users — the agent funded them itself. What is real is everything downstream of the wallet: the wages were computed from logged shifts of 0.09 h, the caps and approvals are the ones a business would configure, the transfers landed in wARS on mainnet with the entry's tag, and the receipts carry a Ripio off-ramp link.

The path beyond the hackathon is onboarding the first real business: the same flow, with the owner's own workers' wallets and their real hourly rates, funded by swapping the cash float the business already sets aside for payday. Nothing in the product changes for them; only the addresses and the amounts do. The first pilot is meant to come out of the Ripio builders sessions in six Argentine cities, where the businesses that pay wages in cash are already in the room.

## Gas

The agent signs and pays its own gas. There is no relayer and no sponsored gas. This pilot paid the fee in CELO, because the wallet held no USDC. When the wallet holds USDC or USA₮, the same path pays the fee in that stablecoin through CIP-64.
