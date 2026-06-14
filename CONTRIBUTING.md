# Contributing

Thanks for improving AI Roundtable.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Start PostgreSQL or use `docker compose up postgres`.
3. Run `npm install`.
4. Run `npm run db:push`.
5. Run `npm run dev`.

## Checks

Run these before opening a pull request:

```bash
npm run lint
npm run test
npm run build
```

Keep changes focused. Do not commit API keys, `.env.local`, or exported private discussions.

