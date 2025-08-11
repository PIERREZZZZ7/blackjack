# Next.js + Flask Blackjack (MVP)

A minimal, deployable blackjack dApp:
- **Next.js (App Router)** UI with Phantom wallet connect
- **Flask** serverless endpoint on Vercel (`/api/python/blackjack`) that runs the blackjack engine
- HMAC-signed state token so the backend stays stateless (works on Vercel serverless)

## Quick Start

1. Copy files into your repo (or unzip and push).
2. Put Flask code under `api/python/blackjack/` in your Next.js app.
3. Set env vars on Vercel:
   - `NEXT_PUBLIC_SOLANA_RPC` = your Solana RPC URL
   - `BJ_SECRET` = a random long string
4. `pnpm i` (or npm/yarn) and `pnpm run dev`
5. Visit `/` — Connect Phantom, select SOL/USDC, set a bet, and Deal.

## Notes

- Bets are **not** moving funds yet. This is an MVP for gameplay + balances.
- To add real staking/deposits, implement a `/deposit` flow that generates a unique address or uses a single house vault and monitors incoming transfers via webhooks.
