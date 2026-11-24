import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { profileUrl } from '../../src/profile.js';
import { renderMarkdownProfile } from '../../src/report/markdown.js';
import { renderHtmlProfile } from '../../src/report/html.js';
import { renderTerminalProfile, renderComparison } from '../../src/report/terminal.js';

describe('unmeasured action truth', () => {
  it('distinguishes disabled, no candidates, measured zero and no-effect samples', async () => {
    const server = createServer((req,res) => { res.setHeader('Content-Type','text/html'); res.end(req.url === '/empty' ? '<h1>No controls</h1>' : req.url === '/dead' ? '<button type="button">Details</button>' : '<button type="button" onclick="this.textContent=\'Expanded\'">Details</button>'); });
    server.listen(0, '127.0.0.1'); await once(server,'listening');
    const dir = await mkdtemp(join(tmpdir(),'agent-eye-unmeasured-'));
    try {
      const port = (server.address() as {port:number}).port;
      const base = `http://127.0.0.1:${port}`;
      const common = { churnMs:0, maxFalseSuccess:0, settleMs:50 };
      const disabled = await profileUrl({ ...common, url:base, probes:false, outDir:dir, formats:['json','md','html'] });
      expect(disabled.report.schemaVersion).toBe(2);
      expect(disabled.report.scorecard.falseSuccessPct).toBeNull();
      const scoreOnly = { ...disabled.report, gates:[], verdict:{...disabled.report.verdict,summary:''} };
      expect(renderTerminalProfile(scoreOnly)).toContain('not measured: probes disabled');
      expect(renderMarkdownProfile(scoreOnly)).toContain('| false success | not measured: probes disabled |');
      expect(renderHtmlProfile(scoreOnly)).toContain('<b>not measured: probes disabled</b>');
      const zero = await profileUrl({ ...common, url:base, maxProbes:0 });
      expect(zero.report.gates[0]?.actual).toBe('not measured: probes disabled');
      expect(zero.report.verdict.exitCode).toBe(1);
      expect(disabled.report.gates.find(g => g.name === 'max-false-success')).toMatchObject({ passed:false, actual:'not measured: probes disabled' });
      expect(disabled.report.verdict.exitCode).toBe(1);
      expect(renderTerminalProfile(disabled.report)).toContain('not measured: probes disabled');
      for (const format of ['md','html'] as const) expect(await readFile(disabled.paths![format]!, 'utf8')).toContain('not measured: probes disabled');
      expect(JSON.parse(await readFile(disabled.paths!.json!, 'utf8')).scorecard.falseSuccessPct).toBeNull();
      const empty = await profileUrl({ ...common, url:base+'/empty', maxProbes:2 });
      expect(empty.report.actionTruth?.attempted).toBe(0);
      expect(empty.report.actionTruth?.falseSuccessPct).toBeNull();
      expect(empty.report.gates[0]?.actual).toBe('not measured: no safe controls attempted');
      expect(empty.report.verdict.exitCode).toBe(1);
      const measured = await profileUrl({ ...common, url:base, maxProbes:1 });
      expect(measured.report.actionTruth?.attempted).toBe(1);
      expect(measured.report.scorecard.falseSuccessPct).toBe(0);
      expect(measured.report.gates[0]?.passed).toBe(true);
      const dead = await profileUrl({ ...common, url:base+'/dead', maxProbes:1 });
      expect(dead.report.scorecard.falseSuccessPct).toBe(100);
      expect(dead.report.gates[0]?.passed).toBe(false);
      expect(renderComparison(disabled.report, measured.report)).toContain('not comparable');
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); await rm(dir,{recursive:true,force:true}); }
  },120000);
});
