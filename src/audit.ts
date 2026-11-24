import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, mkdirSync, mkdtempSync, lstatSync, openSync, readSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ReportFormat, ReportPaths } from './report/write.js';

type Obj=Record<string,unknown>;
export interface AuditSource { state:'available'|'missing'|'failed'; file:string|null; sha256?:string; error?:string; data?:Obj }
export interface AuditReport {
  schema:'agent-eye.audit/v1'; sources:{eye:AuditSource;leak:AuditSource}; warnings:string[];
  comparison:'same-target'|'target-mismatch'|'unavailable'; exitCode:0|1;
}
const object=(v:unknown):v is Obj=>typeof v==='object'&&v!==null&&!Array.isArray(v);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0;
const string=(v:unknown):v is string=>typeof v==='string'&&v.length>0;
function url(v:unknown):string {if(!string(v))throw Error('Missing target URL');const u=new URL(v);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('Target must be HTTP(S) without credentials');return u.href;}
function time(v:unknown){if(!string(v)||!Number.isFinite(Date.parse(v)))throw Error('Invalid measurement timestamp');}
function validateEye(d:Obj){
 if(d.schemaVersion!==2||!object(d.tool)||d.tool.name!=='agent-eye'||!string(d.tool.version)||!object(d.target)||!object(d.scorecard)||!object(d.verdict)||!Array.isArray(d.bill))throw Error('Expected agent-eye profile schemaVersion2');
 url(d.target.url);url(d.target.finalUrl);time(d.generatedAt);
 if(!finite(d.scorecard.tokensPerStep)||!finite(d.scorecard.noisePct)||d.scorecard.noisePct>100||!string(d.verdict.status)||!string(d.verdict.summary))throw Error('Invalid profile metrics/verdict');
 if(!(d.target.status===null||finite(d.target.status)))throw Error('Invalid HTTP status');
}
function validateLeak(d:Obj){
 if(d.schema!=='agentleak.snapshot/v1'||!string(d.product)||!string(d.version)||!object(d.summary)||!Array.isArray(d.findings)||!Array.isArray(d.observations)||!object(d.cloaking))throw Error('Expected agentleak.snapshot/v1');
 url(d.url);url(d.finalUrl);time(d.createdAt);
 if(typeof d.summary.leak!=='boolean'||!Number.isInteger(d.summary.leakCount)||!finite(d.summary.leakCount)||!object(d.summary.findingsBySeverity)||!['high','medium','low'].every(k=>finite((d.summary as Obj).findingsBySeverity && ((d.summary as Obj).findingsBySeverity as Obj)[k])))throw Error('Invalid scan summary');
 for(const f of d.findings)if(!object(f)||!string(f.kind)||!['high','medium','low'].includes(String(f.severity))||typeof f.snippet!=='string'||!string(f.channel)||!Array.isArray(f.reasons)||!f.reasons.every(x=>typeof x==='string'))throw Error('Invalid scan finding');
 if(!d.observations.length)throw Error('Scan has no observations');
 for(const o of d.observations)if(!object(o)||typeof o.uaId!=='string'||!(o.error===undefined||typeof o.error==='string')||!(o.status===null||finite(o.status)))throw Error('Invalid scan observation');
}
function source(file:string|undefined,validate:(d:Obj)=>void):AuditSource {
 if(!file)return{state:'missing',file:null};const absolute=resolve(file);
 let fd:number|undefined;
 try{const before=lstatSync(absolute);if(!before.isFile()||before.isSymbolicLink())throw Error('Input must not be a symlink');fd=openSync(absolute,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const stat=fstatSync(fd);const after=lstatSync(absolute);if(after.isSymbolicLink()||before.dev!==stat.dev||before.ino!==stat.ino||after.dev!==stat.dev||after.ino!==stat.ino)throw Error('Input changed while opening');if(!stat.isFile()||stat.size>20_000_000)throw Error('Input must be a regular JSON file below20MB');
 const buffer=Buffer.alloc(20_000_001);let count=0;while(count<buffer.length){const n=readSync(fd,buffer,count,buffer.length-count,null);if(!n)break;count+=n;}if(count>20_000_000)throw Error('Input grew above20MB');const bytes=buffer.subarray(0,count);const data:unknown=JSON.parse(bytes.toString('utf8'));if(!object(data))throw Error('Input must be a JSON object');validate(data);
 return{state:'available',file:absolute,sha256:createHash('sha256').update(bytes).digest('hex'),data};
 }catch(error){return{state:'failed',file:absolute,error:error instanceof Error?error.message:String(error)};}finally{if(fd!==undefined)closeSync(fd);}
}
/** Offline single-page comparison. Inputs are not scanned, executed or merged into a safety score. */
export function auditReports(options:{eye?:string;leak?:string;outDir?:string;formats?:ReportFormat[]}):{report:AuditReport;paths:ReportPaths|null}{
 const eye=source(options.eye,validateEye),leak=source(options.leak,validateLeak);const warnings:string[]=[];let incomplete=false;
 if(eye.state!=='available'){incomplete=true;warnings.push(`Observation cost/noise source is ${eye.state}: not measured, not a pass.`);}
 if(leak.state!=='available'){incomplete=true;warnings.push(`Hidden-instruction source is ${leak.state}: unknown, not safe.`);}
 let comparison:AuditReport['comparison']='unavailable';
 if(eye.data&&leak.data){
  const target=eye.data.target as Obj;
  comparison=url(target.url)===url(leak.data.url)&&url(target.finalUrl)===url(leak.data.finalUrl)?'same-target':'target-mismatch';
  if(comparison==='target-mismatch'){incomplete=true;warnings.push('Requested or final target URLs differ. These results must not be treated as one measurement.');}
  if(eye.data.generatedAt!==leak.data.createdAt)warnings.push('Measurement timestamps differ. Saved results do not prove the same page state.');
 }
 if(eye.data){const target=eye.data.target as Obj;if(target.status===null||Number(target.status)>=400){incomplete=true;warnings.push('Profile HTTP response failed or was unmeasured. Original metrics are retained, not a successful page observation.');}}
 if(leak.data){
 const observations=[...(leak.data.observations as Obj[])];
 if(leak.data.vectors!==undefined){if(!Array.isArray(leak.data.vectors)){incomplete=true;warnings.push('Malformed vector coverage metadata.');}else for(const v of leak.data.vectors){if(!object(v)||!object(v.baseline)||!object(v.variant)||!object(v.comparison)||!['same','minor-delta','cloaked','blocked','error'].includes(String((v.comparison as Obj).verdict))||![v.baseline,v.variant].every(o=>object(o)&&(o.status===null||finite(o.status))&&typeof o.uaId==='string')){incomplete=true;warnings.push('Malformed vector coverage metadata.');continue;}observations.push(v.baseline,v.variant);if(['blocked','error'].includes(String(v.comparison.verdict))||v.comparison.rawComparable===false){incomplete=true;warnings.push('Additional vector scan failed, blocked or degraded. Coverage is incomplete.');}}}
 if(observations.some(o=>o.error||o.status===null||Number(o.status)>=400||o.blocked===true||o.rawTextError)){incomplete=true;warnings.push('Scan observations include errors, blocking or raw-source degradation. Coverage is incomplete.');}}

 const report:AuditReport={schema:'agent-eye.audit/v1',sources:{eye,leak},warnings,comparison,exitCode:incomplete?1:0};let paths:ReportPaths|null=null;
 if(options.outDir){mkdirSync(options.outDir,{recursive:true});const dir=mkdtempSync(join(options.outDir,'audit-'));paths={};for(const format of options.formats??['json','md','html']){const file=join(dir,'report.'+format);paths[format]=file;writeFileSync(file,format==='json'?JSON.stringify(report,null,2)+'\n':format==='md'?renderAuditMarkdown(report):renderAuditHtml(report));}}
 return{report,paths};
}
const plain=(s:string)=>s.replace(/[\x00-\x1f\x7f-\x9f]/g,' ');
const escape=(s:string)=>plain(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const fileLink=(s:string)=>pathToFileURL(s).href.replace(/[()']/g,c=>'%'+c.charCodeAt(0).toString(16));
const md=(s:string)=>escape(s).replace(/[\[\]()`*_!|\\]/g,c=>'&#'+c.charCodeAt(0)+';');
function lines(r:AuditReport):string[]{
 const out=['Offline single-page audit','Cost/noise and hidden-instruction warnings are separate measurements. No combined safety score.','Comparison: '+r.comparison,...r.warnings.map(w=>'WARNING: '+w)];
 const eye=r.sources.eye,leak=r.sources.leak;
 out.push('','Observation cost and noise: '+eye.state);
 if(eye.data){const d=eye.data,t=d.target as Obj,s=d.scorecard as Obj,v=d.verdict as Obj;out.push(`Tool: ${(d.tool as Obj).name} ${(d.tool as Obj).version}`,`Measured: ${d.generatedAt}`,`Requested: ${t.url}`,`Final: ${t.finalUrl}`,`Compact tokens/step: ${s.tokensPerStep}`,`Noise: ${s.noisePct}%`,`Original verdict: ${v.status}: ${v.summary}`);}
 if(eye.error)out.push('Error: '+eye.error);
 out.push('','Hidden-instruction warnings: '+leak.state);
 if(leak.data){const d=leak.data,s=d.summary as Obj;out.push(`Tool: ${d.product} ${d.version}`,`Measured: ${d.createdAt}`,`Requested: ${d.url}`,`Final: ${d.finalUrl}`,`Original leak flag: ${s.leak}; leakCount: ${s.leakCount}`,`Findings by severity: ${JSON.stringify(s.findingsBySeverity)}`,'Findings are scanner warnings, not proof of intent. Absence of warnings is not a safety certification.');
 for(const f of d.findings as Obj[])out.push(`${f.severity} | ${f.kind} | ${f.channel} | UNTRUSTED SCANNER EVIDENCE: ${f.snippet}`,`Reasons: ${(f.reasons as string[]).join('; ')}`);}
 if(leak.error)out.push('Error: '+leak.error);
 for(const [name,s]of Object.entries(r.sources))out.push('',`Source ${name}: ${s.file??'not provided'}`,`SHA256: ${s.sha256??'unavailable'}`);
 return out;
}
export function renderAuditTerminal(r:AuditReport){return lines(r).map(plain).join('\n')+'\n';}
export function renderAuditMarkdown(r:AuditReport){return '# Offline audit\n\n'+lines(r).map(l=>md(l)+'  ').join('\n')+'\n\n## Original saved files\n'+Object.entries(r.sources).filter(([,s])=>s.file).map(([name,s])=>`- [${name}: ${md(basename(s.file!))}](${fileLink(s.file!)})`).join('\n')+'\n';}
export function renderAuditHtml(r:AuditReport){return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline'"><title>Offline audit</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:0 20px;color:#17212b}pre{white-space:pre-wrap;overflow-wrap:anywhere;padding:24px;background:#f2f5f7;border-radius:12px;line-height:1.6}a{overflow-wrap:anywhere}</style><h1>Offline audit</h1><pre>${lines(r).map(escape).join('\n')}</pre><h2>Original saved files</h2>${Object.entries(r.sources).filter(([,s])=>s.file).map(([name,s])=>`<p><a href="${escape(fileLink(s.file!))}">${name}: ${escape(basename(s.file!))}</a> · SHA256 ${escape(s.sha256??'unavailable')}</p>`).join('')}</html>`;}
