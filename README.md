# Sueldo

Payroll for the small businesses Argentina actually has. The owner logs hours, the agent computes each wage, applies the rules the owner set, and pays every worker in **wARS on Celo mainnet**. Nobody converts to dollars, nobody goes to the bank, nobody downloads a wallet to get paid.

Built for the **Stable Agents: LatAm** track of the Celo *Agents on Open Rails* hackathon.

---

## The problem

A bakery in Rosario with four employees pays wages in cash. Every week that means: counting cash, a trip to the bank for change, a hand-written receipt per person, and a shoebox of paper that has to agree with the accountant at month end. If the owner is away on Friday, payday slips. If a worker needs the money on Saturday, they ask for an advance and the count breaks.

The alternative — an online payroll service — wants a bank account, a CUIT-backed contract and a monthly fee, and then pays into bank accounts that half the staff do not have.

## Who it's for

**Marta Quiroga**, 51, owns Panadería Los Andes in Rosario: four employees, cash wages, a phone with WhatsApp. She is not a crypto user and does not want to be. Her workers are not crypto users either. Two of them get paid into a bank account, two take cash.

She is a persona drawn from the cash-wage pattern of small Argentine businesses, not a signed customer — the pilot in this repository runs on test wallets. What follows is the product built for her.

Sueldo gives her one screen in Spanish, amounts in pesos, and a payday that happens whether or not she is standing in the bakery.

## How a payroll week works

```
hours logged ──► agent computes wages ──► guardrails ──► wARS transfers ──► receipts
                                              │
                                              └── refuse / hold with a reason the owner can read
```

1. **Hours.** The owner (or a supervisor) logs shifts through the web UI. A shift is a date and a number of hours.
2. **Computation.** Every Monday-to-Sunday period, the agent multiplies hours by each person's hourly rate. All money is integer centavos, so nothing drifts.
3. **Guardrails.** Before any money moves, each line is checked against the rules the owner configured (table below). The agent pays, holds for approval, or refuses — and it always says why, in Spanish, in terms of pesos.
4. **Payment.** Each approved line becomes one `transfer` to that worker's wallet in wARS. The agent signs it, pays gas in USDC (CIP-64), and appends the hackathon's ERC-8021 attribution suffix to the calldata.
5. **Receipt.** The transaction hash, the attribution code the chain reports for it, and a Ripio off-ramp link for the worker are written to the run. The worker can turn wARS into pesos in their bank in one tap.

The agent also runs on its own: a scheduler fires the payroll every Friday at 18:00 Argentina time if that week has not been paid yet. The button in the UI is the owner's override.

## Guardrails

| Code | Rule | Outcome |
| --- | --- | --- |
| `G_HORAS` | More hours in a week than the business allows (48 h) | refuse |
| `G_DUPLICADO` | This person already got paid this week | refuse |
| `G_TOPE_TRABAJADOR` | The payment would pass the monthly cap agreed with this person | refuse |
| `G_TOPE_NEGOCIO` | The payment would pass the business's monthly payroll cap | refuse |
| `G_FONDOS` | The agent's wARS float cannot cover the run | refuse |
| `G_BILLETERA` | The worker's payout address is invalid or zero | refuse |
| `G_ANOMALIA` | Hours are more than 40% above that person's four-week average | hold |
| `G_APROBACION` | A single payment is above the owner's approval threshold | hold |
| `W_INACTIVE`, `W_SIN_HORAS`, `W_SIN_MONTO` | Nothing to pay | skip |

Refusals beat holds: a line that cannot clear is never left waiting for an approval that would not help. The treasury check counts what the run has already committed, so a run cannot overdraw itself halfway through.

## Celo stack

- **wARS** (`0x0dc4f92879b7670e5f4e4e6e3c801d229129d90d`) is the payroll currency. One wARS is one peso, so no conversion ever happens.
- **ERC-8004** identity for the agent, registered from the agent's own wallet. The agent card is served at `/api/agent.json`.
- **ERC-8021** attribution: every transaction the agent sends carries the entry's code in the calldata suffix, verified back from the chain after each payment.
- **CIP-64 gas**: the agent pays network fees in USDC when it holds enough, so the float can be pesos and the gas a stablecoin. It falls back to CELO.
- **Ripio off-ramp links** on every receipt, built as a plain URL from the docs' query parameters, so a worker can cash out without installing anything.

## Receipts

A receipt is not a PDF. For each payment the app stores the worker, the hours, the amount in centavos, the period, the transaction hash, the attribution codes the chain reports for that hash, and the off-ramp link. The UI links straight to CeloScan.

## Run it

```bash
npm install
npm run wallet     # creates .env with a fresh agent key, prints the address
npm run seed       # four workers and five weeks of shifts
npm start          # http://localhost:3000
npm test           # guardrails, money, periods, attribution wire format
```

The agent needs wARS for the float and a little USDC or CELO for gas. Without them the UI still works: every line is computed and shown, then refused with `G_FONDOS`, because the agent will not spend money it does not have.

```bash
npm run smoke                          # balances of the agent wallet
npm run smoke -- --send 0xDestino 1.5  # a single tagged transfer, verified after it lands
npm run swap:in                        # turns USDC or USA₮ into the wARS float through LI.FI
npm run swap:in -- usdc 8              # explicit token and amount
npm run agent:register                 # ERC-8004 identity, tagged
npm run agent:register -- --dry-run    # simulates the mint against the live registry, sends nothing
```

`swap:in` reads both stablecoin balances, swaps whichever holds funds (or the one you name), and pays its own gas in that same token through the fee-currency wrapper — so a wallet that never bought CELO can still fund itself.

## Status

Pilot. The four workers in the seed are test wallets and the pilot week runs short shifts so the on-chain demo stays cheap — the UI says so above the total. The computation, the guardrails and the settlement are the ones a real client would use; only the scale of the amounts changes.
