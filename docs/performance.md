# Performance at the target scale

Target: 40 SEs running 200–300 POVs, so 200–300 Checkmarx One tenants connected at once, read every 10 minutes, with
managers and VPs watching the command center live.

`node scripts/loadtest.mjs 300 40 10` builds that: 300 tenants on the mock Checkmarx One (5–30 projects and 10–70
scans each), a VP, 4 leaders, 8 team leads and 40 SEs, every tenant read once, then 40 people loading the command
center at the same time, 10 rounds (400 requests).

| | Result |
| --- | --- |
| All 300 tenants read (mock, 10 at a time) | 2.6 s |
| Server memory with 300 tenants' snapshots | about 330 MB |
| Command center, 40 people at once | p50 **45 ms**, p95 407 ms (the first round, every scope new), 0 errors |
| What a VP sees | all 300 POVs, 1.1 MB of JSON, sent compressed (about a tenth) |

Against real tenants a read takes seconds, not milliseconds: at 10 tenants at a time (`CC_READ_CONCURRENCY`) and
about 15 s a read, 300 tenants take about 7.5 minutes, inside the 10-minute interval. Quiet tenants are read three
times less often, and the slow parts (credits, IAM people, AI settings) once an hour, so a real cycle is lighter.
Raise `CC_READ_CONCURRENCY` for more tenants, or the interval.

What makes it hold:
- **Reading:** a queue with a fixed number of tenants read at once; a person's "Refresh now" goes first; first reads
  spread over the interval; each tenant's sign-in token reused; slow parts hourly; quiet tenants less often; failing
  tenants back off (up to an hour), a refused key waits until it is replaced.
- **Serving:** each POV's row worked out once per change; the command center's answer worked out once per scope and
  filter and kept 3 seconds, compressed once; responses over 8 KB gzipped.
- **Browsers:** live updates draw the page at most every 5 seconds, and only while it is on screen; never under
  someone's typing or an open dialog.
- **Health:** `/healthz` reports the reading (tenants, reading now, queued, failing, last read time) and memory.
