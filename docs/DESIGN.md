# Design notes

## The model

**One record per opportunity, for its whole life.** The stages are: discovery → technical sessions → POV running → POV completed → won / lost, plus on hold. A POV is simply an opportunity with a Checkmarx One tenant attached. Stakeholders, discovery, sessions, notes, tasks, success criteria, email and history all live on that one record. As a result, the dashboards, the email drafts and the report all read from the same place, and nothing has to be kept in sync.

**Visibility follows the reporting tree; actions follow the role.** Everyone sees themselves and everyone below them, and an Admin sees everything. The role matrix (Settings → Roles & permissions) decides what someone may *do*, such as editing the work of people below them, reassigning, downloading logs, sending email or managing people or the catalogue. Keeping "see" and "do" apart means a VP never needs a permission just to look.

**The tenant is read on a clock only while the POV runs.** Each running POV is read every `REFRESH_MINUTES`, staggered across tenants. The last snapshot is kept on disk, so a restart shows the last known state immediately. Opportunities in any other stage are read only when someone asks.

## Arguments I had with myself

| First instinct | The objection | What was built |
| --- | --- | --- |
| Mark a success criterion **met automatically** when the tenant shows it (a Jenkins scan means "Jenkins: met"). | One CLI scan labelled "jenkins" is not the customer's success criterion. A report that claims something the SE never saw is worse than no report. | Evidence is shown as **Detected** (from the tenant) or **Mentioned** (keywords in notes), with a **Confirm met** button. The report says who confirmed each criterion and when. |
| Match integrations on simple substrings. | "ado" matches "shadow", and "github" matches "GitHub Actions". The second one happened in testing: GitHub SCM showed up as detected from Actions scans. | Rules match on word boundaries. SCM is detected from the projects' repository hosts, not from scan origins. The mapping can be edited in the app, because naming in Checkmarx One changes over time. |
| A database (Postgres or SQLite). | A team of 8–9 SEs has hundreds of opportunities, not millions. A database adds a second container, migrations and a harder backup. | JSON files with atomic writes, one per collection. A backup is a copy of the folder. If a larger organisation needs it, the `Db` class is the only place to change. |
| Send status emails automatically every week. | An email that goes to a customer unreviewed is a risk to the deal. | Every Monday a weekly **draft** is prepared for each running POV. The SE reviews it, then sends it, downloads it as .eml, or copies it. |
| Push reports to SharePoint and read from Salesforce. | Salesforce is read-only here by policy. Writing to SharePoint needs a Microsoft Graph app registration and consent from the customer's or the company's tenant admin. | Links to both are stored on each opportunity and shown everywhere. The report is one self-contained HTML file that prints to PDF. Publishing through Graph can be added once the app registration exists. |
| One dashboard design for everyone. | An SE wants the detail of their three POVs. A VP with 40 POVs wants rows they can scan and filter. | Cards grouped into stage buckets by default for associates, and line items grouped by person for managers. Anyone can switch, and the choice is remembered. |
| Store API keys so CommandCenter can do things in the tenant (rescan, triage). | Holding customers' tenant keys is already a responsibility. Write access would make CommandCenter a way into every POV tenant. | CommandCenter only reads. Keys are encrypted at rest, never returned to the browser, checked against Checkmarx One before they are saved, and only sent to the tenant's own hosts. Troubleshooting covers what an SE needs (logs, the bundle) without write access. |
| Poll as fast as possible ("every minute"). | 9 SEs × 3 POVs each, every minute, is a steady load on customers' tenants for little gain. | Every 10 minutes by default (changeable), with a manual "Refresh now", and live updates pushed to every open page as soon as a read finishes. |

## Still to do

These are waiting on inputs that were promised:

- **Your report formats.** The PDF/presentation layouts will replace `src/report.js`'s generic layout.
- **Your capability list and its Checkmarx One names.** Load it under Capabilities, or replace `DEFAULT_CATALOG` in `src/catalog.js`.
- **Discovery questionnaire.** The fields in the Discovery tab are a starting set; the questions you supply will replace them.
- **SharePoint publishing** through Microsoft Graph, once an app registration is available.
- **SSO** for signing in (OIDC), if wanted instead of local accounts.
