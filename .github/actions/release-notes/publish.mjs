#!/usr/bin/env node
// Release notes, without anyone writing them — for any product connected to Pitwall.
//
// Collects the commits shipped since the last note (the newest `<prefix><version>` tag), sends
// them to Pitwall, which has Claude Haiku write the customer-facing note in every language the
// product publishes in, resolves the tickets the commits mention by code, and publishes (or
// drafts) the release. Then tags the last commit it covered, so the next run starts there and
// nothing is announced twice.
//
// Env:
//   PITWALL_URL            the Pitwall API (required)
//   PITWALL_RELEASE_KEY    a product key with the `releases` scope (required)
//   VERSION                the version to announce; default: <major>.<minor> of VERSION_FROM + commit count
//   VERSION_FROM           package.json whose "version" gives major.minor (default: package.json)
//   TAG_PREFIX             marker tag prefix (default: notes/)
//   SETTLE_MINUTES         commits younger than this wait for the next run (default 30): a note
//                          never announces something still deploying
//   FIRST_COMMIT           where to start when there is no marker tag yet
//   PUSH_TAG=1             push the marker tag (CI)
//   DRY_RUN=1              show the note, publish nothing, tag nothing
//   CONTEXT                extra words from the team for the writer ("this release is about…")
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim();
const env = process.env;
const api = (env.PITWALL_URL ?? '').replace(/\/$/, '');
const key = env.PITWALL_RELEASE_KEY;
const prefix = env.TAG_PREFIX || 'notes/';
const dryRun = env.DRY_RUN === '1' || process.argv.includes('--dry-run');
const settle = Number(env.SETTLE_MINUTES ?? 30);
if (!api || !key) { console.error('PITWALL_URL and PITWALL_RELEASE_KEY are required.'); process.exit(2); }

// Commits that only touch the plumbing never reach a customer; the model would drop them anyway,
// but leaving them out keeps the prompt about the product.
const PLUMBING = /^(docs|test|tests|ci|build|chore|style|refactor)(\([^)]*\))?!?:/i;

function productCommits(from, to) {
  const SEP = '\x1f', END = '\x1e';
  const raw = git('log', '--no-merges', `--format=%H${SEP}%s${SEP}%b${END}`, from ? `${from}..${to}` : to);
  return raw.split(END).map((r) => r.trim()).filter(Boolean).map((r) => {
    const [sha, subject, body] = r.split(SEP);
    const clean = (body ?? '').split('\n').filter((l) => !/^(Co-Authored-By|Signed-off-by):/i.test(l)).join('\n').trim();
    return { sha, subject: subject.trim(), body: clean || null };
  }).filter((c) => !PLUMBING.test(c.subject));
}

function versionAt(sha) {
  if (env.VERSION) return env.VERSION;
  const file = env.VERSION_FROM || 'package.json';
  const [major = '0', minor = '1'] = String(JSON.parse(readFileSync(file, 'utf8')).version ?? '0.1.0').split('.');
  return `${major}.${minor}.${git('rev-list', '--count', sha)}`;
}

const compareVersions = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};

const tags = git('tag', '--list', `${prefix}*`).split('\n').filter(Boolean)
  .sort((a, b) => compareVersions(a.slice(prefix.length), b.slice(prefix.length)));
const from = tags.at(-1) ?? env.FIRST_COMMIT;
if (!from) { console.error(`No ${prefix}* tag and no FIRST_COMMIT: nothing to start from.`); process.exit(2); }

const head = git('rev-list', '-1', `--before=${settle} minutes ago`, 'HEAD');
if (!head) { console.log('Nothing old enough to announce yet.'); process.exit(0); }
if (git('rev-list', '--count', `${from}..${head}`) === '0') { console.log(`Nothing new since ${from}.`); process.exit(0); }

const commits = productCommits(from, head);
const version = versionAt(head);
console.log(`Release ${version}: ${commits.length} product commit(s) since ${from}`);

let outcome = { status: 'skipped', reason: 'only plumbing commits' };
if (commits.length > 0) {
  const res = await fetch(`${api}/v1/ingest/releases`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ version, commits, dryRun, context: env.CONTEXT || undefined }),
  });
  const text = await res.text();
  if (!res.ok) { console.error(`Pitwall answered ${res.status}: ${text.slice(0, 300)}`); process.exit(1); }
  outcome = JSON.parse(text);
}

console.log(`→ ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ''}`);
if (outcome.resolvedTickets?.length) console.log(`  resolved: ${outcome.resolvedTickets.join(', ')}`);
for (const [lang, d] of Object.entries(outcome.draft?.notes ?? {})) {
  if (!d.title) continue;
  console.log(`\n[${lang}] ${d.title}\n${d.summary}`);
  for (const i of d.new ?? []) console.log(`  + ${i}`);
  for (const i of d.improvements ?? []) console.log(`  ~ ${i}`);
}
// The model sometimes returns nothing usable: a failure to retry, not a settled range.
if (outcome.status === 'failed') process.exit(1);

// Advance the marker for anything Pitwall settled. A failure leaves it, so the next run retries.
if (!dryRun && ['published', 'draft', 'exists', 'skipped'].includes(outcome.status)) {
  const tag = `${prefix}${version}`;
  git('tag', tag, head);
  if (env.PUSH_TAG === '1') git('push', 'origin', tag);
  console.log(`Tagged ${tag} at ${head.slice(0, 8)}`);
}
