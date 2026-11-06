// craft-lite · check.mjs — the Check step: read the study, measure the rebuild, write the diff.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkSources, reportMarkdown } from './score.mjs';

export async function check(projectDir, builtFile, { log = () => {} } = {}) {
  const original = JSON.parse(await readFile(join(projectDir, 'capture/report.json'), 'utf8'));
  const rebuiltHtml = await readFile(builtFile, 'utf8');

  const at = new Date().toISOString();
  const result = checkSources(original, rebuiltHtml, { rebuiltPath: builtFile });
  const checks = join(projectDir, 'checks');
  await mkdir(checks, { recursive: true });
  const stamp = at.replace(/[:.]/g, '-');
  const payload = {
    at, original: original.url, rebuilt: builtFile,
    score: result.score, dims: result.dims, gaps: result.gaps,
  };
  await writeFile(join(checks, `${stamp}.json`), JSON.stringify(payload, null, 2));
  const md = reportMarkdown(result, { originalUrl: original.url, rebuiltPath: builtFile, at });
  await writeFile(join(checks, `${stamp}.md`), md);

  const craftPath = join(projectDir, 'craft.json');
  let craft = null;
  try {
    craft = JSON.parse(await readFile(craftPath, 'utf8'));
  } catch {}
  if (craft) {
    craft.status = { ...(craft.status || {}), check: 'done' };
    craft.history = [...(craft.history || []), { at, step: 'check', note: `score ${result.score}` }];
    await writeFile(craftPath, JSON.stringify(craft, null, 2));
  }

  log(md);
  return { ...payload, markdown: md, reportFile: join(checks, `${stamp}.json`) };
}
