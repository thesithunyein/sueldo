# Security

Sueldo keeps a shop's weekly pay. Treat the site and the agent key as you would a cash book and a bank token.

## What is protected

- `AGENT_KEY` is read on the server only. It is not sent to the browser and it is not written into the book.
- Amounts are integer centavos. The parser accepts both `1.500,50` and `1,500.50`.
- A transfer is recorded only after it is sent. A failed transfer is marked failed. Nothing is stored as paid if it did not go out.
- A person already paid this week is refused on the next run.
- Notes, names, and amounts shown in the page are escaped before they are inserted into the page.
- Request bodies are limited to 64 KB.

## What is not protected

- There is no account system. Anyone who can open the URL can add people, change hours, and close the week.
- On a host without a persistent disk, the book can disappear. See the deploy notes in the README.
- The cash book records that you paid. It does not move money. You still hand over the pesos.

Do not commit `.env`. Do not put a real `AGENT_KEY` in an issue, a screenshot, or the client.

## Reporting

Email [sithunyein.mailto@gmail.com](mailto:sithunyein.mailto@gmail.com). Include the version, the request you made, and what you expected. Do not include a private key.

Please give a reasonable time to respond before writing about it in public.
