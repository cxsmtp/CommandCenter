# Kendra version log

Every release, newest first: the version shown at the bottom of the menu, the day it was published, and what it changed. Settings → Update & recovery shows the same notes for each version.

## 1.0.74 · 2026-11-25

**Portfolio: the tenant's licence start and end dates**

Read from the access token's ast-license claim (activation and expiration dates) with every
tenant read. Two new Portfolio columns, Tenant start and Tenant end, with the days left; amber
within 14 days or when the licence ends before the POV does. The POV's own dates are now
POV start and POV end. New default columns also appear for people who chose their columns.

## 1.0.73 · 2026-11-25

**Linked sign-in: no temporary-password prompt for someone the FTR command center vouched for**

As with single sign-on, a person signed in through the linked app is not asked to replace
a temporary password they may not know.

## 1.0.72 · 2026-11-25

**Linked apps: one sign-in for Kendra and the FTR Credits Command Center**

The menu has an FTR command center item that opens it already signed in, and the
sign-in screen first asks the FTR command center (once) so someone signed in there
arrives signed in here. Each hop carries a pass signed with a shared key (HMAC-SHA256),
for one app, good for a minute and used once; nobody is created by it. Admins set the
address and the key (sealed, shown once) in Settings > Linked apps.

## 1.0.71 · 2026-11-25

**Insights says what it is: Kendra's score of each POV's chance of success, not a sales forecast**

- "Commit / Best case / Pipeline" (sales-forecast words, misleading here) are now "Likely to succeed / At risk /
  Unlikely", "Expected wins" is "Expected successes", and the panel is "Where the POVs are heading".
- The page says how the score is made and that it is not a sales forecast.
- Amounts appear only when a Salesforce report has been imported by hand, and every one says so: "Amount at stake,
  from the report imported <date>"; "Amount (report)" in the roll-up. Kendra does not read Salesforce; with no report
  imported, no amount is shown anywhere.

## 1.0.70 · 2026-11-24

**Insights rebuilt for leaders; leaders land on Insights, SEs on the Portfolio; pages fit the window**

- Insights, one screen, after Clari, Gong, Salesforce and Vivun: six figures with their change since last week
  and a 30-day line (commit, best case, expected wins, weighted pipeline, technical win rate, critical gaps); then
  Needs attention (at risk, the week's movers with why, common gaps), Forecast (commit / best case / pipeline with
  amounts, and what ends in 30 days), and Team (SE workload: running, ending, open must-haves, average score,
  stretched / busy / has room; the roll-up by region, team, SE or tenant region; and which capabilities are
  proven where tested, the lowest first). Lists scroll inside their panel. A reading of every POV is kept each
  day (120 days) for the week's change and the movers.
- Where Kendra opens: Insights for Admins, VPs, leaders and team leads; the Portfolio for SEs; anyone can choose
  in Settings -> Profile ("Kendra opens on").
- Less scrolling on a desktop: Capabilities in four tabs; Audit, Portfolio list and capabilities scroll inside
  their panels with headings in view; Settings in two columns (health problems first, healthy checks one line
  each); the POV page's criteria in two columns, results side by side, AI runs side by side; closed folds take no
  room (they were counted in the page's height).

## 1.0.69 · 2026-11-24

**The Kendra logo: menu, sign-in, About, and the browser tab icon, with what the name means**

The round lion mark, cropped to its circle, replaces the old mark in the menu and on the sign-in screen, and is the
browser tab icon (favicon.ico, 32 and 64 px, 192 px, and the phone home-screen icon). Hovering the mark says what
the name means: Kendra (केन्द्र, Sanskrit for "centre"): the centre for the best solution engineers to manage the
growth. About shows it too.

## 1.0.68 · 2026-11-24

**Settings like CxMissionZero: grouped menu, Security, Network & certificates, Update & recovery, About**

- Settings is a side menu grouped by subject (You, Organisation, Connections, Server, About), each page titled.
- Security & sign-in: how long a sign-in lasts and the attempts before a pause, and how sign-in is protected.
- Network & certificates: the company proxy (user, password, NO_PROXY; save and restart), the sheet of what the
  network must allow (copy or download), trusted certificates (add a PEM, see who added it, remove), and a
  "restart to apply" notice.
- Update & recovery: running version and Check now; keep up to date; every release with its notes, installed or
  switched to in one click; recent events (installs, rollbacks, crashes, integrity); restart the server; the
  troubleshooting report; and Software integrity: "Genuine" when every running file matches what was installed,
  checked at start, every 6 hours and on demand, a health check that emails the Admins when files change.
- Health & backups: a "Run a restore drill" button.
- About (everyone): version, organisation, running since, where releases come from, and how the data stays yours.
- The version shows at the bottom of the menu on every screen, opening Update & recovery (About for others).
- Releases carry their commit message as notes; CHANGELOG.md lists every release (scripts/changelog.mjs).

## 1.0.67 · 2026-11-24

**Portfolio table view for admins; points of contact picked from the tenant's people**

- Portfolio: a Table view next to the List (the default for everyone but associates, or as set in Settings ->
  Profile): a heading on every column, sorted by a click, a filter under each heading (a choice, text, or a
  number like >5, <10, =0), columns to show or hide (SE, manager, region, stage, dates, days left, criteria,
  must-haves, tenant, scans, findings, users, credits, AI time saved, outlook, health, what is going on, next task,
  Salesforce stage and amount, last note), and Export CSV of exactly what is shown. Rows open the POV.
- POV -> Customer -> Stakeholders: "Add from Checkmarx One" lists the people the tenant knows (its IAM and who
  scanned), most recently active first, to tick with their POV role and side (internal when they share the SE's
  email domain); those already on the POV are shown and kept.

## 1.0.66 · 2026-11-24

**Renamed Kendra**

Everything people see says Kendra: the app, its pages and emails, the decks and reports, the docs. The default
presentation template is "Kendra standard" (next to "Version Kendra"). An organisation name saved as the old product
name reads as Kendra. Kept on purpose so running servers carry on: the release file the updater fetches, the
installed-files manifest, the data folder, cookies, and the old request header (still accepted next to the new one);
the first Admin's sign-in stays admin@meridian.local.

## 1.0.65 · 2026-11-24

**Evidence from Checkmarx One in the appendix; repositories and DAST/API targets in the plan**

- "Evidence from Checkmarx One" (appendix, its own divider): what the portal's pages show, drawn from the tenant's
  numbers instead of photographed: integrations in use (where scans came from, developers by tool, repositories by
  host, feedback apps), triage (findings by state, share triaged, AI actions, custom states), supply chain and
  governance (open findings by severity, malicious packages, policies and violations, SSO, groups, applications),
  and scan activity (completed scans per day by engine). Each slide only when there is something to show, each
  stamped with when Checkmarx One said it. In the results appendix of every built-in template, and Chakra's WIP.
- Plan dialog, Environment: repositories in scope, and DAST and API targets (shown by the RW report).

## 1.0.64 · 2026-11-24

**Chakra presentation template, POV screenshots, and the RW report on the WIP panel**

- Chakra (built in, under Customer presentations): the team's POV WIP order. Cover, DevSecOps, components, APMA,
  plan, environment, the test plan per business goal, the POV screenshots; then the appendix with the meeting
  notes, and the closing slide last. The results deck adds "What the POV changed" and the evidence.
- POV screenshots (WIP panel): PNG or JPEG pictures from the tenant, several at once, named "Checkmarx ONE –
  caption", renamed, moved up or down, removed; kept encrypted. A "POV screenshots" slide key (a divider, then
  each picture fitted under its title, never stretched) any template can place.
- The closing slide can be placed anywhere, the last slide of the appendix included.
- The RW report: Open and Download on the WIP panel too; it uses the POV's own Scope, Support and Success lines.
- The sample script adds two made-up screenshots and writes the Chakra decks.

## 1.0.63 · 2026-11-24

**Status centred in its cell, across and down, with its column header**

In every criteria table: the Meridian, Version Kendra and Classic decks, the results page and the success-criteria
report. Classic's criteria table now uses the same colours (planned yellow, in progress amber).

## 1.0.62 · 2026-11-24

**What the POV changed, from the Analytics dashboard; status colours without dots or reds**

- The hourly read asks the Analytics dashboard what the portal asks (mean time to resolve by severity, findings by
  age, by state, scans, projects, lines of code) for the POV's projects (muted ones left out), over 30 days or 90
  for a longer POV. Its first answer is kept as the POV's start.
- "What the POV changed": six tiles (scans, projects, lines of code, critical fix time, share triaged, findings
  fixed), with the start where it moved, in the results page, the Meridian and Version Kendra decks (main deck) and
  Classic; "Fix time and ageing" charts in the appendix. Both are slides any template can place.
- The Analytics & Reporting criterion shows the dashboard's numbers as its evidence.
- Status colours everywhere: no dot before the label; completed green, in progress amber, planned yellow, not met
  grey; no reds (the APMA "today" line and the critical ageing bar are violet).

## 1.0.61 · 2026-11-24

**The RW report (the POV guide as one page) and the Version Kendra presentation template**

- RW report (Report tab: Open / Download HTML; also publishable to SharePoint): the POV guide's layout, filled from
  the POV: cover with dates, duration and status; the goals strip; the toolchain with the SDLC phases it covers;
  the platform components with the criteria that test them (select one to filter the test plan); scope, support,
  success and the timeline, approval gates lettered; the team by side with POV roles; environment and integrations;
  and the test plan: each business goal (with value driver and measures from SEAL) and its criteria numbered 1.1,
  1.2…, with test item, benefit, milestone, the customer's tracker references and status. Unknown values show as
  "To confirm". Served with a script nonce; light and dark themes.
- Version Kendra (built in, under Customer presentations): Meridian's slides with every engine and touch point,
  plus two new slides any template can use: Business goals at a glance, and each goal with its numbered success
  criteria, milestones and tracker references.
- The sample decks script also writes the Version Kendra decks and the RW report.

## 1.0.60 · 2026-11-24

**Admins edit the business goals and success criteria in Meridian; criteria carry milestone and tracker references**

- Settings -> Capabilities: "Edit the business goals and success criteria" (Admins only): every goal (title,
  statement, value driver, success measures) and its criteria (criterion, test item, benefit, the capability that
  proves it), added, changed or removed. The bank in force (SEAL library, import or built-in) is copied once, then
  edited; whichever is newer wins, so importing the SEAL files again replaces the edits. Every change is audited.
- A POV's criterion form now has Test item, Benefit, Milestone and the customer's tracker references.
- A new meeting type: Approval gate.

## 1.0.59 · 2026-11-24

**LLM Scanner recognised as the aisc engine; MCP and Skills Scanners marked as not released yet**

- The LLM Scanner runs inside AI Supply Chain: a scan that ran aisc proves it.
- Saved catalogues now take engine names added to built-in rules since they were saved.
- MCP Scanner and Skills Scanner: their rules stay, with a note that they are not released yet.

## 1.0.58 · 2026-11-24

**SBOM evidence made from the tenant; AI Inventory read from it**

- POV page, Tenant: "Download an SBOM" (CycloneDX or SPDX) makes one from the newest completed SCA scan the way the
  SCA results page exports it (POST /api/sca/export/requests, wait, download). The file is the SBOM criterion's
  evidence; the export is written to the audit trail.
- AI Inventory: AI assets listed in GET /api/ai-sc/global-inventory/results prove the criterion; "aisc" is confirmed
  as the engine's name.

## 1.0.57 · 2026-11-24

**Developers by tool, Checkmarx MCP, scheduled scans read from the tenant**

- GET /api/contributors/insights: developers counted per tool they use Checkmarx from (VS Code, JetBrains, Cursor,
  Claude, Copilot, Kiro, CLI…) now prove the IDE, coding-agent and CLI criteria ("19 developers use Checkmarx from
  Cursor"). Versions folded; an exact name wins over a partial one.
- Checkmarx MCP: risks found through it (origin "security-mcp" in GET /api/risks) count, not only scans.
- Scheduled scans: a new criterion, from active schedules in GET /api/projects/schedules.

## 1.0.56 · 2026-11-24

**Malicious Packages read from the tenant: supply chain risks on each project's latest SCA scan**

As the SCA results page asks for them (POST /api/sca/graphql/graphql, supplyChainRisksByScanId), for up to 20 of the
latest scans, hourly. The criterion says how many projects were checked and how many malicious or suspicious
packages were found. Counts only.

## 1.0.55 · 2026-11-24

**Manual triage proven from the tenant: findings moved to Confirmed, Urgent or Not exploitable**

The state counters of every project's latest scan (GET /api/scan-summary), already read, now prove the triage
criterion: findings a person moved to Confirmed, Urgent or Not exploitable. AI triage's proposals do not count.

## 1.0.54 · 2026-11-24

**SSO, LDAP, groups, custom triage states and presets read from the tenant**

From browser recordings of the Identity & Access pages: identity providers and LDAP directories through the IAM's
Keycloak admin API (where the key may read it), groups from GET /api/access-management/groups, the customer's own
triage states (GET /api/custom-states) and SAST presets (GET /api/queries/presets, built-in ones have small ids).
Kinds and counts only.

## 1.0.53 · 2026-11-24

**Feedback apps read from the tenant: Jira, Azure Boards, ServiceNow, email, Slack, Teams**

From a browser recording of the Feedback Apps pages: GET /api/feedback-app/v2/apps (the apps and their kind) and
/v3/profiles (appsIds to projectsIds), so a criterion says "A Jira feedback app is set up, used by 3 projects".
Counts only, no app or profile names. The kind is read from whichever type field the release uses, as the recording
kept no response bodies to confirm it. Saved catalogues pick up the new explanations.

## 1.0.52 · 2026-11-24

**Policy Management read from the tenant: policies applied to projects, break build, violations**

From a browser recording of the Policy Management pages: GET /api/policy_management_service_uri/policies/v3 (the
policies made, not the default one) and .../incidents/total (violations). Counts only. The list is read whatever its
wrapper, as the recording kept no response bodies to confirm it.

## 1.0.51 · 2026-11-24

**Product icons on the toolchain slide; ASPM, Cloud Insights and DAST read from the tenant for success criteria**

- Tailored to Your DevSecOps: every tool with its logo (Simple Icons, CC0) or a lettered tile, white on the orange
  pill when in use; long names sized to one line. scripts/build-tool-icons.mjs rebuilds src/tool-icons.js.
- Template pour: the media folder entry of a pptxgenjs file no longer takes every picture with it.
- The hourly read now asks what the portal's ASPM pages ask (from browser recordings): applications, Application
  Risk Management scores, Risk Orchestration risks, Cloud Insights accounts, DAST environments. Counts and dates
  only: no names, and DAST login settings are never kept. Each part is optional.
- New criteria: Application Risk Management, Cloud Insights; Risk Orchestration and DAST are now detected.
  Saved catalogues pick up the new rules.
- Updater: a dropped connection is tried once more (also cures a flaky test).

## 1.0.50 · 2026-11-24

**Housekeeping like MZ: verified installs, a rotating server log, a weekly restore drill, clock and session-expiry warnings**

- An installed version keeps a SHA-256 manifest of its files; the launcher checks it before starting and falls back to
  the image's own version when anything changed (recorded as an 'integrity' event).
- Errors (500s, watchdog corrections, crashes) go to data/logs/server.log, rotated at 10 MB, three kept; the
  troubleshooting report carries its last lines.
- Every week the newest backup is restored into a scratch folder and read back (POST /system/drill runs it now);
  Settings -> System shows when it last passed.
- The server's clock is compared with GitHub's; more than five minutes off is a warning.
- The browser peeks at the session without renewing it and shows "Stay signed in" five minutes before it ends.

## 1.0.49 · 2026-11-24

**Presentation templates: managers compose the decks slide by slide and choose what customers see**

- A presentation template holds a design (the team's PowerPoint, or Meridian's), the slides of the WIP deck and of
  the final report (main deck or appendix, in order) and its own words (Support and Success lines, the closing line)
- Every slide can be placed, including Meridian's own versions next to the template's: the toolchain with every
  touch point, the plan with every meeting, the environment in full, the test plan with rows sized to their text
  (in the appendix by default)
- Managers make and edit them on the Capabilities page, for their team or (VPs, leaders, Admins) for everyone, and
  set the one their team's decks are shared with customers in; Admins set the organisation's
- A POV uses its own choice (Results tab), else its SE's nearest manager's, else the organisation's; the template
  uploaded before becomes the first one, the organisation's default

## 1.0.48 · 2026-11-24

**Team decks: the Classic platform slide after the cover; every product on the components slide**

- The Classic deck's first slide (AppSec for the Age of AI-Generated Risk) now opens the team decks too
- CheckmarxOne components is drawn in the template's language with every product of the catalogue in its section
  (Fusion SAST, LAST, SBOM, the AI supply chain scanners, DAST for AI, Checkmarx MCP and policy management
  included): each a chip of known size, so the highlight always fits; activated in orange, met with a tick
- The plan slide's customer and champion take the template's orange

## 1.0.47 · 2026-11-24

**Final report on the team template's own slides**

The main deck is the template, slide for slide, filled with the POV: the cover (the customer's name sized to one
line, who prepared it, when), the toolchain and platform slides with this POV's items boxed (each box measured from
the item's own icon and the width of its words), plan and timeline (the goals, the real launch, check-in and wrap-up
dates, the champion), the environment details (people and POV roles, dates, duration, solutions, tenant, the
integrations), and the test plan per business goal (the goal's number and statement; criteria with the result
under each, test item, benefit; six rows a page, cloned from the template's own row). Filled cells take the
template's style and run left to right. Everything Meridian adds goes to the appendix.

## 1.0.46 · 2026-11-24

**Final report in the team template: crisp story, evidence in the appendix, the template's own slides**

- Business-goal tables use the template's columns everywhere: Criteria, Test item, Benefit, Result
- The results deck tells a short story: your challenges answered (their words against what was proven, and the
  value), results at a glance, the platform, one slide per business goal, proof to rollout, next steps; the detail
  goes to the appendix: toolchain, APMA, how we got here, the tenant, environment, evidence for every criterion
  (what proved it, the proving scans, when confirmed) and the meeting notes
- When the template has its own toolchain or platform-components slide, that slide is used as designed and this
  POV's tools and engines are boxed in orange (found through the layout's groups; the template's example boxes go)
- Ordinary slides take the template's cleanest layout, never one that draws a diagram, table labels or dividers

## 1.0.45 · 2026-11-24

**Platform slide: auto-aligned, no gaps, one straight header line**

In the deck and the results page alike: every column's items stack from the top with one spacing for all three
columns, so rows line up across the slide and an engine not in the POV leaves no hole; the three headers and their
rules sit on one line; sparkles and status marks run inline with their titles instead of being placed at a guessed
text width (PowerPoint measures text differently); a title without a line under it is centred on its icon.

## 1.0.44 · 2026-11-24

**Decks as PowerPoint draws them**

Checked slide by slide in PowerPoint: the platform slide no longer brings its own footer band and page number into
the team decks (the template's footer shows), the Classic deck's small headings are spaced as intended (PowerPoint
draws letter spacing far wider than LibreOffice), and its success-criteria pages hold 10 rows so the last never
touches the footer.

## 1.0.43 · 2026-11-24

**scripts/sample-decks.mjs: the three decks for a made-up POV, to check in PowerPoint**

## 1.0.42 · 2026-11-24

**A script to see decks exactly as PowerPoint draws them**

## 1.0.41 · 2026-11-24

**Troubleshooting report, crash history, a cap on live-update streams**

Settings → System downloads one report with the health checks, the version history (launcher crashes included),
corrections, repairs, recent server errors, memory, disk and sign-ins, never a secret. A person's live-update
streams are capped, so a browser stuck reconnecting cannot use up the server.

## 1.0.40 · 2026-11-24

**Backups: link what never changes, back up on every stop, restore at the next start**

Sealed audit days, demo videos and final results are linked into each backup with their checksum carried over,
so videos are not copied or read again every 6 hours. A backup is taken on every update, restart and watchdog
restart. A restore is staged and put in place at the next start, before any record is read, instead of under a
running server.

## 1.0.39 · 2026-11-24

**Hands-off running, after CxMissionZero**

- One server per data folder: a second copy on the same data refuses to start (a dead one's lock is taken over)
- Start-up checks: half-saved files from a crash are cleared, low disk space is said loudly
- /healthz reads and writes the data, and says 'restarting' while draining
- The Admins are emailed when a health check is bad twice in a row, when it works again, and when the server fixed
  something by itself (at most every 6 hours)
- The HTTPS certificate's expiry is checked (warn at 30 days, bad at 7)
- A release that needs a newer Node.js is not installed, and says to update the image
- A new version is on trial for 2 minutes after it first answers: a crash in that time rolls it back; the
  'crashing on every start' rollback only applies to versions installed in the last day
- Email settings that do not work never replace ones that did: the last working ones are put back, and said so

## 1.0.38 · 2026-11-24

**A changed encryption key never wipes the data**

The key's fingerprint is kept with the data; a start with another key (CC_SECRET missing or changed, a lost
secret.key) stops with exit 78 and says how to fix it, instead of starting empty with a new Admin. Accounts, POVs
and settings that cannot be read or repaired stop the start the same way, never becoming empty lists. The launcher
waits and retries on exit 78 and never rolls back for it.

## 1.0.37 · 2026-11-24

**No more silent sign-outs**

- Sign-ins are kept (encrypted) and survive restarts, updates and crashes; idle expiry slides with use, with a
  30-day cap; sign-out, removal and a password change still end sessions (a password change keeps the current one)
- The cookie lasts as long as the sign-in can; the server decides when it ends
- Restarts drain: new requests get 'restarting, retry in 3 s', requests under way finish, sign-ins and the audit
  queue are saved first (updates, restores, the watchdog, Restart server, stop and crash)
- The browser waits out a restart (up to 45 s, with a notice) instead of failing
- A session that ends opens a sign-in box over the page: nothing on screen is lost and the request goes on
- Typed values in forms are kept as drafts until saved and put back after a reload

## 1.0.36 · 2026-11-24

**Publish to SharePoint; Mindtickle design**

An Admin connects the Microsoft app registration (Graph, client credentials, secret sealed) and tests it with a site
link; SEs publish the WIP deck, the results presentation and the results page into the POV's SharePoint site in
one click, dated, recorded in the POV's history and the audit trail. docs/integrations.md has the set-up and the
proposed Mindtickle flows.

## 1.0.35 · 2026-11-24

**AI & value tab on each POV**

What the AI actions saved (hours and their worth, triaged and fixed), the tenant's credits and the POV's pool, the
backlog AI could clear and whether the credits cover it, a run planned with its cost before it is confirmed, the
runs from Meridian, and the value rates per POV. The portfolio line shows the hours AI saved across running POVs;
the team-style results deck shows them on its answer slide.

## 1.0.34 · 2026-11-24

**Results presentation: Classic, or the team template**

The current results deck is Classic. The new Team template tells the results in the WIP deck's design, poured into
the uploaded template: the answer first, the platform, the toolchain, the APMA plan, how we got here, results by
business goal, what the tenant showed, from proof to rollout, next steps. Chosen per POV on the Results tab, with
an organisation default in Settings.

## 1.0.33 · 2026-11-24

**Success criteria count everything the tenant ever proved, not only the last 7 days**

Each POV keeps a proof record: every engine, scan type and scan origin seen in a completed scan, with when it was
first and last seen and the scans that show it. The first read of a tenant takes its whole scan history, later reads
only what is new since the last (a day of overlap), so the record stays complete even after downtime. Criteria,
their evidence ("since 4 Nov"), the proving scans in the results and the integration flow use it; the dashboards'
7-day figures are unchanged. A POV moved to another tenant starts a new record.

## 1.0.32 · 2026-11-24

**Fix: the server could not start the day after audit records were written**

The audit trail read its own state before setting it while carrying the chain on from an earlier day, so every
start failed. The launcher now also rolls a version back by itself when it dies within a minute of starting three
times in a row, so a version that cannot start never keeps the server down.

## 1.0.31 · 2026-11-24

**WIP deck: polished slides**

- Executive overview: the letter beside an at-a-glance card (goals, platform, dates, contact)
- DevSecOps: the lifecycle as a pipeline, tools in use as filled pills first
- APMA: dark radar chart, today vs desired bars, numbered first steps
- Plan: meetings spread along the timeline, planned ones dashed, status pills
- Environment and test plan: readable type, zebra rows, rows sized to their text
- Meeting notes: what we did beside the next steps, inside the template's panel

## 1.0.30 · 2026-11-24

**WIP deck: names come from the account only**

- Names in an APMA report (the company, the person interviewed) are never kept or shown; a report that looks like another company's is flagged on upload
- Decks made in the team's template carry none of its revision history, authors or document properties

## 1.0.29 · 2026-11-24

**POV WIP deck in the team's template, the APMA report read from its PDF, toolchain and POV plan in the wizard**

- WIP deck: cover, executive overview letter, platform, DevSecOps toolchain, APMA radar and first steps, plan and timeline (meetings completed or planned), environment and people, test plan per business goal, meeting notes
- An Admin uploads the team's WIP template (.pptx): its masters, layouts and closing slide are kept, kept encrypted
- APMA report (optional): scores, interviewee and recommendations read from the PDF with Node alone; the PDF is kept encrypted
- Wizard: Toolchain step (IDE, SCM, AI, feedback, CI/CD, registry, with access needed) and POV plan step (meetings, objectives, out of scope, account manager, APMA)
- POV page: WIP deck panel, plan and toolchain editor, meeting notes and status on sessions, POV role on stakeholders
- New opportunities open on their POV page after the wizard closes

## 1.0.28 · 2026-11-24

**First call and business goals in the wizard, goal and expansion slides, SEAL library import**

- Wizard: a First call step (date, attendees with their role, concerns, toolchain chips, languages, size, timeline, next step) and a Business goals step with the talk track for each goal
- Report and deck: business goals overview, a slide per goal (criterion, test, benefit, status, measures), expansion (proven work, scale, next on the platform)
- Capabilities page: import the SEAL Markdown references and a criteria bank; the library is stored encrypted and never in the repository
- Customer tab: What to say, from the value messages behind the POV's goals

## 1.0.27 · 2026-11-24

**A complete audit trail, and an Audit page for Admins, VPs and leaders**

Every change, in words (settings, people, roles, templates, every change to
an opportunity, criteria completed by themselves, Salesforce, emails,
updates), and every API request, reads included (who, when, address,
device, what, which POV, status and time). Sign-ins and failed ones are
recorded with the address tried, never the password.

- Two streams under <data>/audit: changes (kept for good) and access (kept
  CC_ACCESS_DAYS, 730 by default). Each record carries the SHA-256 of the
  one before, so a removed, changed or reordered record breaks the chain;
  records are encrypted with the data key. A finished day is sealed into
  one compressed encrypted file that backups hard-link, not copy. The
  chain carries on after a restart and after the console password reset.
- The old audit.json (which kept only the last 10,000 entries) is brought
  into the trail once, in order.
- Audit page (permission audit.view: Admins, VPs, leaders by default):
  changes or every request, search, filters (who, dates, changes only,
  refused or failed only), paging back, each record in full with its
  fingerprints, the chain's integrity, and CSV export (itself recorded).
  Each person sees what they and the people below them did, and what
  happened on POVs they can see; Admins see everything.
- A failed write to the trail is reported, never fatal.

Editing after creation:
- Edit sits beside the customer's name (it was only in the ••• menu), and
  the deal size can be changed with the rest of the details.
- People can set their own sales region in their profile.
- A sheet opened right after another closed (••• → Edit details) can no
  longer be closed by the first one's Back step, which Safari could
  deliver late.

## 1.0.26 · 2026-11-18

**Reset a password from the server console**

node src/reset-password.js <email> (podman exec -it meridian …) gives a
one-time password the person replaces at their next sign-in, switches the
account back on, and records it in the audit log. With no address it lists
the people. A restart afterwards makes the server take it and signs the
person out everywhere. For when nobody, the Admin included, can sign in.

## 1.0.25 · 2026-11-17

**A usable interface: phones, Safari, fewer numbers and forms, the next step for you**

Foundation (meridian.css, loaded after every look):
- Safari: -webkit-backdrop-filter everywhere (panels were see-through), dvh
  instead of vh, a custom select arrow, search fields, no iOS zoom (16 px
  inputs on phones), viewport-fit=cover with safe areas.
- Phones: a bottom tab bar (Portfolio, Insights, New, Teams, More) instead
  of the hamburger; forms are full-height sheets, questions rise from the
  bottom; 44 px targets; one column; any table becomes cards.
- Orbit keeps its look with solid panels and hairlines, no glow; nothing
  animates under reduced motion.
- No browser pop-ups: the app's own ask() dialog, red with focus on Cancel
  for destructive steps. The phone's Back button closes the open sheet;
  focus returns to what opened it.

Portfolio: one line of status, three numbers that filter (need you, end
within 7 days, likely to win), a search plus one Filters sheet, and one
list where each row says in a sentence what is going on; won and lost
fold away; the activity feed and fifteen figures are gone.

POV page:
- A header with one next-step button (add criteria, connect the tenant,
  complete the POV, record the result, share), the stage as one selector,
  and six tabs instead of nine.
- The overview is a To do list from the gaps, each with the button that
  fixes it. The customer summary writes itself and saves as you type, and
  tasks can be added inline.
- Criteria are one line each with a To do / Done filter; a tap opens the
  criterion's sheet (status, evidence, demo, notes).
- Tenant: four numbers, actions in one menu, long lists folded.
- The email composer appears once you pick what to send.

New opportunity: the customer, where it stands (three buttons) and the
Salesforce link; the rest folds away, with dates defaulting to four weeks.
Connecting a tenant to a deal in discovery or technical sessions moves it
to POV running by itself.

Capabilities: one line each with a search. Insights: one roll-up with a
switch, not four tables. Settings: four looks shown, the rest folded.

On a phone: Capabilities 28,469 → 6,526 px, Tenant 19,342 → 2,045,
Criteria 17,534 → 1,689, Insights 4,681 → 2,110; nothing scrolls
sideways on any screen.

## 1.0.24 · 2026-11-17

**Success criteria as a wizard, with templates; criteria the tenant proves complete themselves**

Wizard (new opportunity, and adding criteria to one):
- Steps: Opportunity, Start from, Engines & agents, Integrations, Review.
- Pick one or more templates and their criteria are chosen. Each capability
  is one chip, clicked through must have, nice to have and left out, with
  All / None per group. Criteria in the customer's own words, the API key,
  and saving the set as a template are on the review step.

Templates:
- Seven built in: Core AppSec, AI-powered AppSec, Software supply chain,
  AI supply chain, Developer workflow, Enterprise governance, Full platform.
- Admins, VPs, leaders and team leads (new permission templates.manage)
  make templates for their team; VPs and leaders can share with everyone.
  Templates can be edited, copied and removed; an Admin can hide a built-in
  one. Uses are counted.
- Managed on the Capabilities page. A permission added after the roles were
  saved follows the default until an Admin decides.

Auto-completion:
- Each tenant read marks a criterion Completed successfully when the tenant
  proves it (engines in completed scans, Fusion or LAST scans, scan origins,
  repository hosts, AI actions; never just a keyword in the notes), with the
  evidence kept and logged.
- A status set by a person is never changed again by Meridian.

## 1.0.23 · 2026-11-17

**Send plain http on the HTTPS port to https**

An address typed without https:// (172.35.0.128:8443) got an empty response.
The port now answers both: a TLS handshake goes to HTTPS, and anything else
gets a redirect to the https address of the same page.

## 1.0.22 · 2026-11-17

**Stop cleanly within seconds when Podman or Docker asks**

Open live-update streams kept the server waiting on stop, so the container
was killed after 10 seconds. The server now closes open connections and
exits within 3 seconds, and the launcher gives it 7 at most.

## 1.0.21 · 2026-11-17

**HTTPS served by Meridian itself: self-signed by default, your certificate when given**

- HTTPS is on in the container image, on port 8443. It uses TLS_CERT_FILE +
  TLS_KEY_FILE (or TLS_PFX_FILE) when given, else a self-signed ECDSA
  certificate made with node:crypto (no openssl) for TLS_HOSTNAMES,
  localhost and the machine, kept in <data>/tls and renewed before expiry.
- TLS 1.2 or newer. Cookies are always Secure over HTTPS, and HSTS is sent
  with a real certificate. A renewed certificate is picked up without a
  restart.
- The launcher's start check and the container health check speak HTTPS,
  so updates and rollbacks keep working.

Adapted from the FTR command center's TLS module.

## 1.0.20 · 2026-11-17

**Auto-update like the FTR command center: every push to main is installed by itself**

- Every push to main is tested and published as a release. The version is
  generated (major.minor from package.json, the commit count as the patch),
  so nobody bumps it by hand. A v* tag still publishes an exact version.
- Servers check every 15 minutes and install a new release as soon as they
  find it: checksum verified, checked backup first, restart, and automatic
  rollback if it does not start. Auto-update is on by default (older
  hour-based choices move to this).
- A version that failed here is never auto-installed again. Going back by
  hand holds that version back until a newer one comes.
- Private repository: CC_UPDATE_TOKEN or CC_UPDATE_TOKEN_FILE, a read-only
  token. Assets download through the API, redirects are followed by hand,
  and the token goes to api.github.com only, never to a download host.
  The rate-limit and private-repository errors say how to fix them.
- Settings → System & backups: on/off and how often it checks, plus what is
  held back. A health check flags updates that cannot be seen.

## 1.0.19 · 2026-11-16

**Salesforce without its API: report drop-in, report mailbox, Email to Salesforce**

In:
- Drop a Salesforce opportunities report (.xlsx or .csv) on the Portfolio.
  Rows match POVs by the Opportunity ID in their Salesforce link (15 or 18
  characters), or by name and account. Stage, amount, close date,
  probability, next step and owner show beside each POV, with changes in
  its history. A narrower report keeps fields an earlier one brought in.
- Or subscribe a mailbox to the report: Meridian reads it over IMAP, only
  from allowed sender domains, from the attachment or the table in the
  email, and files the message away.
- Insights show the pipeline in POV weighted by outlook, and gaps where
  Salesforce and the POV disagree.

Out:
- Each person's Email to Salesforce address, stored encrypted and shown
  masked. It is copied on POV emails, and tasks, notes, the POV status,
  stage changes and the POV result are sent as activities.

Also: nodemailer 10 (fixes known advisories); README updated.

## 1.0.18 · 2026-11-16

**Rename to Meridian**

The product is Meridian: one line of sight on every POV, the technical value it
proves and the revenue it moves. New mark (a globe with its meridian), the main
view is the Portfolio, and the image, compose service, release bundle and first
Admin use the new name. The updater still accepts the old bundle name and the
server still accepts the old request header during an update.

## 1.0.17 · 2026-11-16

**Encrypt all data at rest; checked automatic backups; self-repair and a watchdog**

- Every record, tenant snapshot, frozen results page and demo video is encrypted
  (AES-256-GCM; videos AES-256-CTR so they still seek). The key can come from
  CC_SECRET or CC_SECRET_FILE, off the data volume. Older plain files are read
  and encrypted on their next write.
- Writes are atomic and flushed to disk, with the previous copy kept. A damaged
  record repairs itself from that copy or from the newest backup holding it.
- Backups every 6 hours, before updates and restores, and on request. Each is
  opened and checksummed when taken, never holds the key, is optionally copied
  to CC_BACKUP_DIR, and is kept on a 2-day / 30-day schedule. Restoring a
  backup takes one first, so it can be undone.
- A watchdog restarts a stalled tenant reader, restarts cleanly on runaway
  memory, and records long pauses.
- Settings → System & backups shows health checks with fixes, backups with
  check and restore, what was corrected, and updates.

## 1.0.16 · 2026-11-16

**Region filter on the command center list**

## 1.0.15 · 2026-11-16

**Manager list with a half-screen drawer, executive insights, regions**

- Command center as a status list for managers; a row opens the POV on the
  right half of the screen, with every tab, and the list stays usable beside it.
- Insights: a predicted outcome for every POV with the drivers behind it,
  gaps found in real time with their fix, roll-ups by region, team, SE and
  tenant region, and the POVs most at risk.
- Sales region on people, inherited down the team; colour-coded figure groups.

## 1.0.14 · 2026-11-16

**Scale for 300 tenants: read queue with priority, spread first reads, token reuse, hourly slow parts, quiet and failing tenants read less often; per-POV row cache, per-scope overview cache, gzip; live updates throttled; load test and docs/performance.md**

## 1.0.13 · 2026-11-16

**Mass AI Triage and Remediation from CommandCenter under credit control (POV credit pool, tenant credits re-read, plan before run, confirmed cost, never twice, stop on refusal, ledger and audit); value of AI (hours, money, return) at configurable rates; AI backlog projection; Fusion credits**

## 1.0.12 · 2026-11-16

**Wider status column on success criteria, so "Completed successfully" reads in full**

## 1.0.11 · 2026-11-16

**Integration flow slide (code → commit → build → run → govern) with the customer's tools, the engines at each stage and their value, in the results page and the deck; criteria demonstrated by the SE with a short video that plays in the page; every deck slide in the platform slide's look**

## 1.0.10 · 2026-11-16

**Results pages for every POV: list and .zip of all of them from the Command center, links on each card and line item, a final copy kept when a POV is marked successful**

## 1.0.9 · 2026-11-05

**Auto-update like MissionZero: launcher with automatic rollback, updater (GitHub releases, SHA-256 and optional Ed25519 checks, backup first, auto-update hour), release and test workflows; restart, backups, proxy, trusted certificates, email server checks, sign-in security and a hash-chained audit log on the server**

## 1.0.8 · 2026-11-05

**Orbit, the launch-control look (default): glass instruments, telemetry band, stage track; forecasts for POV pace, credits runway and scanning momentum, with a forecast strip, ring gauges and a forecast column**

## 1.0.7 · 2026-11-05

**"Completed successfully" instead of "proven"/"met" across the results page, PDF, deck, report, emails and app**

## 1.0.6 · 2026-11-05

**Status marks: green tick for proven, yellow clock for in progress, grey clock for planned**

## 1.0.5 · 2026-11-05

**Results page: the Checkmarx One platform slide as designed, showing only the POV's engines with proven/in-progress/planned marks; engine records with proving scans, evidence and timestamps; PDF of every slide plus an engine appendix; same slide first in the .pptx**

## 1.0.4 · 2026-11-05

**House looks (Maison default, Calibre, Joaillier, Hypercar) with bundled typefaces; platform-aligned catalogue with proof and technical checks; IAM people activity; POV success and final .pptx deck**

## 1.0.3 · 2026-11-05

**Full UI: stage-bucketed consolidated view, line items by person, opportunity life cycle, teams, catalogue, settings, looks; container and docs**

## 1.0.2 · 2026-11-05

**Teams, RBAC, opportunity lifecycle, success criteria catalogue, email drafts, reports, credits and Fusion/LAST**

## 1.0.1 · 2026-11-05

**CommandCenter: consolidated view of every POV tenant from Checkmarx One API keys**
