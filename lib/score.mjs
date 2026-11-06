// craft-lite · score.mjs — the Check step: compare a rebuild with the original, dimension by dimension.

import { extract } from './extract.mjs';

const jaccard = (a, b) => {
  const A = new Set(a);
  const B = new Set(b);
  if (!A.size && !B.size) return 1;
  let hit = 0;
  for (const x of A) if (B.has(x)) hit++;
  return hit / new Set([...A, ...B]).size;
};

const cosine = (a, b) => {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[k] || 0;
    const y = b[k] || 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
};

const coverage = (expected, got) => (expected.length ? expected.filter((x) => got.includes(x)).length / expected.length : 1);

// weights sum to 100
export const DIMENSIONS = [
  { key: 'palette', name: 'palette', weight: 20 },
  { key: 'tokens', name: 'tokens', weight: 15 },
  { key: 'headings', name: 'headings', weight: 15 },
  { key: 'structure', name: 'structure', weight: 15 },
  { key: 'behaviour', name: 'behaviour', weight: 20 },
  { key: 'copy', name: 'copy', weight: 10 },
  { key: 'size', name: 'size', weight: 5 },
];

export function score(original, rebuilt) {
  const origVars = Object.keys(original.style.vars);
  const builtVars = Object.keys(rebuilt.style.vars);
  const variant = (r, k) => [...(r.style.varVariants?.[k] || [r.style.vars[k]])].sort().join("|");
  const sameVarValue = origVars.filter((k) => variant(original, k) === variant(rebuilt, k)).length;

  const wantedFlags = Object.keys(original.features).filter((k) => original.features[k] === true);

  const values = {
    palette: jaccard(original.style.colors, rebuilt.style.colors),
    tokens: 0.5 * jaccard(origVars, builtVars) + 0.5 * (origVars.length ? sameVarValue / origVars.length : 1),
    headings: coverage(original.headings.map((h) => h.text), rebuilt.headings.map((h) => h.text)),
    structure: cosine(original.tags, rebuilt.tags),
    behaviour: coverage(wantedFlags, wantedFlags.filter((k) => rebuilt.features[k] === true)),
    copy: jaccard(
      [...original.text.fingerprint.words, ...original.text.fingerprint.cjk],
      [...rebuilt.text.fingerprint.words, ...rebuilt.text.fingerprint.cjk],
    ),
    // payload: the html plus any stylesheets it pulls in (inline CSS already rides inside html)
    size: (() => {
      const load = (r) => r.bytes.html + (r.bytes.cssExternal || 0);
      const a = load(original);
      const b = load(rebuilt);
      return Math.min(a, b) / Math.max(a, b);
    })(),
  };

  const dims = DIMENSIONS.map((d) => ({
    ...d,
    value: Math.round(values[d.key] * 1000) / 1000,
    points: Math.round(d.weight * values[d.key] * 10) / 10,
  }));
  const total = Math.round(dims.reduce((s, d) => s + d.points, 0) * 10) / 10;

  const gaps = [];
  const missColors = original.style.colors.filter((c) => !rebuilt.style.colors.includes(c));
  if (missColors.length) gaps.push(`palette: ${missColors.length} colour(s) missing — ${missColors.join(' ')}`);
  const extraColors = rebuilt.style.colors.filter((c) => !original.style.colors.includes(c));
  if (extraColors.length) gaps.push(`palette: ${extraColors.length} colour(s) not in the original — ${extraColors.join(' ')}`);
  const missVars = origVars.filter((k) => !builtVars.includes(k));
  if (missVars.length) gaps.push(`tokens: missing ${missVars.join(' ')}`);
  const extraVars = builtVars.filter((k) => !origVars.includes(k));
  if (extraVars.length) gaps.push(`tokens: extra ${extraVars.join(' ')} (the original has no such token)`);
  const changedVars = origVars.filter((k) => builtVars.includes(k) && variant(original, k) !== variant(rebuilt, k));
  if (changedVars.length) gaps.push(`tokens: value differs — ${changedVars.map((k) => `${k} [${variant(original, k)}] → [${variant(rebuilt, k)}]`).join(', ')}`);
  const missHeadings = original.headings.filter((h) => !rebuilt.headings.some((b) => b.text === h.text));
  if (missHeadings.length) gaps.push(`headings: missing ${missHeadings.map((h) => `h${h.level} "${h.text}"`).join(', ')}`);
  const missFlags = wantedFlags.filter((k) => rebuilt.features[k] !== true);
  if (missFlags.length) gaps.push(`behaviour: missing ${missFlags.join(', ')}`);
  for (const k of ['inputs', 'buttons', 'links', 'images']) {
    if (original.counts[k] !== rebuilt.counts[k]) {
      gaps.push(`counts: ${k} original ${original.counts[k]} vs rebuild ${rebuilt.counts[k]}`);
    }
  }

  return { score: total, dims, gaps };
}

export function checkSources(originalReport, rebuiltHtml, { rebuiltPath = '', extraCss = '', stylesheets = [] } = {}) {
  const rebuilt = extract(rebuiltHtml, { url: rebuiltPath, extraCss, stylesheets });
  return { rebuilt, ...score(originalReport, rebuilt) };
}

export function reportMarkdown(result, { originalUrl, rebuiltPath, at = new Date().toISOString() } = {}) {
  const lines = [];
  lines.push(`# Check — similarity ${result.score} / 100`);
  lines.push('');
  lines.push(`- original: ${originalUrl || '(unknown)'}`);
  lines.push(`- rebuild: ${rebuiltPath || '(unknown)'}`);
  lines.push(`- at: ${at}`);
  lines.push('');
  lines.push('| dimension | weight | ratio | points |');
  lines.push('|---|---|---|---|');
  for (const d of result.dims) lines.push(`| ${d.name} | ${d.weight} | ${(d.value * 100).toFixed(0)}% | ${d.points} |`);
  lines.push('');
  lines.push('## What does not match yet');
  lines.push(result.gaps.length ? result.gaps.map((g) => `- ${g}`).join('\n') : '- everything lines up');
  lines.push('');
  return lines.join('\n');
}
