// craft-lite self-test: fixtures only, no network. `npm test`
import { readFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { extract } from '../lib/extract.mjs';
import { score } from '../lib/score.mjs';
import { study } from '../lib/study.mjs';
import { check } from '../lib/check.mjs';
import { serve } from '../lib/serve.mjs';
import { collectCss } from '../lib/assets.mjs';
import { shellPage, checkShell, checkCopyIncentive, checkVerbatim, checkPlateau, examFingerprint, auditProject } from '../lib/audit.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const fixtures = join(here, 'fixtures');
const originalHtml = await readFile(join(fixtures, 'original.html'), 'utf8');
const rebuiltHtml = await readFile(join(fixtures, 'rebuilt.html'), 'utf8');

let pass = 0;
const failures = [];
function ok(name, condition, detail) {
  if (condition) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const original = extract(originalHtml);
const rebuilt = extract(rebuiltHtml);

console.log('\nextract');
ok('title', original.title === 'Acme Tools', original.title);
ok('one heading', original.headings.length === 1, String(original.headings.length));
ok('six design tokens', Object.keys(original.style.vars).length === 6, Object.keys(original.style.vars).join(','));
ok('themed token keeps both values', (original.style.varVariants['--acc'] || []).join(',') === '#4f8cff,#2f6df0', JSON.stringify(original.style.varVariants['--acc']));
ok('last value wins like css', original.style.vars['--acc'] === '#2f6df0', original.style.vars['--acc']);
ok('colours found', original.style.colors.length >= 12, String(original.style.colors.length));
ok('counts', original.counts.inputs === 1 && original.counts.buttons === 2 && original.counts.links === 3, JSON.stringify(original.counts));
ok('behaviour flags', original.features.cssVariables && original.features.grid && original.features.flex && original.features.classToggle && original.features.datasetFilter && original.features.prefersColorScheme, JSON.stringify(original.features));
ok('root layout tags dropped', !('html' in original.tags) && !('head' in original.tags), Object.keys(original.tags).join(','));
ok('text sample not empty', original.text.sample.length > 10);

console.log('\nscore: a faithful rebuild');
const good = score(original, rebuilt);
ok('high score', good.score >= 90, String(good.score));
ok('palette perfect', good.dims.find((d) => d.key === 'palette').value === 1);
ok('tokens perfect', good.dims.find((d) => d.key === 'tokens').value === 1);
ok('behaviour perfect', good.dims.find((d) => d.key === 'behaviour').value === 1);
ok('own copy is not full marks', good.dims.find((d) => d.key === 'copy').value < 0.85);
ok('no gaps', good.gaps.length === 0, good.gaps.join('; '));

console.log('\nscore: regressions are named');
const noToggle = score(original, extract(rebuiltHtml.replace(/classList\.toggle/g, 'setAttribute')));
ok('classToggle detected', noToggle.gaps.some((g) => g.includes('classToggle')), noToggle.gaps.join('; '));
ok('behaviour dropped', noToggle.score < good.score);

const extraVar = score(original, extract(rebuiltHtml.replace(':root{', ':root{--extra:1px;')));
ok('extra token named', extraVar.gaps.some((g) => g.includes('--extra')), extraVar.gaps.join('; '));

const missingColour = score(original, extract(rebuiltHtml.replace(/rgba\(127,127,127,\.12\)/g, '#333')));
ok('missing colour named', missingColour.gaps.some((g) => g.includes('palette:')), missingColour.gaps.join('; '));

const missingHeading = score(original, extract(rebuiltHtml.replace('<h1>Acme Tools</h1>', '')));
ok('missing heading named', missingHeading.gaps.some((g) => g.includes('headings:')), missingHeading.gaps.join('; '));

console.log('\nend to end: study → check');
let dir;
try {
  dir = await mkdtemp(join(tmpdir(), 'craft-lite-'));
} catch {
  dir = await mkdtemp(join(root, '.test-'));
}
try {
  const project = join(dir, 'project');
  await mkdir(project, { recursive: true });
  const quiet = { log: () => {} };
  await study(join(fixtures, 'original.html'), project, quiet);
  const craft = JSON.parse(await readFile(join(project, 'craft.json'), 'utf8'));
  ok('craft.json written', craft.status.study === 'done' && craft.tool === 'craft-lite', JSON.stringify(craft.status));
  const report = JSON.parse(await readFile(join(project, 'capture/report.json'), 'utf8'));
  ok('capture/report.json written', report.bytes.html > 500);
  await readFile(join(project, 'capture/summary.md'), 'utf8');
  ok('capture/summary.md written', true);
  const result = await check(project, join(fixtures, 'rebuilt.html'), quiet);
  ok('check score matches direct score', result.score === good.score, `${result.score} vs ${good.score}`);
  ok('checks/*.md written', result.markdown.includes('similarity'));
  const craft2 = JSON.parse(await readFile(join(project, 'craft.json'), 'utf8'));
  ok('history records both steps', craft2.history.length === 2, JSON.stringify(craft2.history.map((h) => h.step)));
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log('\nexternal stylesheets (local file)');
let cssDir;
try {
  cssDir = await mkdtemp(join(tmpdir(), 'craft-lite-css-'));
} catch {
  cssDir = await mkdtemp(join(root, '.test-'));
}
try {
  const project = join(cssDir, 'project');
  await mkdir(project, { recursive: true });
  await study(join(fixtures, 'linked.html'), project, { log: () => {} });
  const linked = JSON.parse(await readFile(join(project, 'capture/report.json'), 'utf8'));
  ok('linked css read', linked.style.vars['--acc'] === '#3b82f6', JSON.stringify(linked.style.vars));
  ok('@import followed one level', linked.style.colors.includes('rgba(0,0,0,.06)'), linked.style.colors.join(','));
  ok('two stylesheets recorded', linked.stylesheets.length === 2, JSON.stringify(linked.stylesheets.map((x) => x.href)));
  ok('behaviour comes from external css', linked.features.grid && linked.features.flex && linked.features.hoverRules && linked.features.transitions, JSON.stringify(linked.features));
  ok('themed token from external css', (linked.style.varVariants['--bg'] || []).length === 2, JSON.stringify(linked.style.varVariants['--bg']));
  ok('css bytes counted', linked.bytes.css > 300, String(linked.bytes.css));

  const broken = join(cssDir, 'broken.html');
  await (await import('node:fs/promises')).writeFile(broken, '<html><head><link rel="stylesheet" href="nope.css"></head><body><h1>Broken</h1></body></html>');
  const brokenProject = join(cssDir, 'broken');
  await mkdir(brokenProject, { recursive: true });
  await study(broken, brokenProject, { log: () => {} });
  const brokenReport = JSON.parse(await readFile(join(brokenProject, 'capture/report.json'), 'utf8'));
  ok('missing stylesheet is reported, not fatal', brokenReport.stylesheets.length === 1 && brokenReport.stylesheets[0].ok === false, JSON.stringify(brokenReport.stylesheets));

  // a rebuild that keeps its tokens in an external file must score the same as one that inlines them
  const spread = join(cssDir, 'spread');
  await mkdir(spread, { recursive: true });
  await (await import('node:fs/promises')).writeFile(join(spread, 'theme.css'), originalHtml.match(/<style>([\s\S]*?)<\/style>/)[1]);
  const externalRebuild = rebuiltHtml.replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="theme.css">');
  const spreadFile = join(spread, 'index.html');
  await (await import('node:fs/promises')).writeFile(spreadFile, externalRebuild);
  const project2 = join(cssDir, 'project2');
  await mkdir(project2, { recursive: true });
  await study(join(fixtures, 'original.html'), project2, { log: () => {} });
  const spreadResult = await check(project2, spreadFile, { log: () => {} });
  const spreadDim = (key) => spreadResult.dims.find((d) => d.key === key).value;
  ok('rebuild tokens read from its own css file', spreadDim('tokens') === 1 && spreadDim('palette') === 1 && spreadDim('behaviour') === 1, JSON.stringify({ tokens: spreadDim('tokens'), palette: spreadDim('palette'), behaviour: spreadDim('behaviour') }));
  ok('score stays within a point', Math.abs(spreadResult.score - good.score) <= 1, `${spreadResult.score} vs ${good.score}`);
} finally {
  await rm(cssDir, { recursive: true, force: true });
}


console.log('\naudit: shell baseline');
const shell = shellPage(original);
const shellReport = extract(shell);
const shellScore = score(original, shellReport);
ok('shell page reproduces every token', JSON.stringify(shellReport.style.vars) === JSON.stringify(original.style.vars), JSON.stringify(shellReport.style.vars));
ok('shell page reproduces the palette', shellReport.style.colors.length === original.style.colors.length, String(shellReport.style.colors.length));
ok('shell page reproduces the tag histogram', JSON.stringify(shellReport.tags) === JSON.stringify(original.tags), JSON.stringify(shellReport.tags));
ok('shell page lights every behaviour flag', Object.keys(original.features).every((k) => original.features[k] !== true || shellReport.features[k] === true));
ok('shell page has almost no prose', shellReport.text.fingerprint.words.length <= 3, JSON.stringify(shellReport.text.fingerprint.words));
ok('shell page still scores high on the exam', shellScore.score >= 85, String(shellScore.score));
const shellProbe = checkShell(original);
ok('A1 fires on a gameable exam', shellProbe.fired && shellProbe.score >= 85, String(shellProbe.score));
ok('A1 passes on an exam it cannot game', !checkShell(original, { threshold: 0.99 }).fired);

console.log('\naudit: copy incentive');
const pay = checkCopyIncentive(original, rebuiltHtml);
ok('A2 measures both sides', pay.clean > 0 && pay.plagiarised > 0, `${pay.clean} vs ${pay.plagiarised}`);
ok('A2 copy dimension rises when prose is lifted', pay.copyPlagiarised > pay.copyClean, `${pay.copyClean} -> ${pay.copyPlagiarised}`);

console.log('\naudit: verbatim');
const sameFile = checkVerbatim(originalHtml, originalHtml);
ok('A3 catches a verbatim copy', sameFile.fired && sameFile.prose === 1 && sameFile.code === 1, JSON.stringify({ prose: sameFile.prose, code: sameFile.code }));
const honest = checkVerbatim(originalHtml, rebuiltHtml);
ok('A3 clears a faithful rebuild', !honest.fired, JSON.stringify({ prose: honest.prose, code: honest.code }));
const shellVerbatim = checkVerbatim(originalHtml, shell);
ok('A3 clears a from-scratch shell', !shellVerbatim.fired, JSON.stringify({ prose: shellVerbatim.prose, code: shellVerbatim.code }));

console.log('\naudit: fingerprint');
const fp1 = examFingerprint(original);
ok('fingerprint is stable', fp1 === examFingerprint(original) && fp1.length === 12, fp1);
const poked = JSON.parse(JSON.stringify(original));
poked.style.colors = [...poked.style.colors, '#123456'];
ok('fingerprint changes when the exam evidence changes', examFingerprint(poked) !== fp1);

console.log('\ncli');
const cli = join(root, 'bin/craft-lite.mjs');
const version = spawnSync(process.execPath, [cli, 'version'], { encoding: 'utf8' });
ok('version', /^\d+\.\d+\.\d+$/.test(version.stdout.trim()), version.stdout.trim());
const help = spawnSync(process.execPath, [cli, 'help'], { encoding: 'utf8' });
ok('help mentions study', help.status === 0 && help.stdout.includes('craft-lite study'));
const noArgs = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
ok('no args exits 2', noArgs.status === 2, String(noArgs.status));

let gateDir;
try {
  gateDir = await mkdtemp(join(tmpdir(), 'craft-lite-gate-'));
} catch {
  gateDir = await mkdtemp(join(root, '.test-'));
}
try {
  const project = join(gateDir, 'project');
  await mkdir(project, { recursive: true });
  await study(join(fixtures, 'original.html'), project, { log: () => {} });
  const gatePass = spawnSync(process.execPath, [cli, 'check', project, join(fixtures, 'rebuilt.html'), '--min', '90', '--quiet'], { encoding: 'utf8' });
  ok('--min passes a good rebuild', gatePass.status === 0, `exit ${gatePass.status}`);
  const weak = join(project, 'weak.html');
  await (await import('node:fs/promises')).writeFile(weak, '<html><body><h1>Acme Tools</h1></body></html>');
  const gateFail = spawnSync(process.execPath, [cli, 'check', project, weak, '--min', '90', '--quiet'], { encoding: 'utf8' });
  ok('--min fails a weak rebuild', gateFail.status === 1, `exit ${gateFail.status}`);

  console.log('\naudit: plateau and project wiring');
  const plateauDir = join(project, 'checks');
  const flat = await checkPlateau(plateauDir, { window: 2 });
  ok('A4 does not fire without history', !flat.fired, flat.evidence);

  const a1 = await auditProject(project, join(fixtures, 'rebuilt.html'));
  ok('project audit runs end to end', typeof a1.ok === 'boolean' && a1.rows.length === 5, String(a1.rows.length));
  ok('project audit pins an exam fingerprint', a1.rows.find((r) => r.rule.includes('A5')).fingerprint === examFingerprint(JSON.parse(await readFile(join(project, 'capture/report.json'), 'utf8'))));
  const a2 = await auditProject(project, join(fixtures, 'rebuilt.html'));
  ok('A5 stays quiet on an unchanged exam', !a2.rows.find((r) => r.rule.includes('A5')).fired, a2.rows.find((r) => r.rule.includes('A5')).evidence);

  const copyFile = join(project, 'copy.html');
  await (await import('node:fs/promises')).writeFile(copyFile, originalHtml);
  const copyAudit = await auditProject(project, copyFile);
  ok('project audit flags a copied source', copyAudit.rows.find((r) => r.rule.includes('A3')).fired);

  const auditCmd = spawnSync(process.execPath, [cli, 'audit', project, join(fixtures, 'rebuilt.html')], { encoding: 'utf8' });
  ok('audit command exits 1 when a probe fires', auditCmd.status === 1, `exit ${auditCmd.status}`);
  ok('audit command renders a table', auditCmd.stdout.includes('空壳基线') && auditCmd.stdout.includes('逐字抄袭'), auditCmd.stdout.slice(0, 60));

  const checkAudit = spawnSync(process.execPath, [cli, 'check', project, join(fixtures, 'rebuilt.html'), '--audit', '--quiet'], { encoding: 'utf8' });
  ok('check --audit also gates on the exam', checkAudit.status === 1, `exit ${checkAudit.status}`);
} finally {
  await rm(gateDir, { recursive: true, force: true });
}

console.log('\nserve');
const { server, url } = await serve(fixtures, { port: 8891, log: () => {} });
try {
  const res = await fetch(url + 'original.html');
  ok('serves html', res.status === 200 && res.headers.get('content-type').includes('text/html'), String(res.status));
  const miss = await fetch(url + 'nope.html');
  ok('404 for missing', miss.status === 404, String(miss.status));

  const remote = await collectCss('<link rel="stylesheet" href="linked.css">', url);
  ok('linked css fetched over http', remote.fetched.length === 2 && remote.fetched.every((f) => f.ok), JSON.stringify(remote.fetched.map((f) => f.href)));
  ok('fetched css has the tokens', remote.css.includes('--acc:#3b82f6'), String(remote.bytes));
} finally {
  server.close();
}

console.log(`\n${failures.length ? 'FAILED' : 'PASSED'}: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
