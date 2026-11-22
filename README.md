# elimuNest

Multi-tenant school management platform: admissions, timetable scheduling, attendance, exams, fees and finance, real-time communications and analytics.

## Run locally

```bash
npm install
cp .env.example .env      # then fill in the values you need
npm run dev               # http://localhost:3000
npm test
```

On first start in development the app creates `data/elimunest-db.json` and fills it with the sample schools. The one-time demo passwords are printed in the terminal (a change is required on first login).

## Where the data lives

| What | Where | In git? |
| --- | --- | --- |
| **Sample schools** (Oakridge Preparatory, Westfield, St Jude: students, fees, exams, timetable, finance) | `server/seed.ts` | Yes |
| **Live database** | `<DATA_DIR>/elimunest-db.json` (default `./data`) | No |
| **Daily backups** (last 7) | `<DATA_DIR>/backups/` | No |
| **Manual exports** | `<DATA_DIR>/exports/` | No |

The live database holds password hashes and real school records, so it is deliberately kept out of git. The sample schools are code, so they travel with every clone and deploy and are never lost.

Sample data is only loaded when **no database exists yet**, so it can never overwrite real data. Whether that happens is controlled by `SEED_DEMO_DATA`:

| `SEED_DEMO_DATA` | Development | Production |
| --- | --- | --- |
| unset | loads samples | starts empty |
| `true` | loads samples | loads samples |
| `false` | starts empty | starts empty |

### Signing in to the sample schools

Each time the samples are loaded, every sample account gets a new random one-time password, printed in the server log. That is awkward on Vercel, where the samples reload on every cold start. Set `SEED_DEMO_PASSWORD` (10+ characters, letters and digits) and all sample accounts use it instead, e.g. `helena.vance@oakridge.ac.ke` for Oakridge. They still ask for a password change on first login. The Developer account keeps its own `DEVELOPER_BOOTSTRAP_PASSWORD`.

## Data commands

```bash
npm run data:status                              # what's in the database, backups and exports
npm run data:export                              # full copy to <DATA_DIR>/exports/
npm run data -- import <file> --yes              # restore an export or backup
npm run data:reset-sample -- --yes               # replace the database with the sample schools
```

`import` and `reset-sample` save the current database first as `<DATA_DIR>/backups/elimunest-db.pre-<action>.<timestamp>.json` (never pruned). **Stop the server before running them.**

Before moving machines or wiping a disk, run `npm run data:export` and keep that file somewhere private. The same export and restore are available in the Developer panel (`/api/dev/database/restore`).

## Deploying

- **Render** (`render.yaml`): data is stored on the persistent disk at `/var/data`. Set `AUTH_SESSION_SECRET` (32+ random characters), `GEMINI_API_KEY`, `APP_URL` and `DEVELOPER_BOOTSTRAP_PASSWORD` in the dashboard. `SEED_DEMO_DATA=true` loads the sample schools on the first boot only; set it to `false` before onboarding real schools if you don't want demo tenants.
- **Vercel**: the filesystem is temporary, so connect a Vercel KV / Upstash Redis store (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) or data will not survive a cold start. Set `SEED_DEMO_DATA=true` to have the samples loaded into it.
