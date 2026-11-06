// craft-lite · study.mjs — the Study step: fetch a target and write the evidence down.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { extract } from './extract.mjs';

export async function loadSource(target) {
  if (/^https?:\/\//i.test(target)) {
    const res = await fetch(target, {
      redirect: 'follow',
      headers: { 'user-agent': 'craft-lite/0.1 (+clean-room study)' },
    });
    if (!res.ok) throw new Error(`fetch ${target} → HTTP ${res.status}`);
    return { html: await res.text(), url: res.url || target };
  }
  return { html: await readFile(target, 'utf8'), url: target };
}

export function summaryMarkdown(report, { at = new Date().toISOString() } = {}) {
  const L = [];
  L.push(`# Study — ${report.title || '(no title)'}`);
  L.push('');
  L.push(`- target: ${report.url}`);
  L.push(`- at: ${at}`);
  L.push(`- bytes: html ${report.bytes.html} · css ${report.bytes.css} · js ${report.bytes.js}`);
  L.push(`- counts: h ${report.counts.headings} · a ${report.counts.links} · img ${report.counts.images} · input ${report.counts.inputs} · button ${report.counts.buttons}`);
  L.push('');
  L.push('## Headings');
  L.push(report.headings.length ? report.headings.map((h) => `- h${h.level} ${h.text}`).join('\n') : '- (none)');
  L.push('');
  const vars = Object.entries(report.style.vars);
  L.push('## Design tokens (CSS custom properties)');
  L.push(vars.length ? vars.map(([k, v]) => `- \`${k}\`: \`${v}\``).join('\n') : '- (none)');
  L.push('');
  L.push(`## Colours (${report.style.colors.length})`);
  L.push(report.style.colors.map((c) => `\`${c}\``).join(' ') || '—');
  L.push('');
  L.push('## Type, radius, spacing');
  L.push(`- font sizes: ${report.style.fontSizes.join(' | ') || '—'}`);
  L.push(`- fonts: ${report.style.fontFamilies.join(' | ') || '—'}`);
  L.push(`- radii: ${report.style.radii.join(' | ') || '—'}`);
  L.push(`- spacing: ${report.style.spacing.join(' | ') || '—'}`);
  L.push(`- media queries: ${report.style.mediaQueries.join(' | ') || '—'}`);
  L.push('');
  L.push('## Behaviour');
  for (const [k, v] of Object.entries(report.features)) L.push(`- ${k}: ${v === true ? 'yes' : v === false ? 'no' : v}`);
  L.push('');
  L.push('## Tag histogram');
  L.push(Object.entries(report.tags).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}:${n}`).join(' ') || '—');
  L.push('');
  L.push('## Text sample');
  L.push('> ' + report.text.sample);
  L.push('');
  return L.join('\n');
}

export async function study(target, projectDir, { log = () => {} } = {}) {
  const { html, url } = await loadSource(target);
  const capture = join(projectDir, 'capture');
  await mkdir(capture, { recursive: true });

  const report = extract(html, { url });
  const at = new Date().toISOString();
  await writeFile(join(capture, 'raw.html'), html);
  await writeFile(join(capture, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(capture, 'summary.md'), summaryMarkdown(report, { at }));

  const craftPath = join(projectDir, 'craft.json');
  let craft = null;
  try {
    craft = JSON.parse(await readFile(craftPath, 'utf8'));
  } catch {}
  const meta = craft || {
    tool: 'craft-lite',
    version: '0.1.0',
    mode: 'clean-room (static evidence only)',
    target: url,
    created: at,
    status: {},
    history: [],
  };
  meta.target = url;
  meta.status = { ...(meta.status || {}), study: 'done' };
  meta.history = [...(meta.history || []), { at, step: 'study', note: `${report.bytes.html} B html, ${report.style.colors.length} colours, ${Object.keys(report.style.vars).length} tokens` }];
  await writeFile(craftPath, JSON.stringify(meta, null, 2));

  log(summaryMarkdown(report, { at }));
  return { report, craft: meta, capture };
}
