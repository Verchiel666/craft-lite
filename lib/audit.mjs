// craft-lite · audit.mjs — audit the exam, not the answer.
//
// The 7 dimensions in score.mjs all measure *surface* similarity. None of them ask
// "does this page actually do anything?" or "was the original copied verbatim?".
// This module plants known faults and measures whether the scorer notices.
//
//   A1 shell     a page built only from the study report (no content, no working code)
//   A2 copy-pay  does reusing the original's prose RAISE the score?
//   A3 verbatim  is this a clean-room rebuild or a copy of the source?
//   A4 plateau   has the score stopped moving? then stop.
//   A5 attribution  did the exam itself change since last run?

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { extract, strip } from './extract.mjs';
import { score, DIMENSIONS } from './score.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (x) => `${(x * 100).toFixed(1)}%`;

// ---------------------------------------------------------------- A1 shell page
// Build the highest-scoring page possible from the study report alone: every token,
// every colour, every behaviour flag, the right tag histogram and byte size — and
// no real content and no working interaction. Whatever this scores is the score you
// can get without doing the job.
export function shellPage(report) {
  const variants = Object.entries(report.style?.varVariants || {});
  const maxLen = Math.max(1, ...variants.map(([, v]) => v.length));
  const varsFirst = variants.map(([k, v]) => `${k}:${v[0]};`).join('');
  const varBlocks = [];
  for (let i = 1; i < maxLen; i++) {
    const decl = variants.filter(([, v]) => v[i] != null).map(([k, v]) => `${k}:${v[i]};`).join('');
    if (!decl) continue;
    varBlocks.push(i === 1 ? `@media (prefers-color-scheme: light){:root{${decl}}}` : `:root{${decl}}`);
  }
  const colorRules = (report.style?.colors || [])
    .map((c, i) => `.k${i}{color:${c}}`).join('');

  const css = [
    `:root{${varsFirst}}`,
    ...varBlocks,
    colorRules,
    '*{box-sizing:border-box}',
    'body{margin:0;color:var(--fg)}',
    '.g{display:grid;gap:8px}',
    '.f{display:flex;gap:8px}',
    '.t{transition:color .15s}',
    '.t:hover{color:var(--acc)}',
  ].join('\n');

  const js = `const n=document.querySelectorAll('a');n.forEach(function(e){e.classList.toggle('on',false)});const g=document.body.dataset.group;`;

  const headByLevel = {};
  for (const h of report.headings || []) (headByLevel[h.level] ||= []).push(h.text);
  const usedH = {};
  const body = [];
  for (const [tag, count] of Object.entries(report.tags || {})) {
    for (let i = 0; i < count; i++) {
      const lvl = tag.match(/^h([1-6])$/)?.[1];
      if (lvl) {
        usedH[tag] = (usedH[tag] ?? -1) + 1;
        const text = (headByLevel[lvl] || [])[usedH[tag]] ?? 'x';
        body.push(`<${tag}>${esc(text)}</${tag}>`);
      } else if (tag === 'input') body.push('<input>');
      else if (tag === 'button') body.push('<button>b</button>');
      else if (tag === 'a') body.push('<a href="#">l</a>');
      else if (tag === 'img') body.push('<img alt="">');
      else body.push(`<${tag}></${tag}>`);
    }
  }

  const shell = `<!doctype html><html lang="${esc(report.lang || 'en')}"><head><meta charset="utf-8">`
    + `<title>${esc(report.title || '')}</title><style>\n${css}\n</style></head><body>`
    + body.join('') + `<script>${js}</script></body></html>`;

  // pad to the original payload so the size dimension pays out too
  const want = report.bytes?.html || 0;
  const pad = want - Buffer.byteLength(shell);
  if (pad > 0) return shell.replace('</body>', `${'<!-- pad -->'.repeat(Math.ceil(pad / 12))}</body>`);
  return shell;
}

export function checkShell(original, { threshold = 0.70 } = {}) {
  const html = shellPage(original);
  const shell = extract(html);
  const r = score(original, shell);
  const ratio = r.score / 100;
  return {
    rule: 'A1 空壳基线',
    fired: ratio >= threshold,
    score: r.score,
    threshold: threshold * 100,
    dims: r.dims.map((d) => ({ key: d.key, value: d.value, points: d.points, weight: d.weight })),
    evidence: `只用 study 报告拼一个空壳页（${Buffer.byteLength(html)} 字节，零真实内容、零可用交互）在现考卷上得 ${r.score}/100`,
    html,
  };
}

// ------------------------------------------------------- A2 does copying pay?
// The clean-room red line says "do not copy the original's copy text". If reusing it
// scores HIGHER, the exam is paying for the thing the method forbids.
export function checkCopyIncentive(original, faithfulHtml) {
  const clean = score(original, extract(faithfulHtml));
  const words = [...(original.text?.fingerprint?.words || []), ...(original.text?.fingerprint?.cjk || [])];
  const para = `<p>${esc(words.join(' '))}</p>`;
  const plagiarised = faithfulHtml.replace(/<\/body>/i, `${para}</body>`);
  const copy = score(original, extract(plagiarised));
  const delta = Math.round((copy.score - clean.score) * 10) / 10;
  const cleanCopy = clean.dims.find((d) => d.key === 'copy');
  const copyCopy = copy.dims.find((d) => d.key === 'copy');
  return {
    rule: 'A2 抄文案有奖励',
    fired: delta > 0 && copyCopy.value > cleanCopy.value,
    clean: clean.score,
    plagiarised: copy.score,
    delta,
    copyClean: cleanCopy.value,
    copyPlagiarised: copyCopy.value,
    evidence: `净室成品（用自己的话）得 ${clean.score}；把原作文案塞回去得 ${copy.score}（${delta >= 0 ? '+' : ''}${delta}）`
      + `，copy 维度 ${pct(cleanCopy.value)} → ${pct(copyCopy.value)}`,
  };
}

// ------------------------------------------------------------------ A3 verbatim
// A word-for-word copy of the source scores 100/100 today and nothing flags it.
// Compare only what a copier would lift and a clean-room rebuild must not: the prose
// and the script bodies. Design tokens and tag histograms are *supposed* to match, so
// comparing them would flag every faithful rebuild as plagiarism.
const proseSeq = (html) => strip(String(html || '')).toLowerCase()
  .replace(/[^a-z0-9\u4e00-\u9fff]+/g, ' ').trim().split(' ').filter(Boolean);
const codeSeq = (html) => [...String(html || '').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
  .map((m) => m[1]).join(' ').toLowerCase()
  .replace(/[^a-z0-9$]+/g, ' ').trim().split(' ').filter(Boolean);

export function shingleSet(seq, k = 6) {
  const set = new Set();
  for (let i = 0; i + k <= seq.length; i++) set.add(seq.slice(i, i + k).join('\u0001'));
  return set;
}
function containment(aHtml, bHtml, seqFn, k) {
  const A = shingleSet(seqFn(aHtml), k);
  const B = shingleSet(seqFn(bHtml), k);
  if (!B.size) return { ratio: 0, n: 0 };
  let hit = 0;
  for (const s of B) if (A.has(s)) hit++;
  return { ratio: hit / B.size, n: B.size };
}
export function checkVerbatim(originalHtml, rebuiltHtml, { threshold = 0.5, k = 6 } = {}) {
  const prose = containment(originalHtml, rebuiltHtml, proseSeq, k);
  const code = containment(originalHtml, rebuiltHtml, codeSeq, k);
  const worst = Math.max(prose.ratio, code.ratio);
  return {
    rule: 'A3 逐字抄袭',
    fired: worst >= threshold,
    prose: prose.ratio,
    code: code.ratio,
    threshold,
    evidence: `文案 ${pct(prose.ratio)}、脚本 ${pct(code.ratio)} 的 ${k}-gram 与原件逐字重合（阈值 ${pct(threshold)}）`,
  };
}

// ------------------------------------------------------------------- A4 plateau
export async function checkPlateau(checksDir, { window = 3, minGain = 0.5 } = {}) {
  let files = [];
  try { files = (await readdir(checksDir)).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort(); } catch {}
  const scores = [];
  for (const f of files) {
    try {
      const j = JSON.parse(await readFile(join(checksDir, f), 'utf8'));
      if (typeof j.score === 'number') scores.push({ file: f, score: j.score });
    } catch {}
  }
  if (scores.length < window + 1) {
    return { rule: 'A4 该刹车', fired: false, n: scores.length, evidence: `历史 check 只有 ${scores.length} 次，还不够判断趋势` };
  }
  const tail = scores.slice(-(window + 1));
  const gain = Math.round((tail[tail.length - 1].score - tail[0].score) * 10) / 10;
  return {
    rule: 'A4 该刹车',
    fired: Math.abs(gain) < minGain,
    gain,
    n: scores.length,
    scores: tail.map((s) => s.score),
    evidence: `最近 ${window + 1} 次 check：${tail.map((s) => s.score).join(' → ')}，净变化 ${gain >= 0 ? '+' : ''}${gain}（阈值 ${minGain}）`,
  };
}

// -------------------------------------------------------------- A5 attribution
// A score is only comparable to an earlier score if the exam did not change.
export function examFingerprint(report) {
  const evidence = {
    dims: DIMENSIONS.map((d) => ({ key: d.key, weight: d.weight })),
    colors: [...(report.style?.colors || [])].sort(),
    vars: report.style?.vars || {},
    varVariants: report.style?.varVariants || {},
    headings: (report.headings || []).map((h) => `${h.level}:${h.text}`).sort(),
    tags: report.tags || {},
    features: report.features || {},
    words: [...(report.text?.fingerprint?.words || [])].sort(),
    cjk: [...(report.text?.fingerprint?.cjk || [])].sort(),
  };
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex').slice(0, 12);
}

export async function checkAttribution(projectDir, report) {
  const fp = examFingerprint(report);
  const file = join(projectDir, 'checks', '_exam.json');
  let prev = null;
  try { prev = JSON.parse(await readFile(file, 'utf8')); } catch {}
  await mkdir(join(projectDir, 'checks'), { recursive: true });
  await writeFile(file, JSON.stringify({ fingerprint: fp, at: new Date().toISOString(), url: report.url || '' }, null, 2));
  if (!prev) return { rule: 'A5 考卷归因', fired: false, fingerprint: fp, evidence: `首次记录考卷指纹 ${fp}` };
  const changed = prev.fingerprint !== fp;
  return {
    rule: 'A5 考卷归因',
    fired: changed,
    fingerprint: fp,
    previous: prev.fingerprint,
    evidence: changed
      ? `考卷指纹 ${prev.fingerprint} → ${fp}：原作证据或维度权重变了，历史分数不可比`
      : `考卷指纹 ${fp} 未变，历史分数可比`,
  };
}

// --------------------------------------------------------------------- runner
export async function audit({ original, originalHtml, rebuiltHtml, projectDir, builtFile = '' }) {
  const rows = [];
  rows.push(checkShell(original));
  rows.push(checkCopyIncentive(original, rebuiltHtml));
  rows.push(checkVerbatim(originalHtml, rebuiltHtml));
  rows.push(await checkPlateau(join(projectDir, 'checks')));
  rows.push(await checkAttribution(projectDir, original));
  const fired = rows.filter((r) => r.fired);
  return { at: new Date().toISOString(), rebuilt: builtFile, rows, fired: fired.length, ok: fired.length === 0 };
}

export function auditMarkdown(result) {
  const lines = [`# Audit — 考卷自检 ${result.ok ? '通过' : `${result.fired} 项报警`}`, ''];
  lines.push(`- rebuild: ${result.rebuilt || '(unknown)'}`, `- at: ${result.at}`, '');
  lines.push('| rule | verdict | evidence |', '|---|---|---|');
  for (const r of result.rows) lines.push(`| ${r.rule} | ${r.fired ? '🔴 报警' : '🟢 通过'} | ${r.evidence} |`);
  lines.push('');
  return lines.join('\n');
}

// Read a project's evidence off disk and audit the exam against one rebuild.
export async function auditProject(projectDir, builtFile, opts = {}) {
  const original = JSON.parse(await readFile(join(projectDir, 'capture/report.json'), 'utf8'));
  const originalHtml = await readFile(join(projectDir, 'capture/raw.html'), 'utf8');
  const rebuiltHtml = await readFile(builtFile, 'utf8');
  const result = await audit({ original, originalHtml, rebuiltHtml, projectDir, builtFile, ...opts });
  const dir = join(projectDir, 'checks');
  await mkdir(dir, { recursive: true });
  const stamp = result.at.replace(/[:.]/g, '-');
  await writeFile(join(dir, `${stamp}.audit.json`), JSON.stringify(result, null, 2));
  return { ...result, auditFile: join(dir, `${stamp}.audit.json`) };
}
