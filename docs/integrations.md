# Integrations: SharePoint and Mindtickle

## SharePoint (built)

SEs publish a POV's documents to the POV's own SharePoint site in one click (Results tab → **Publish to SharePoint**):
the WIP deck, the results presentation and the results page, into `POV/<customer>/` of the site's documents, with the
date in each file name so earlier copies stay.

Set up once by an Admin, under **Settings → Organisation → SharePoint**:

1. Your Microsoft admin registers an app in **Entra ID → App registrations**.
2. API permissions: **Microsoft Graph → Application → Sites.Selected** (then grant the app write access to the POV
   sites), or **Sites.ReadWrite.All**. Grant admin consent.
3. Certificates & secrets → a new client secret.
4. In Meridian: the directory (tenant) ID, the application (client) ID and the secret; **Test** with a site link.

The secret is kept sealed (encrypted) and is never shown again. Each publish is in the audit trail.

## Mindtickle (proposed)

Mindtickle is the enablement platform; Meridian holds what SEs actually do in POVs. The useful flows:

| Flow | Direction | What | How |
| --- | --- | --- | --- |
| Readiness | Mindtickle → Meridian | Each SE's certifications and course completions (e.g. "Checkmarx One Assist certified") | Mindtickle reporting API, read nightly; shown on Teams and used to suggest who runs which POV |
| Playbook | Mindtickle → Meridian | The current POV playbook and pitch modules, linked from the wizard's Business goals step | Links per goal or capability, kept in the library |
| Field evidence | Meridian → Mindtickle | Anonymised POV outcomes per capability (win rate, what proved it, how long) for coaching content | A monthly CSV or API push; no customer names |
| Coaching | Meridian → Mindtickle | A POV's readout recording or deck as a coaching submission | Upload from the Results tab, the SE choosing |

Needed from you before building: whether your Mindtickle tenant has API access (and which: reporting, content, or
coaching), and which of the flows above you want first.
