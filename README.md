# Meridian

**One line of sight on every POV: the technical value it proves and the revenue it moves — from discovery, through technical sessions and the Checkmarx One POV, to the win.**

The consolidated view is the default. You can see every opportunity at once, grouped into stage buckets (POV running, POV completed, Technical sessions, Discovery, On hold, Won, Lost). The live POVs come first, each read from its Checkmarx One tenant every 10 minutes. Click an opportunity to drill down into everything about it.

| You get | How |
| --- | --- |
| **Every POV at a glance** | Paste a POV tenant's Checkmarx One API key. The tenant, region and hosts come from the key itself. Every 10 minutes Meridian reads the scans running, finished and failed (with the reason), new projects, open results by severity, credits, and the tenant's AI settings. |
| **Fusion and LAST** | Every scan is marked Fusion, LAST or neither, from its own AI settings (the same logic as CxMissionZero). The counts appear per tenant and across all tenants. |
| **Credits** | Each tenant shows its credits available, used and total. Consumption over the last 30 days is broken down by project, with AI triage and AI remediation actions counted. The consolidated view adds up the credits of every tenant. |
| **Integrations tested, proven** | Each tenant lists where its scans came from (Jenkins, GitHub Actions, Azure DevOps, CLI, IDEs, the web portal…), the engines that ran and the code hosts its projects use. |
| **Success criteria, built in discovery** | Checkmarx One is the source of truth: criteria are agreed in discovery and proven in the tenant. The catalogue follows the Checkmarx One platform:<br>• **Code Security**: SAST, Fusion SAST, LAST, Secrets Detection, IaC Security, API Security<br>• **Supply Chain Security**: Malicious Packages, SCA, Container Security, Repository Health, SBOM<br>• **AI Supply Chain Security**: AI Inventory, LLM Scanner<br>• **Runtime Security**: DAST for AI, DAST<br>• **Checkmarx One Assist agents**: Developer Assist, Triage Assist, Remediation Assist, Checkmarx MCP<br>• **ASPM**: Risk Orchestration, Policy Management, Analytics & Reporting<br>• Source control, CI/CD, CLI/API, IDEs, defect tracking and platform features<br>Each item has its Checkmarx One name, **what to show the customer**, and **how Meridian checks it** (the API and the field read). Evidence found in the tenant shows as **Detected**, and keywords in your notes as **Mentioned**. The SE always confirms a criterion is met. Anyone can add an engine while picking criteria (with the engine name that proves it), and managers can add it to the catalogue for everyone. |
| **People in each POV tenant** | Read from the tenant's IAM: every user, their sign-ins over the last 7 days (where the realm keeps login events), and the scans each person started. Each person shows as active, this week, inactive or never signed in. CI and service accounts are listed too. This needs the key to have IAM read access; without it, only the people who started scans are shown. |
| **The results page and its PDF** | One self-contained HTML page per opportunity. It opens with the **Checkmarx One platform slide, kept exactly as designed**, showing only the engines and agents this POV set out to prove: an engine that was not selected leaves its place empty, and nothing moves. Each engine has its mark: **green tick** when completed successfully (and its name shown bright), **yellow clock** when in progress, a quiet **grey clock** when planned. The golden stars mark the AI-powered capabilities, as on the original slide. Select any engine to open its record: status, when it was agreed, last changed, proven and by whom, when the POV completed, the scans in Checkmarx One that proved it, the evidence, notes, artifact links and its full timeline. The answer, success criteria, what Checkmarx One showed, sessions and next steps follow. **Download PDF** prints every slide, one per page in the slide's own proportions, then one page per engine with its record. |
| **Results pages for every POV** | Every POV with success criteria has its own live results page, made from its own criteria, tenant and timeline. **Results pages** on the Portfolio lists them all (narrowed by the person and stage chosen), each with Open and Download, and **Download all as .zip** gives every page with an index. Each card and line item links to its page. When a POV is marked successful, a **final copy** is kept as it stood then (after a last read of the tenant), so later activity cannot change the record; the Report tab opens or downloads it, and can keep a new one. |
| **Integration flow** | The second page of the results page and the deck: the customer's path from **code** (IDEs and AI coding agents such as Copilot, Cursor, Claude Code) to **commit & PR** (source code management), **build & CI**, **deploy & run** and **track & govern** (defect tracking and posture), with the tools they use at each stage, taken from the success criteria, the tenant's own activity and the discovery. Each stage shows the Checkmarx One engines working there, with their status marks, and what they add, in this POV's numbers (scans per CI tool, projects per code host, AI triage and fixes, Fusion scans, open critical and high). The code scanners sit on the pull request or in the pipeline depending on how the customer works. Any item opens its record. |
| **Demonstrated by the SE** | When a capability was shown by the SE (in their own demo tenant, or on a screen share) rather than completed in the customer's tenant, **Record a demo** on the criterion keeps the date, where it was shown, who saw it, notes, a session recording link and a **short video** (MP4 or WebM, up to 25 MB). Reports mark it **Demonstrated by the SE**, apart from what was completed in the tenant. The video plays inside the results page (it travels in the page, so it also plays in the downloaded file and the final copy) and is not offered as a download. |
| **The final presentation** | Mark a completed POV **successful** and it gets its final deck (.pptx, in the house style): the same platform slide first, then the answer, every criterion with its evidence, what Checkmarx One showed, the sessions and next steps. Download it, or attach it to the completion email sent to the stakeholders. |
| **Teams and RBAC** | People sit in a reporting tree: VP → Leaders → Team leads → Associates. Everyone sees their own work and everything below them. What each role may do (create, edit their team's work, reassign, download logs, send email, manage people or the catalogue) is a matrix an Admin can change. |
| **Macro and micro views** | Associates get detailed cards and managers get line items, grouped by person. Both can filter by person (anywhere in their tree), stage or keyword. Drill down from the team, to one SE, to one opportunity, to one scan. |
| **The whole life cycle** | For each opportunity you can record: <br>• discovery (goals, challenges, tools, environment, the SCM, CI, tracking and IDEs in use, and the capabilities asked for, with one click to turn those into success criteria)<br>• sessions<br>• notes and tasks<br>• stakeholders<br>• Salesforce and SharePoint links<br>Every change is recorded in a history. |
| **Email** | Drafts are written from the opportunity: discovery recap, POV kick-off, weekly status and POV completion. Send them through your SMTP server (with the SE as Reply-To), download them as .eml to send from Outlook, open them in your mail app, or copy them. Every Monday a weekly status draft is prepared for each running POV, and it is never sent automatically. |
| **Report** | A success-criteria report you can print to PDF. It shows the answer first, then every criterion with its evidence, the sessions held and what the tenant showed. |
| **Troubleshooting from one place** | Download any scan's engine log, or a single bundle containing every failed scan of the last 7 days with its logs. You no longer need to sign in to ten tenants. |
| **Mute** | Mute a POV's alerts for an hour, a day, a week or until you unmute it, or mute individual noisy projects. |
| **Forecasts** | From what is already known, with no extra calls to Checkmarx One:<br>• **POV pace:** whether each POV will complete its success criteria by its end date at the current pace (projected date, days to spare or late, pace still needed)<br>• **Credits runway:** how many days each tenant's credits last at the recent burn<br>• **Scanning momentum:** whether scanning is speeding up or slowing down<br>The **Forecast** strip adds these up across every POV shown: on track, at risk, late, finishing this month, shortest credits runway and next POV end. Each card shows its ring gauge and forecast; line items have a Forecast column. |
| **Salesforce, without its API** | **In:** drop a Salesforce opportunities report (.xlsx or .csv) on the Portfolio, or have Salesforce mail it daily to a mailbox Meridian reads (Settings → Salesforce). Each row is matched to its POV by the Opportunity ID in the POV's Salesforce link, and its stage, amount, close date, probability and next step appear beside the POV. Insights then show the pipeline carried by POVs, weighted by each POV's outlook, and gaps where Salesforce and the POV disagree (Salesforce lost while the POV runs, a close date before the POV ends or already past). **Out:** each SE adds their private Email to Salesforce address (Profile). Meridian copies it on the POV emails they send, and sends Salesforce tasks, notes, stage changes, the POV status and the result as activities. Nothing is ever written to Salesforce any other way. |
| **Audit trail** | Every change (in words: who changed what, on which POV) and every request — reads included, with who, when, from which address and device, what, which POV and how it ended; sign-ins and failed ones — kept and provable. Each record carries the fingerprint of the one before, so a removed or changed record shows; records are encrypted; changes are kept for good, requests for `CC_ACCESS_DAYS` (730 by default). **Audit** (Admins, VPs and leaders, permission `audit.view`) shows it with search, filters and CSV export; each person sees what they and their team did, Admins everything. |
| **Self-sustaining** | Every record, snapshot, results page and demo video is encrypted at rest (AES-256). Writes are atomic and flushed; a damaged record repairs itself from its previous copy or the newest backup. Checked backups every 6 hours (and before every update and restore), optionally copied off the server, restorable with one click and an undo. A watchdog restarts a stalled reader or a server using too much memory; the launcher restarts a crashed one and rolls back an update that does not start. **Settings → System & backups** shows the health checks and what was corrected. |
| **Looks** | **Orbit** (the default): launch control. Deep space, glass instruments edged with light, telemetry in a mono face (JetBrains Mono, Space Grotesk, Inter), cyan and plasma-violet signals, in dark or daylight. Also: four house looks after the craft of the great houses, never their marks: **Maison** (the leather atelier: espresso, cognac, brass, saddle stitching; the default), **Calibre** (fine watchmaking: midnight dial, guilloché, white gold), **Joaillier** (high jewellery: crimson and gold filets) and **Hypercar** (racing blue on carbon). Eight plainer looks are also available. Every look comes in light, dark or automatic mode. The typefaces (Cormorant Garamond, Jost, Syncopate; SIL Open Font License) are bundled, so nothing loads from the internet. |

Meridian reads from Checkmarx One. The only changes it makes to a tenant are AI triage and remediation, and only when a person plans them, sees the credits they cost and confirms. API keys, passwords and Email to Salesforce addresses are never sent back to the browser.

## Run it

### Container (recommended)

```bash
docker compose up -d
```

```bash
docker compose logs meridian
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
| `PORT` / `HOST` | `4310` / `127.0.0.1` (`8443` / `0.0.0.0` in the container) | |
| `CC_DATA_DIR` | `./data` (`/data` in the container) | Everything kept: users, opportunities, snapshots, outbox |
| `CC_SECRET` or `CC_SECRET_FILE` | key file in the data folder | The key everything is encrypted with: a passphrase, or a file holding one (a Docker/Kubernetes secret). Keep it off the data volume and in your password vault: backups cannot be read without it. |
| `CC_BACKUP_DIR` | none | A mounted share or second disk: every backup is copied there too |
| `CC_BACKUP_HOURS` | `6` | How often the automatic backup runs |
| `CC_MAX_RSS_MB` | `1536` | Memory above this for 3 minutes: a clean restart |
| `CC_PUBLIC_URL` | none | Meridian's address, so Salesforce activities link back to the POV |
| `CC_ACCESS_DAYS` | `730` | How long every request stays in the audit trail (changes are kept for good) |
| `CC_TRUST_PROXY` | `false` | `true` behind a reverse proxy, so the audit trail records the person's address from X-Forwarded-For |
| `CC_UPDATE_TOKEN` or `CC_UPDATE_TOKEN_FILE` | none | A read-only GitHub token (fine-grained, *Contents: read* on this repository). Needed while the repository is private; sent to api.github.com only |
| `CC_UPDATE_REPO` | `cxsmtp/CommandCenter` | Where releases come from |
| `CC_ADMIN_EMAIL` / `CC_ADMIN_PASSWORD` | `admin@meridian.local` / random, printed once | The first Admin |
| `REFRESH_MINUTES` | `10` (also under Settings → Organisation) | How often running POV tenants are read |
| `HTTPS` | `on` in the container image | `on`: Meridian serves HTTPS itself (cookies always Secure); `off`: plain http behind a reverse proxy that does HTTPS |
| `TLS_CERT_FILE` + `TLS_KEY_FILE`, or `TLS_PFX_FILE` | none: a self-signed certificate in `<data>/tls` | Your certificate (PEM with its chain, or .pfx; `TLS_KEY_PASSPHRASE` / `TLS_PFX_PASSPHRASE`). Re-read when renewed, no restart |
| `TLS_HOSTNAMES` | this machine | The names (and IPs) the self-signed certificate covers, e.g. `meridian.company.com,10.1.2.3` |
| `CC_SECURE_COOKIES` | `false` | `true` when plain http sits behind an HTTPS proxy |
| `CX_MAX_CONCURRENCY`, `CC_MAX_SCANS`, `CC_MAX_PROJECTS` | `8`, `500`, `500` | Limits per tenant read |

Backups are taken and checked by Meridian itself (Settings → System & backups). They never contain the key: to restore on another server, give it the same `CC_SECRET` / `CC_SECRET_FILE`.

## Updates: every push to main, installed by itself

Like the FTR command center: every push to `main` is tested and published as a release (`.github/workflows/release.yml`; the version is made from the commit count, `1.0.<n>`, so nobody bumps it by hand). Each server started by the launcher (the container image or `npm start`) checks every 15 minutes and installs a new release as soon as it finds it: the download is checked against its SHA-256 (and signature, with `CC_UPDATE_PUBKEY`), a checked backup is taken, and the server restarts into it in a few seconds. A version that does not start is rolled back by itself and never tried again; going back by hand holds that version back until a newer one comes. Auto-update is on by default; Settings → System & backups turns it off or changes how often it checks.

## Checkmarx One calls (all read-only)

The IAM token is obtained with the API key (refresh-token grant, client `ast-app`). After that the calls are: `GET /api/projects`, `/api/scans` (last 7 days, and queued/running), `/api/projects/last-scan`, `/api/scan-summary`, `/api/credits/info`, `/api/credits/consumption`, `/api/configuration/tenant`, the IAM users and login events (`{iam}/auth/admin/realms/{tenant}/users` and `/events`, which need IAM read access), and `/api/logs/{scanId}/{engine}` (on request). The authentication and API client come from CxMissionZero (`src/cxone/`).

## Develop

```bash
npm test
```

There are no build steps. The front end is plain ES modules in `public/`. See [docs/DESIGN.md](docs/DESIGN.md) for how it is put together and why.
