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
} finally {
  server.close();
}

console.log(`\n${failures.length ? 'FAILED' : 'PASSED'}: ${pass} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
