export function httpUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Crawl URLs must be HTTP(S) without credentials');
  url.hash = ''; return url;
}
export function integer(value: number, min: number, max: number, name: string): number {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}
function decodeXml(value: string): string {
  return value.replace(/&([^;]+);/g, (_, entity: string) => {
    const known: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (known[entity] !== undefined) return known[entity];
    const n = /^#x[0-9a-f]+$/i.test(entity) ? parseInt(entity.slice(2), 16) : /^#\d+$/.test(entity) ? Number(entity.slice(1)) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) throw new Error('Invalid sitemap entity');
    return String.fromCodePoint(n);
  });
}
/** Bounded sitemap subset: urlset/url/loc or sitemapindex/sitemap/loc; no DTD/entities. */
export function parseSitemap(xml: string): { index: boolean; locations: string[] } {
  if (Buffer.byteLength(xml) > 5_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Sitemap too large or contains a forbidden DTD/entity declaration');
  const tokens = xml.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g) ?? [];
  const stack: Array<{ raw: string; local: string; uri: string; ns: Record<string,string> }> = [];
  let root = ''; let rootUri = ''; let text = ''; let closed = false;
  const locations: string[] = [];
  const isLoc = () => stack.at(-1)?.local === 'loc' && stack.at(-1)?.uri === rootUri;
  for (const token of tokens) {
    if (token.startsWith('<!--') || token.startsWith('<?')) continue;
    if (token.startsWith('<![CDATA[')) { if (isLoc()) text += token.slice(9, -3); continue; }
    if (token.startsWith('</')) {
      const raw = /^<\/([\w:.-]+)\s*>$/.exec(token)?.[1];
      if (!raw || stack.at(-1)?.raw !== raw) throw new Error('Malformed sitemap XML');
      if (isLoc()) { if (!text.trim()) throw new Error('Empty sitemap loc'); locations.push(text.trim()); text = ''; }
      stack.pop(); if (!stack.length) closed = true;
    } else if (token.startsWith('<')) {
      const match = /^<([\w:.-]+)(?:\s+[^<>]*)?\s*\/?\s*>$/.exec(token);
      if (!match) throw new Error('Malformed sitemap XML');
      if (stack.length >= 32) throw new Error('Sitemap nesting exceeds 32');
      const raw = match[1]!; const parts = raw.split(':'); const local = parts.at(-1)!;
      const ns = { ...(stack.at(-1)?.ns ?? {}) };
      for (const attr of token.matchAll(/\sxmlns(?::([\w.-]+))?\s*=\s*(["'])(.*?)\2/g)) ns[attr[1] ?? ''] = decodeXml(attr[3]!);
      if (Object.keys(ns).length > 64) throw new Error('Sitemap namespaces exceed 64');
      const prefix = parts.length > 1 ? parts[0]! : '';
      if (prefix && ns[prefix] === undefined) throw new Error('Undeclared sitemap namespace');
      const uri = ns[prefix] ?? '';
      if (!stack.length) {
        if (root || closed || !['urlset', 'sitemapindex'].includes(local)) throw new Error('Expected one sitemap root');
        root = local; rootUri = uri;
      }
      const pageLoc = local === 'loc' && uri === rootUri;
      if (pageLoc && !(stack.length === 2 && stack[0]!.local === root && stack[1]!.local === (root === 'urlset' ? 'url' : 'sitemap') && stack[1]!.uri === rootUri)) throw new Error('Unexpected sitemap loc');
      if (isLoc()) throw new Error('Nested markup in sitemap loc');
      if (token.endsWith('/>')) { if (pageLoc) throw new Error('Empty sitemap loc'); if (!stack.length) closed = true; }
      else stack.push({ raw, local, uri, ns });
    } else {
      if (isLoc()) text += decodeXml(token);
      else if (!stack.length && token.trim()) throw new Error('Text outside sitemap root');
    }
  }
  if (stack.length || !root || !closed) throw new Error('Incomplete sitemap XML');
  return { index: root === 'sitemapindex', locations };
}
async function boundedText(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader(); if (!reader) return '';
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length; if (size > max) throw new Error('Input exceeds byte limit'); chunks.push(next.value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks).toString('utf8');
}
export async function sitemapText(url: URL, origin: string): Promise<string> {
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (url.origin !== origin) throw new Error('Cross-origin sitemap redirect refused');
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
    if ([301,302,303,307,308].includes(response.status)) {
      const next = response.headers.get('location'); await response.body?.cancel();
      if (!next) throw new Error('Sitemap redirect lacks Location'); url = httpUrl(new URL(next, url).href); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Sitemap HTTP ${response.status}`); }
    return boundedText(response, 5_000_000);
  }
  throw new Error('Too many sitemap redirects');
}
