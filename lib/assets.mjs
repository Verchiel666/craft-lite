// craft-lite · assets.mjs — external stylesheets carry most of a real site's design tokens.
// study/check both use this: read linked .css (one level of @import too) so the evidence
// is not blind just because the tokens live in a file instead of a <style> block.

const LIMITS = { maxFiles: 8, maxBytes: 1024 * 1024, depth: 1 };

export function stylesheetRefs(html, base = '') {
  const refs = [];
  let m;
  const re = /<link\b[^>]*>/gi;
  while ((m = re.exec(html))) {
    const tag = m[0];
    if (!/rel\s*=\s*["']?[^"'>]*(stylesheet|preload)/i.test(tag)) continue;
    const href = (tag.match(/href\s*=\s*["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    refs.push({ href, absolute: resolveRef(base, href) });
  }
  return refs;
}

export function resolveRef(base, href) {
  if (/^(data:|about:|javascript:)/i.test(href)) return '';
  if (/^https?:\/\//i.test(href)) return href;
  if (!base) return '';
  if (/^https?:\/\//i.test(base)) {
    try { return new URL(href, base).href; } catch { return ''; }
  }
  // local file: base is a path
  const dir = base.replace(/[\\/][^\\/]*$/, '');
  if (href.startsWith('/')) return href; // absolute path on disk: leave it, caller decides
  return `${dir}/${href}`.replace(/\/\.\//g, '/');
}

const isUrl = (s) => /^https?:\/\//i.test(s);

async function load(ref, fetchImpl) {
  const res = await fetchImpl(ref, {
    redirect: 'follow',
    headers: { 'user-agent': 'craft-lite/0.1 (+clean-room study)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

async function loadLocal(ref) {
  const { readFile } = await import('node:fs/promises');
  return await readFile(ref, 'utf8');
}

function importsOf(css, base) {
  const out = [];
  let m;
  const re = /@import\s+(?:url\()?\s*["']?([^"')\s;]+)["']?\s*\)?/gi;
  while ((m = re.exec(css))) {
    const absolute = resolveRef(base, m[1]);
    if (absolute) out.push({ href: m[1], absolute });
  }
  return out;
}

/**
 * Gather the CSS of a page: linked stylesheets (and their one level of @import).
 * Never throws: a stylesheet that fails is reported, not fatal.
 */
export async function collectCss(html, base = '', options = {}) {
  const { maxFiles, maxBytes, depth } = { ...LIMITS, ...options };
  const fetchImpl = options.fetch || globalThis.fetch;
  const fetched = [];
  let css = '';
  let bytes = 0;

  const queue = stylesheetRefs(html, base).map((r) => ({ ...r, level: 0 }));
  const seen = new Set();

  while (queue.length && fetched.length < maxFiles && bytes < maxBytes) {
    const ref = queue.shift();
    if (!ref.absolute || seen.has(ref.absolute)) continue;
    seen.add(ref.absolute);
    try {
      const thing = isUrl(ref.absolute) ? await load(ref.absolute, fetchImpl) : await loadLocal(ref.absolute);
      const text = thing.slice(0, Math.max(0, maxBytes - bytes));
      css += `\n/* ${ref.absolute} */\n${text}`;
      bytes += text.length;
      fetched.push({ href: ref.href, url: ref.absolute, bytes: text.length, ok: true });
      if (ref.level < depth) {
        for (const imp of importsOf(text, ref.absolute)) queue.push({ ...imp, level: ref.level + 1 });
      }
    } catch (err) {
      fetched.push({ href: ref.href, url: ref.absolute, bytes: 0, ok: false, error: err.message });
    }
  }

  return { css, fetched, bytes };
}
