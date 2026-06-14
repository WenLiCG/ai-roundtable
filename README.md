# AI Roundtable

AI Roundtable is a web app for multi-model AI discussion. A user asks one question, selects several OpenAI-compatible models, and lets them answer across multiple rounds. After each round, the app stitches successful model answers together as plain reference material and sends it into the next round with a custom prompt. The final result is not merged by the system: each model keeps its own final answer.

## Features

- Select multiple AI models for one discussion
- Run models concurrently or one by one
- Configure max discussion rounds, default 3
- Customize the follow-up prompt used after round 1
- Keep every model's raw answer trace by round
- Show status by default and render full output only after selecting a model
- Stop a running discussion and cancel pending/streaming responses
- Save discussion history in PostgreSQL
- Export Markdown or JSON
- Edit, copy, test, and delete model configurations
- Simple site access password, default `admin`, editable in settings
- Docker Compose setup with PostgreSQL included

## Stack

- Next.js App Router
- TypeScript
- Prisma
- PostgreSQL
- Tailwind CSS
- Vitest
- Playwright

## Quick Start With Docker

Docker is the easiest way to run the app locally.

```bash
docker compose up --build
```

Then open:

```text
http://localhost:3000
```

Default access password:

```text
admin
```

Change it from the Models/Settings page after the first sign in.

The Compose setup starts:

- `postgres` on port `5432`
- `app` on port `3000`

The app runs `prisma db push` automatically when the container starts.

## One-Command VPS Install

On a Debian/Ubuntu VPS with root access, install:

```bash
curl -fsSL https://raw.githubusercontent.com/WenLiCG/ai-roundtable/main/scripts/install.sh | bash -s install
```

The installer:

- clones or updates the repository at `/opt/ai-roundtable`
- installs Docker automatically when Docker is missing
- creates `/opt/ai-roundtable/.env` with fresh database and encryption secrets
- keeps existing `.env` and PostgreSQL data on repeated runs
- starts `app` and `postgres` with Docker Compose

Default URL:

```text
http://YOUR_SERVER_IP:3000
```

Default access password:

```text
admin
```

Change the password from the Models/Settings page after the first sign in.

Update an existing installation:

```bash
curl -fsSL https://raw.githubusercontent.com/WenLiCG/ai-roundtable/main/scripts/install.sh | bash -s update
```

Delete the installation:

```bash
curl -fsSL https://raw.githubusercontent.com/WenLiCG/ai-roundtable/main/scripts/install.sh | bash -s delete
```

The `delete` command stops containers and removes `/opt/ai-roundtable`, but keeps the PostgreSQL Docker volume by default. To delete database data too:

```bash
curl -fsSL https://raw.githubusercontent.com/WenLiCG/ai-roundtable/main/scripts/install.sh | DELETE_DATA=1 bash -s delete
```

Common install/update options:

```bash
# Use another app port
curl -fsSL https://raw.githubusercontent.com/WenLiCG/ai-roundtable/main/scripts/install.sh | APP_PORT=8088 bash -s install

# Stop Docker containers that already publish the selected app port
curl -fsSL https://raw.githubusercontent.com/WenLiCG/ai-roundtable/main/scripts/install.sh | TAKE_OVER_PORT=1 bash -s install

# Reinstall and delete PostgreSQL Docker volume data
curl -fsSL https://raw.githubusercontent.com/WenLiCG/ai-roundtable/main/scripts/install.sh | RESET_DATA=1 bash -s install
```

Useful service commands:

```bash
cd /opt/ai-roundtable
docker compose ps
docker compose logs -f app
docker compose up -d --build
docker compose down
```

## Local Development Without Docker

Create local environment files:

```powershell
copy .env.example .env
copy .env.example .env.local
```

Start PostgreSQL and make sure `DATABASE_URL` points to it. Then run:

```bash
npm install
npm run db:push
npm run dev
```

Open:

```text
http://localhost:3000
```

## Environment Variables

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/ai_roundtable?schema=public"
APP_ENCRYPTION_KEY="replace-with-a-long-random-secret"
NEXT_PUBLIC_APP_NAME="AI Roundtable"
```

`APP_ENCRYPTION_KEY` is used to encrypt model API keys before storing them in the database. Do not reuse the sample value in production.

The site access password defaults to `admin` until it is changed in the app. Password changes are stored as a server-side hash in PostgreSQL.

## Model Configuration

Models must expose an OpenAI Chat Completions compatible API.

Required fields:

- Name
- Base URL, for example `https://api.openai.com`
- API Key
- Model name, for example `gpt-5.4`
- Timeout in milliseconds
- Optional max input character limit

If a provider gives you a full endpoint like `/v1/chat/completions`, it can be used directly. If the Base URL ends with `/v1`, the app appends `/chat/completions` automatically.

## Discussion Flow

Round 1 sends only the original question to each selected model.

Later rounds send:

```text
custom follow-up prompt

reference content:
reference 1
reference 2
reference 3
...
```

The app does not synthesize or summarize between models. It only stitches successful answers and passes them forward.

## API

- `GET /api/models`
- `POST /api/models`
- `PATCH /api/models/:id`
- `DELETE /api/models/:id`
- `POST /api/models/:id/test`
- `POST /api/discussions/run`
- `POST /api/discussions/:id/cancel`
- `GET /api/discussions`
- `GET /api/discussions/:id`
- `GET /api/discussions/:id/export?format=md|json`

`POST /api/discussions/run` returns NDJSON stream events.

## Checks

```bash
npm run lint
npm run test
npm run build
npm run e2e
```

## Deploying To Vercel

1. Create a Vercel project from this repository.
2. Attach a hosted PostgreSQL database, such as Neon or another managed Postgres service.
3. Configure `DATABASE_URL`, `APP_ENCRYPTION_KEY`, and `NEXT_PUBLIC_APP_NAME`.
4. Run `npm run db:push` once against the production database.

For long multi-model, multi-round jobs, Docker/self-hosting is recommended because serverless request time limits can interrupt long discussions.

## License

MIT
