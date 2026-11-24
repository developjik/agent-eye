import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from 'vitest';
import { crawlSite, renderCrawlHtml } from '../../src/crawl.js';

test('profiles 100 real pages with bounded sitemap crawling, ranks, gates, and failure isolation', async () => {
  let origin = '';
  const server = createServer((req,res) => {
    if (req.url === '/sitemap.xml') { res.end('<urlset>'+Array.from({length:100},(_,i)=>`<url><loc>${origin}/p/${i}</loc></url>`).join('')+'</urlset>'); return; }
    if (req.url === '/p/47') { res.writeHead(503); res.end('offline'); return; }
    res.setHeader('content-type','text/html');res.end(`<html><title>page</title><main><button>Page ${req.url}</button><a href="/p/1">Next</a></main></html>`);
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const addr=server.address();if(!addr||typeof addr==='string')throw new Error('port');origin=`http://127.0.0.1:${addr.port}`;
  try {
    const {report,paths} = await crawlSite({url:origin,maxPages:100,concurrency:4,churnMs:0,fullPageScreenshot:false,budgetTokens:1,outDir:'.test-out/crawl100',formats:['json','md','html']});
    expect(report.pages).toHaveLength(100); expect(report.summary.complete).toBe(99);expect(report.summary.failed).toBe(1);
    expect(report.summary.totalTokens).toBe(report.tokenRanking.reduce((n,p)=>n+p.tokens,0));
    expect(report.summary.averageTokens).toBe(report.summary.totalTokens/99);expect(report.exitCode).toBe(1);
    expect(report.pages.find(p=>p.url.endsWith('/p/47'))?.error).toContain('503');
    expect(report.pages.find(p=>p.url.endsWith('/p/99'))?.report).toBeTruthy();
    expect(report.pages[0]?.report?.actionTruth).toBeNull();expect(JSON.parse(readFileSync(paths!.json!,'utf8')).pages).toHaveLength(100);
    const html = readFileSync(paths!.html!,'utf8');expect(html).toContain('99 complete; 1 failed');
    report.pages[0]!.error='![remote](https://example.invalid) <script>alert(1)</script>';
    expect(renderCrawlHtml(report)).not.toContain('<script>');
  } finally {await new Promise<void>(r=>server.close(()=>r()));}
},180000);

test('BFS fallback stays on origin, strips fragments, records errors and built CLI 0/1/2', async () => {
  let origin=''; const server=createServer((req,res)=>{
    if(req.url==='/sitemap.xml'){res.writeHead(404);res.end('none');return;}
    if(req.url==='/bad'){res.destroy();return;}
    res.setHeader('content-type','text/html');res.end(`<html><button>Okay</button>${req.url==='/'?'<a href="/a#x">A</a><a href="/a#y">Duplicate</a><a href="/bad">Bad</a><a href="https://example.invalid/out">Outside</a>':''}</html>`);
  });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const addr=server.address();if(!addr||typeof addr==='string')throw new Error('port');origin=`http://127.0.0.1:${addr.port}`;
  try{
    const {report}=await crawlSite({url:origin,churnMs:0,concurrency:2,timeoutMs:500});
    expect(report.pages.map(p=>p.url)).toEqual([origin+'/',origin+'/a',origin+'/bad']);expect(report.summary.failed).toBe(1);
    const run=promisify(execFile);const cli=join(process.cwd(),'dist/bin/agent-eye.js');
    const args=['crawl',origin+'/a','--quiet','--churn-ms','0','--max-pages','1'];
    await expect(run(process.execPath,[cli,...args])).resolves.toBeTruthy();
    await expect(run(process.execPath,[cli,...args,'--budget-tokens','0'])).rejects.toMatchObject({code:1});
    await expect(run(process.execPath,[cli,'crawl'])).rejects.toMatchObject({code:2});
  }finally{await new Promise<void>(r=>server.close(()=>r()));}
},45000);
