# CommandCenter

**One place for a Solution Engineering team to run every opportunity: from discovery, through technical sessions and the Checkmarx One POV, to the win.**

The consolidated view is the default. You can see every opportunity at once, grouped into stage buckets (POV running, POV completed, Technical sessions, Discovery, On hold, Won, Lost). The live POVs come first, each read from its Checkmarx One tenant every 10 minutes. Click an opportunity to drill down into everything about it.

| You get | How |
| --- | --- |
| **Every POV at a glance** | Paste a POV tenant's Checkmarx One API key. The tenant, region and hosts come from the key itself. Every 10 minutes CommandCenter reads the scans running, finished and failed (with the reason), new projects, open results by severity, credits, and the tenant's AI settings. |
| **Fusion and LAST** | Every scan is marked Fusion, LAST or neither, from its own AI settings (the same logic as CxMissionZero). The counts appear per tenant and across all tenants. |
| **Credits** | Each tenant shows its credits available, used and total. Consumption over the last 30 days is broken down by project, with AI triage and AI remediation actions counted. The consolidated view adds up the credits of every tenant. |
| **Integrations tested, proven** | Each tenant lists where its scans came from (Jenkins, GitHub Actions, Azure DevOps, CLI, IDEs, the web portal…), the engines that ran and the code hosts its projects use. |
| **Success criteria from a catalogue** | The catalogue covers more than 50 Checkmarx One touch points: scanners (SAST, SCA, IaC, containers, API, secrets…), AI (Fusion, LAST, AI supply chain, AI triage and remediation, Developer Assist), source control, CI/CD, CLI/API, IDEs, defect tracking and platform features. Each entry gives the name Checkmarx One uses and how it is recognised. Evidence found in the tenant shows as **Detected**, and keywords found in your notes show as **Mentioned**. The SE always confirms a criterion is met. You can edit the mapping under Capabilities. |
| **Teams and RBAC** | People sit in a reporting tree: VP → Leaders → Team leads → Associates. Everyone sees their own work and everything below them. What each role may do (create, edit their team's work, reassign, download logs, send email, manage people or the catalogue) is a matrix an Admin can change. |
| **Macro and micro views** | Associates get detailed cards and managers get line items, grouped by person. Both can filter by person (anywhere in their tree), stage or keyword. Drill down from the team, to one SE, to one opportunity, to one scan. |
| **The whole life cycle** | For each opportunity you can record: <br>• discovery (goals, challenges, tools, environment, the SCM, CI, tracking and IDEs in use, and the capabilities asked for, with one click to turn those into success criteria)<br>• sessions<br>• notes and tasks<br>• stakeholders<br>• Salesforce and SharePoint links<br>Every change is recorded in a history. |
| **Email** | Drafts are written from the opportunity: discovery recap, POV kick-off, weekly status and POV completion. Send them through your SMTP server (with the SE as Reply-To), download them as .eml to send from Outlook, open them in your mail app, or copy them. Every Monday a weekly status draft is prepared for each running POV, and it is never sent automatically. |
| **Report** | A success-criteria report you can print to PDF. It shows the answer first, then every criterion with its evidence, the sessions held and what the tenant showed. |
| **Troubleshooting from one place** | Download any scan's engine log, or a single bundle containing every failed scan of the last 7 days with its logs. You no longer need to sign in to ten tenants. |
| **Mute** | Mute a POV's alerts for an hour, a day, a week or until you unmute it, or mute individual noisy projects. |
| **Looks** | Eight looks (Command, Cabin, Circuit, Residence, Chronometer, Signal, Studio, Classic), each in light, dark or automatic mode. Each person picks their own, and the Admin sets the default. |

CommandCenter only reads from Checkmarx One and never changes anything in a tenant. API keys and the SMTP password are encrypted at rest (AES-256-GCM) and never sent back to the browser.

## Run it

### Container (recommended)

```bash
docker compose up -d
```

```bash
docker compose logs commandcenter
```

Open http://localhost:4310 and sign in with the Admin password shown in the log. You will be asked to choose your own password. Set `CC_SECRET` (see `.env.example`) to a long random value. Behind an HTTPS reverse proxy, also set `CC_SECURE_COOKIES=true`.

### Node.js 20+

```bash
npm ci && npm start
```

It listens on 127.0.0.1:4310. Set `HOST=0.0.0.0` to share it, and `CC_DATA_DIR` to choose where data is kept (`./data` by default).

### Try it without a real tenant

```bash
npm run demo
```

This starts a made-up team (VP, leader, two team leads, four SEs) with opportunities at every stage and four POV tenants on a local mock of Checkmarx One. Sign in as `vp@demo.local`, `tl1@demo.local`, `se1@demo.local` or `admin@demo.local`, all with the password `demo-password`.

## Settings

| Variable | Default | |
| --- | --- | --- |
| `PORT` / `HOST` | `4310` / `127.0.0.1` (`0.0.0.0` in the container) | |
| `CC_DATA_DIR` | `./data` (`/data` in the container) | Everything kept: users, opportunities, snapshots, outbox |
| `CC_SECRET` | key file in the data folder | Seals API keys and the SMTP password |
| `CC_ADMIN_EMAIL` / `CC_ADMIN_PASSWORD` | `admin@commandcenter.local` / random, printed once | The first Admin |
| `REFRESH_MINUTES` | `10` (also under Settings → Organisation) | How often running POV tenants are read |
| `CC_SECURE_COOKIES` | `false` | `true` when served over HTTPS |
| `CX_MAX_CONCURRENCY`, `CC_MAX_SCANS`, `CC_MAX_PROJECTS` | `8`, `500`, `500` | Limits per tenant read |

Backups: copy the data folder (with `CC_SECRET`, or with its `secret.key`).

## Checkmarx One calls (all read-only)

The IAM token is obtained with the API key (refresh-token grant, client `ast-app`). After that the calls are: `GET /api/projects`, `/api/scans` (last 7 days, and queued/running), `/api/projects/last-scan`, `/api/scan-summary`, `/api/credits/info`, `/api/credits/consumption`, `/api/configuration/tenant`, and `/api/logs/{scanId}/{engine}` (on request). The authentication and API client come from CxMissionZero (`src/cxone/`).

## Develop

```bash
npm test
```

There are no build steps. The front end is plain ES modules in `public/`. See [docs/DESIGN.md](docs/DESIGN.md) for how it is put together and why.
