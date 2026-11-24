// Builds src/tool-icons.js: a small picture for every tool on the "Tailored to Your DevSecOps" slide.
//
//   npm i --no-save simple-icons && node scripts/build-tool-icons.mjs
//
// The logos come from Simple Icons (CC0-1.0, https://simpleicons.org); the brands are trademarks of their owners and
// are shown only to name the tools a customer uses. A tool Simple Icons has no logo for gets a lettered tile.
// Each is drawn twice as a PNG (white for a tool in use, muted for the rest) so PowerPoint needs nothing else.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import * as si from 'simple-icons';
import { TOOLCHAIN } from '../src/toolchain.js';

const LOGO = {
  JetBrains: 'jetbrains', Eclipse: 'eclipseide', Cursor: 'cursor', Windsurf: 'windsurf',
  GitHub: 'github', GitLab: 'gitlab', Bitbucket: 'bitbucket',
  'GitHub Copilot': 'githubcopilot', 'Anthropic Claude': 'claude',
  Jira: 'jira', 'GitHub Issues': 'github',
  Maven: 'apachemaven', Jenkins: 'jenkins', Bamboo: 'bamboo', TeamCity: 'teamcity', 'GitLab CI/CD': 'gitlab',
  'Bitbucket Pipelines': 'bitbucket', 'GitHub Actions': 'githubactions', CircleCI: 'circleci', Sonar: 'sonar',
  'GitHub Packages': 'github', JFrog: 'jfrog', 'Docker Hub': 'docker',
};
const LETTERS = {
  'VS Code': 'VC', 'Visual Studio': 'VS', 'AWS Kiro': 'K', 'Azure DevOps': 'Az', OpenAI: 'AI', 'Azure AI': 'Az',
  Slack: 'S', Teams: 'T', 'Azure Boards': 'Az', ServiceNow: 'SN', 'AWS CodeBuild': 'CB', 'Azure Pipelines': 'Az',
  'Amazon ECR': 'ECR', Quay: 'Q', 'Azure ACR': 'Az',
};
const { chromium } = createRequire(import.meta.url)('playwright'); // the copy installed with the browser
const bySlug = Object.fromEntries(Object.values(si).filter((x) => x?.slug).map((x) => [x.slug, x]));
const COLORS = { on: '#FFFFFF', off: '#7D7396' };

const svgOf = (name, color) => {
  const icon = bySlug[LOGO[name]];
  if (icon) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64"><path fill="${color}" d="${icon.path}"/></svg>`;
  const t = LETTERS[name] ?? name.replace(/[^A-Z]/g, '').slice(0, 2) ?? name[0];
  const fs2 = t.length > 2 ? 8 : t.length > 1 ? 10 : 13;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="64" height="64"><rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="none" stroke="${color}" stroke-width="2"/><text x="12" y="12.5" fill="${color}" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${fs2}" text-anchor="middle" dominant-baseline="central">${t}</text></svg>`;
};

const names = [...new Set(TOOLCHAIN.flatMap((c) => c.tools.map(([n]) => n)))];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
const out = {};
for (const n of names) {
  out[n] = {};
  for (const [k, color] of Object.entries(COLORS)) {
    await page.setContent(`<html><body style="margin:0;background:transparent">${svgOf(n, color)}</body></html>`);
    out[n][k] = (await page.locator('svg').screenshot({ omitBackground: true })).toString('base64');
  }
}
await browser.close();
fs.writeFileSync(
  new URL('../src/tool-icons.js', import.meta.url),
  `// Made by scripts/build-tool-icons.mjs; do not edit. Logos: Simple Icons (CC0-1.0); brands belong to their owners.\n` +
    `// name -> { on: PNG for a tool in use (white), off: PNG for the rest (muted) }, base64.\n` +
    `export const TOOL_ICONS = ${JSON.stringify(out, null, 0).replace(/\},"/g, '},\n"')};\n\n` +
    `export const toolIcon = (name, on) => (TOOL_ICONS[name] ? \`image/png;base64,\${TOOL_ICONS[name][on ? 'on' : 'off']}\` : null);\n`,
);
console.log(`${names.length} tools, ${names.filter((n) => bySlug[LOGO[n]]).length} with logos`);
