/**
 * Slide previews for the presentation designer: a deck turned into one picture per slide, with LibreOffice (soffice)
 * and pdftoppm when the server has them (the container image does). Kept by a fingerprint of what made the deck, so
 * the same deck is drawn once. One at a time: drawing a deck takes a few seconds and a lot of memory.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const run = (cmd, args, opts = {}) => new Promise((ok, no) => execFile(cmd, args, { timeout: 180_000, maxBuffer: 8 << 20, ...opts }, (e, out) => (e ? no(e) : ok(out))));
let available = null;
let SOFFICE = process.env.CC_SOFFICE || 'soffice';
/** Can this server draw previews? (Checked once.) */
export async function canPreview() {
  if (available !== null) return available;
  try {
    for (const c of [SOFFICE, 'libreoffice', '/usr/lib/libreoffice/program/soffice']) {
      try {
        await run(c, ['--version'], { timeout: 30_000 });
        SOFFICE = c;
        break;
      } catch (e) {
        if (c === '/usr/lib/libreoffice/program/soffice') throw e;
      }
    }
    await run('pdftoppm', ['-v'], { timeout: 10_000 }).catch((e) => {
      if (e.code === 'ENOENT') throw e;
    });
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export const fingerprint = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 24);

let queue = Promise.resolve();
/** The deck's slides as PNG files in `<dir>/<key>/slide-N.png` (made once); returns their names in order. */
export function previewDeck(buf, dir, key) {
  const out = path.join(dir, key);
  const done = path.join(out, 'done.json');
  if (fs.existsSync(done)) return Promise.resolve(JSON.parse(fs.readFileSync(done, 'utf8')));
  const job = queue.then(async () => {
    if (fs.existsSync(done)) return JSON.parse(fs.readFileSync(done, 'utf8'));
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kendra-preview-'));
    try {
      fs.writeFileSync(path.join(work, 'deck.pptx'), buf);
      // Its own profile folder: a second soffice of the same user would otherwise wait for the first.
      await run(SOFFICE, [`-env:UserInstallation=file://${path.join(work, 'profile')}`, '--headless', '--convert-to', 'pdf', '--outdir', work, path.join(work, 'deck.pptx')], { cwd: work });
      await run('pdftoppm', ['-r', '48', '-png', path.join(work, 'deck.pdf'), path.join(work, 'slide')]);
      fs.mkdirSync(out, { recursive: true });
      const names = fs.readdirSync(work).filter((f) => /^slide-\d+\.png$/.test(f)).sort((a, b) => Number(/\d+/.exec(a)[0]) - Number(/\d+/.exec(b)[0]));
      const kept = names.map((f, i) => {
        const to = `slide-${i + 1}.png`;
        fs.copyFileSync(path.join(work, f), path.join(out, to));
        return to;
      });
      fs.writeFileSync(done, JSON.stringify(kept));
      return kept;
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  });
  queue = job.catch(() => {});
  return job;
}

/** Old previews go: only the newest `keep` decks are kept. */
export function prunePreviews(dir, keep = 40) {
  try {
    const all = fs.readdirSync(dir).map((n) => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })).sort((a, b) => b.t - a.t);
    for (const { n } of all.slice(keep)) fs.rmSync(path.join(dir, n), { recursive: true, force: true });
  } catch {}
}
