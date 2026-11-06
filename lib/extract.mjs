// craft-lite · extract.mjs — turn a page into checkable evidence (static, no browser).
// Everything here is a measurable fact: token names, values, counts, fingerprints.

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;

export const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

export function strip(html) {
  return norm(String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"'));
}

const uniq = (a) => [...new Set(a)];

function styleBlocks(html) {
  const inline = [];
  const external = [];
  let m;
  const re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = re.exec(html))) inline.push(m[1]);
  const linkRe = /<link[^>]+href=["']([^"']+\.css[^"']*)["']/gi;
  while ((m = linkRe.exec(html))) external.push(m[1]);
  return { css: inline.join('\n'), external };
}

function scriptBlocks(html) {
  const inline = [];
  const srcs = [];
  let m;
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = re.exec(html))) inline.push(m[1]);
  const sre = /<script[^>]*\bsrc=["']([^"']+)["']/gi;
  while ((m = sre.exec(html))) srcs.push(m[1]);
  return { js: inline.join('\n'), srcs };
}

export function extract(html, { url = '', extraCss = '', stylesheets = [] } = {}) {
  const src = String(html ?? '');
  const title = norm((src.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
  const description = norm((src.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || [])[1]);
  const lang = norm((src.match(/<html[^>]*\blang=["']([^"']*)["']/i) || [])[1]);

  const headings = [];
  const hre = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m;
  while ((m = hre.exec(src))) {
    const text = strip(m[2]);
    if (text) headings.push({ level: Number(m[1]), text });
  }

  const tags = {};
  const tagRe = /<([a-zA-Z][a-zA-Z0-9-]*)\b/g;
  while ((m = tagRe.exec(src))) {
    const t = m[1].toLowerCase();
    if (['script', 'style', 'meta', 'link', 'html', 'head', 'title', 'body'].includes(t)) continue;
    tags[t] = (tags[t] || 0) + 1;
  }

  const inline = styleBlocks(src);
  const external = inline.external;
  const css = inline.css + (extraCss ? `\n/* external stylesheets */\n${extraCss}` : '');
  const { js, srcs } = scriptBlocks(src);

  const vars = {};
  const varVariants = {};
  let vm;
  const vre = /--([\w-]+)\s*:\s*([^;}]+)/g;
  while ((vm = vre.exec(css))) {
    const name = '--' + vm[1];
    const value = norm(vm[2]);
    vars[name] = value; // last wins, the way CSS resolves it
    varVariants[name] = [...new Set([...(varVariants[name] || []), value])]; // every value it takes
  }

  const inlineStyles = (src.match(/style=["'][^"']*["']/g) || []).join(' ');
  const colors = uniq((css + ' ' + inlineStyles).match(COLOR_RE) || [])
    .map((c) => norm(c).toLowerCase());

  const grab = (re) => {
    const out = [];
    let x;
    while ((x = re.exec(css))) out.push(norm(x[1]));
    return uniq(out);
  };

  const features = {
    cssVariables: /var\(--/.test(css),
    prefersColorScheme: /prefers-color-scheme/.test(css),
    grid: /display\s*:\s*grid/.test(css),
    flex: /display\s*:\s*flex/.test(css),
    mediaQuery: /@media[^{]+/.test(css),
    inlineJs: js.trim().length > 0,
    externalJs: srcs.length > 0,
    externalCss: external.length > 0,
    classToggle: /classList\.(toggle|add|remove)/.test(js),
    datasetFilter: /dataset\./.test(js),
    transitions: /transition\s*:/.test(css),
    hoverRules: /:hover/.test(css),
    customPropertiesFallback: /var\(--[\w-]+\s*,/.test(css),
  };

  const text = strip(src);
  const words = uniq(text.toLowerCase().match(/[a-z][a-z0-9.+#-]{2,}/g) || []);
  const cjk = uniq((text.match(/[\u4e00-\u9fff]{2,}/g) || []).flatMap((run) => {
    const out = [];
    for (let i = 0; i + 2 <= run.length; i++) out.push(run.slice(i, i + 2));
    return out;
  }));

  return {
    url,
    title,
    description,
    lang,
    bytes: {
      html: Buffer.byteLength(src),
      css: Buffer.byteLength(css),
      js: Buffer.byteLength(js),
      cssExternal: Buffer.byteLength(extraCss || ''),
    },
    counts: {
      headings: headings.length,
      links: (src.match(/<a\b/gi) || []).length,
      images: (src.match(/<img\b/gi) || []).length,
      inputs: (src.match(/<input\b/gi) || []).length,
      buttons: (src.match(/<button\b/gi) || []).length,
      externalCss: external.length,
      externalJs: srcs.length,
    },
    headings,
    tags,
    stylesheets,
    style: {
      vars,
      varVariants,
      colors,
      fontSizes: grab(/font-size\s*:\s*([^;}]+)/g),
      fontFamilies: grab(/font-family\s*:\s*([^;}]+)/g),
      radii: grab(/border-radius\s*:\s*([^;}]+)/g),
      spacing: grab(/(?:gap|padding|margin)\s*:\s*([^;}]+)/g),
      mediaQueries: (css.match(/@media[^{]+/g) || []).map(norm),
    },
    features,
    text: {
      words: words.length,
      cjk: cjk.length,
      sample: text.slice(0, 240),
      fingerprint: { words, cjk },
    },
  };
}
