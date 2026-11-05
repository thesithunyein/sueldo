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

- Agent wallet:
- ERC-8004 agent ID:
- Attribution tag: `celo_cd9bddf67435`
- Example tagged transfer:
- Repo:

## Who it is for, and who has used it

The buyer is the owner of a small Argentine business with fewer than ten employees who currently pays wages in cash — bakeries, kiosks, workshops, family restaurants. The person on the other end is a worker who wants pesos in a bank account or a wallet, not a shoebox of bills.

## Honest status

Pilot. The four workers in the repository's seed are test wallets created for the pilot, and the pilot week runs short shifts so the on-chain demonstration stays cheap; the UI says so above the total. By the hackathon's definition these wallets are not independent users — the agent funded them itself. What is real is everything downstream of the wallet: the wages are computed from logged shifts, the caps and approvals are the ones a business would configure, the transfers land in wARS on mainnet with the entry's tag, and the receipts carry a working Ripio off-ramp link.

The path beyond the hackathon is onboarding the first real business: the same flow, with the owner's own workers' wallets and their real hourly rates, funded by swapping the cash float the business already sets aside for payday. Nothing in the product changes for them; only the addresses and the amounts do. The first pilot is meant to come out of the Ripio builders sessions in six Argentine cities, where the businesses that pay wages in cash are already in the room.

## Gas

The agent pays its own gas in USDC through CIP-64, from the same wallet that holds the float. There is no relayer and no sponsored gas anywhere in the flow, so every transaction is signed and paid by the agent itself.
