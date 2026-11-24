import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { profileUrl, type ProfileOptions } from './profile.js';
import type { ProfileReport } from './types.js';
import type { ReportFormat, ReportPaths } from './report/write.js';
import { httpUrl, integer, parseSitemap, sitemapText } from './crawl-input.js';

export interface CrawlOptions extends Omit<ProfileOptions, 'url' | 'collectLinks'> {
  url: string; sitemap?: string; maxPages?: number; concurrency?: number;
}
export interface CrawlPage { url: string; duplicateOf?: string; report?: ProfileReport; error?: string }
export interface CrawlReport {
  schema: 'agent-eye.crawl/v1'; generatedAt: string; url: string; pages: CrawlPage[];
  warnings: string[]; summary: { complete: number; failed: number; totalTokens: number; averageTokens: number; averageNoisePct: number };
  tokenRanking: Array<{ url: string; tokens: number }>; noiseRanking: Array<{ url: string; noisePct: number }>;
  exitCode: 0 | 1;
}
/** Same-origin discovery and bounded profiling. Crawl is passive unless probes are explicitly enabled. */
export async function crawlSite(options: CrawlOptions): Promise<{ report: CrawlReport; paths: ReportPaths | null }> {
  const root = httpUrl(options.url); const max = integer(options.maxPages ?? 100, 1, 1000, 'maxPages');
  const concurrency = integer(options.concurrency ?? 2, 1, 4, 'concurrency');
  const warnings: string[] = []; const queue: string[] = []; const known = new Set<string>();
  let capped = false;
  const add = (value: string) => {
    let url: URL; try { url = httpUrl(value); } catch { return; }
    if (url.origin !== root.origin || known.has(url.href)) return;
    if (known.size >= max) { capped = true; return; } known.add(url.href); queue.push(url.href);
  };
  let bfs = !options.sitemap;
  const mapRoot = options.sitemap ? httpUrl(options.sitemap) : new URL('/sitemap.xml', root);
  if (mapRoot.origin !== root.origin) throw new Error('Sitemap must have the same origin as the crawl root');
  const maps = [mapRoot.href]; const visited = new Set<string>();
  try {
    while (maps.length && visited.size < 20 && known.size < max) {
      const next = maps.shift()!; if (visited.has(next)) continue; visited.add(next);
      let parsed: ReturnType<typeof parseSitemap>;
      try { parsed = parseSitemap(await sitemapText(httpUrl(next), root.origin)); }
      catch (error) { if (next === mapRoot.href) throw error; warnings.push(`Sitemap unavailable: ${next}`); continue; }
      for (const loc of parsed.locations) {
        let url: URL; try { url = httpUrl(loc); } catch { warnings.push('Invalid sitemap location skipped'); continue; }
        if (url.origin !== root.origin) { warnings.push('Cross-origin sitemap location skipped'); continue; }
        if (parsed.index) { if (maps.length < 1000) maps.push(url.href); else capped = true; }
        else add(url.href);
      }
    }
    if (maps.some(url => !visited.has(url))) capped = true;
    if (known.size) bfs = false;
  } catch (error) {
    if (options.sitemap) throw error;
    // The default sitemap is optional. Fall back to the root's same-origin links.
    bfs = true;
  }
  if (!known.size) { bfs = true; add(root.href); }
  const pages: CrawlPage[] = [];
  // Batches are deterministic BFS layers, with no more than concurrency live profiles.
  while (queue.length) {
    const batch = queue.splice(0, concurrency);
    const results = await Promise.all(batch.map(async url => {
      try {
        const { report, links } = await profileUrl({ ...options, url, outDir: undefined, formats: undefined,
          probes: options.probes ?? false, maxProbes: options.probes ? options.maxProbes ?? 5 : 0,
          fullPageScreenshot: options.fullPageScreenshot ?? false, collectLinks: bfs });
        const status = report.target.status;
        const error = httpUrl(report.target.finalUrl).origin !== root.origin ? 'Redirected outside crawl origin; evidence excluded from aggregates' : status === null || status >= 400 ? `HTTP ${status ?? 'no response'}` : undefined;
        if (links && links.length > 2000) warnings.push(`Link discovery truncated at2000: ${url}`);
        return { page: { url, report, ...(error ? { error } : {}) } as CrawlPage, links: error ? [] : (links ?? []).slice(0,2000) };
      } catch (error) { return { page: { url, error: error instanceof Error ? error.message : String(error) } as CrawlPage, links: [] }; }
    }));
    for (const result of results) { pages.push(result.page); for (const url of result.links) add(url); }
  }
  if (capped) warnings.push(`Discovery truncated at configured limits (maxPages=${max})`);
  const canonical = new Set<string>();
  for (const p of pages) if (p.report && !p.error) {
    const final = httpUrl(p.report.target.finalUrl).href;
    if (canonical.has(final)) p.duplicateOf = final; else canonical.add(final);
  }
  const complete = pages.filter(p => p.report && !p.error && !p.duplicateOf);
  const totalTokens = complete.reduce((n,p) => n + p.report!.scorecard.tokensPerStep, 0);
  const report: CrawlReport = { schema: 'agent-eye.crawl/v1', generatedAt: new Date().toISOString(), url: root.href, pages, warnings,
    summary: { complete: complete.length, failed: pages.filter(p => p.error).length, totalTokens, averageTokens: complete.length ? totalTokens / complete.length : 0, averageNoisePct: complete.length ? complete.reduce((n,p) => n + p.report!.scorecard.noisePct, 0) / complete.length : 0 },
    tokenRanking: complete.map(p => ({ url:p.url, tokens:p.report!.scorecard.tokensPerStep })).sort((a,b) => b.tokens-a.tokens),
    noiseRanking: complete.map(p => ({ url:p.url, noisePct:p.report!.scorecard.noisePct })).sort((a,b) => b.noisePct-a.noisePct),
    exitCode: pages.some(p => p.error || p.report?.verdict.exitCode === 1) || warnings.length ? 1 : 0 };
  let paths: ReportPaths | null = null;
  if (options.outDir) {
    mkdirSync(options.outDir, {recursive:true}); const dir = mkdtempSync(join(options.outDir, 'crawl-')); paths = {};
    const formats: ReportFormat[] = options.formats ?? ['json','md'];
    if (formats.includes('json')) { paths.json = join(dir,'report.json'); writeFileSync(paths.json, JSON.stringify(report,null,2)+'\n'); }
    if (formats.includes('md')) { paths.md = join(dir,'report.md'); writeFileSync(paths.md,renderCrawlMarkdown(report)); }
    if (formats.includes('html')) { paths.html = join(dir,'report.html'); writeFileSync(paths.html,renderCrawlHtml(report)); }
  }
  return {report, paths};
}
function plain(s: string): string { return s.replace(/[\x00-\x1f\x7f-\x9f]/g,' '); }
function html(s: string): string { return plain(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function md(s: string): string { return plain(s).replace(/&/g,'&amp;').replace(/[<>\[\]()`*_!|\\]/g,c=>`&#${c.charCodeAt(0)};`); }
export function renderCrawlTerminal(r: CrawlReport): string {
  const lines = [`agent-eye crawl: ${r.summary.complete} complete, ${r.summary.failed} failed`, `Compact tokens: total ${r.summary.totalTokens}; mean ${r.summary.averageTokens.toFixed(1)}; mean noise ${r.summary.averageNoisePct.toFixed(1)}%`];
  for (const p of r.pages) lines.push(`${plain(p.url)} | ${p.error ? 'ERROR '+plain(p.error) : p.duplicateOf ? 'DUPLICATE '+plain(p.duplicateOf) : `${p.report!.scorecard.tokensPerStep} tokens | ${p.report!.scorecard.noisePct}% noise | ${p.report!.verdict.status}`}`);
  lines.push('Highest tokens:',...r.tokenRanking.slice(0,10).map(p=>`${p.tokens} ${plain(p.url)}`),'Highest noise:',...r.noiseRanking.slice(0,10).map(p=>`${p.noisePct}% ${plain(p.url)}`));
  for (const w of r.warnings) lines.push('Warning: '+plain(w)); return lines.join('\n')+'\n';
}
export function renderCrawlMarkdown(r: CrawlReport): string {
  const lines = ['# agent-eye crawl','',`${r.summary.complete} complete; ${r.summary.failed} failed. Total compact tokens ${r.summary.totalTokens}, mean ${r.summary.averageTokens.toFixed(1)}, mean noise ${r.summary.averageNoisePct.toFixed(1)}%.`,'','| URL | Tokens | Noise | Status |','| --- | ---: | ---: | --- |'];
  for (const p of r.pages) lines.push(`| ${md(p.url)} | ${p.error ? 'n/a' : p.report!.scorecard.tokensPerStep} | ${p.error ? 'n/a' : p.report!.scorecard.noisePct+'%'} | ${md(p.error ?? (p.duplicateOf ? 'DUPLICATE '+p.duplicateOf : p.report!.verdict.summary))} |`);
  lines.push('','## Highest tokens','',...r.tokenRanking.slice(0,10).map(p=>`- ${p.tokens}: ${md(p.url)}`),'','## Highest noise','',...r.noiseRanking.slice(0,10).map(p=>`- ${p.noisePct}%: ${md(p.url)}`));
  for (const w of r.warnings) lines.push('- Warning: '+md(w)); return lines.join('\n')+'\n';
}
export function renderCrawlHtml(r: CrawlReport): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline'"><title>agent-eye crawl</title><style>body{font:16px system-ui;max-width:1200px;margin:32px auto;padding:0 20px;color:#17202a}table{border-collapse:collapse;width:100%}td,th{padding:10px;border:1px solid #ccd3da;text-align:left;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>agent-eye crawl</h1><p>${r.summary.complete} complete; ${r.summary.failed} failed. Total compact tokens ${r.summary.totalTokens}; average ${r.summary.averageTokens.toFixed(1)}; average noise ${r.summary.averageNoisePct.toFixed(1)}%.</p><table><thead><tr><th>URL</th><th>Tokens</th><th>Noise</th><th>Status</th></tr></thead><tbody>${r.pages.map(p=>`<tr><td>${html(p.url)}</td><td>${p.error?'n/a':p.report!.scorecard.tokensPerStep}</td><td>${p.error?'n/a':p.report!.scorecard.noisePct+'%'}</td><td>${html(p.error ?? (p.duplicateOf ? 'DUPLICATE '+p.duplicateOf : p.report!.verdict.summary))}</td></tr>`).join('')}</tbody></table><h2>Rankings and warnings</h2><pre>${html(renderCrawlTerminal(r))}</pre></html>`;
}
