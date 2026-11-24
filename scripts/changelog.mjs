// Writes CHANGELOG.md from the history of main: every release (1.0.<n>, n = the commit's count on main), newest
// first, with what it changed (the commit message, without its attribution lines).
//   node scripts/changelog.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const SEP = '\u001e';
const log = execFileSync('git', ['log', '--first-parent', '--reverse', `--format=%H%x1f%cI%x1f%B${SEP}`], { encoding: 'utf8', maxBuffer: 64 * 1048576 });
const commits = log.split(SEP).map((c) => c.trim()).filter(Boolean).map((c, i) => {
  const [, at, body] = c.split('\u001f');
  const lines = body.split('\n').filter((l) => !/^(Co-Authored-By|Claude-Session|Signed-off-by):/i.test(l));
  return { version: `1.0.${i + 1}`, day: at.slice(0, 10), title: lines[0].trim(), rest: lines.slice(1).join('\n').trim() };
});
const out = ['# Kendra version log', '', 'Every release, newest first: the version shown at the bottom of the menu, the day it was published, and what it changed. Settings → Update & recovery shows the same notes for each version.', ''];
for (const c of commits.reverse()) out.push(`## ${c.version} · ${c.day}`, '', `**${c.title}**`, ...(c.rest ? ['', c.rest] : []), '');
fs.writeFileSync(new URL('../CHANGELOG.md', import.meta.url), `${out.join('\n').trim()}\n`);
console.log(`${commits.length} releases written to CHANGELOG.md`);
