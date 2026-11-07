#!/usr/bin/env node
// craft-lite — a clean-room rebuild loop small enough to run anywhere Node runs.
//
//   craft-lite study <url|file> <projectDir>     observe the original into evidence
//   craft-lite check <projectDir> <built.html>   measure your rebuild against it
//   craft-lite serve <dir> [port]                preview the rebuild locally
//
// The loop mirrors Study → Build → Check → Ready. Build is yours (or your agent's).

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { study } from '../lib/study.mjs';
import { check } from '../lib/check.mjs';
import { serve } from '../lib/serve.mjs';
import { auditProject, auditMarkdown } from '../lib/audit.mjs';

const HELP = `craft-lite — clean-room rebuild loop (Study → Build → Check → Ready)

Usage
  craft-lite study <url|file> <projectDir>      observe the original, write capture/
  craft-lite check <projectDir> <built.html>    compare a rebuild with the original
  craft-lite audit <projectDir> <built.html>    audit the EXAM itself (5 probes)
  craft-lite serve <dir> [port]                 serve a folder (correct .wasm MIME)
  craft-lite help | version

Options
  --json                print the machine-readable result instead of Markdown
  --min <score>         check: exit 1 when the score is below this (for CI)
  --audit               check: also audit the exam; exit 1 if any probe fires
  --port <n>            serve: port (default 8787)
  --host <addr>         serve: address (default 127.0.0.1; use 0.0.0.0 for LAN)
  --quiet               suppress the human report

Layout a project keeps (same idea as craft-anything)
  <projectDir>/craft.json      request, target, status, history
  <projectDir>/capture/        what was observed: raw.html, report.json, summary.md
  <projectDir>/app/            your rebuild
  <projectDir>/checks/         every comparison, as .json + .md

A similarity score is the model times the exam. 'audit' plants five known faults
and reports whether the scorer notices: a shell page built from the study report
alone, copying the original's prose, verbatim source copying, a stalled score, and
a changed exam fingerprint. Run it before you trust a high score.

Use it only on software you own or are allowed to examine. A rebuild recreates
layout, style and behaviour from evidence; do not copy logos, photos or copy text.
`;

function fail(message) {
  console.error(`craft-lite: ${message}\n`);
  console.error(HELP);
  process.exit(2);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    json: { type: 'boolean', default: false },
    min: { type: 'string' },
    port: { type: 'string' },
    host: { type: 'string' },
    audit: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false },
  },
});

const [command, ...rest] = positionals;

if (values.version || command === 'version') {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}
if (values.help || !command || command === 'help') {
  console.log(HELP);
  process.exit(command || values.help ? 0 : 2);
}

const say = values.quiet || values.json ? () => {} : (s) => console.log(s);

try {
  if (command === 'study') {
    const [target, projectDir] = rest;
    if (!target || !projectDir) fail('study needs <url|file> <projectDir>');
    const { report } = await study(target, resolve(projectDir), { log: say });
    if (values.json) console.log(JSON.stringify(report, null, 2));
  } else if (command === 'check') {
    const [projectDir, builtFile] = rest;
    if (!projectDir || !builtFile) fail('check needs <projectDir> <built.html>');
    const result = await check(resolve(projectDir), resolve(builtFile), { log: say });
    if (values.json) {
      console.log(JSON.stringify({ score: result.score, dims: result.dims, gaps: result.gaps }, null, 2));
    }
    if (values.audit) {
      const a = await auditProject(resolve(projectDir), resolve(builtFile));
      say(auditMarkdown(a));
      if (values.json) console.log(JSON.stringify({ audit: a.rows.map(({ html, ...r }) => r), ok: a.ok }, null, 2));
      if (!a.ok) {
        console.error(`craft-lite: audit failed — ${a.fired} probe(s) fired; the score is not trustworthy yet`);
        process.exit(1);
      }
    }
    if (values.min !== undefined) {
      const min = Number(values.min);
      if (!Number.isFinite(min)) fail('--min needs a number');
      if (result.score < min) {
        console.error(`craft-lite: score ${result.score} is below --min ${min}`);
        process.exit(1);
      }
    }
  } else if (command === 'audit') {
    const [projectDir, builtFile] = rest;
    if (!projectDir || !builtFile) fail('audit needs <projectDir> <built.html>');
    const a = await auditProject(resolve(projectDir), resolve(builtFile));
    console.log(auditMarkdown(a));
    if (values.json) console.log(JSON.stringify({ audit: a.rows.map(({ html, ...r }) => r), ok: a.ok }, null, 2));
    if (!a.ok) process.exit(1);
  } else if (command === 'serve') {
    const [dir, portArg] = rest;
    if (!dir) fail('serve needs <dir> [port]');
    const port = Number(values.port ?? portArg ?? 8787);
    if (!Number.isInteger(port) || port < 1 || port > 65535) fail('bad port');
    const { url } = await serve(dir, { port, host: values.host || '127.0.0.1' });
    console.log(`craft-lite: serving ${resolve(dir)}\n  ${url}\n  Ctrl+C to stop`);
  } else {
    fail(`unknown command "${command}"`);
  }
} catch (err) {
  console.error(`craft-lite: ${err.message}`);
  process.exit(1);
}
