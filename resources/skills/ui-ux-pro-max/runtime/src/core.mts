import {config,rows,normalize,contains,identities,project,tokenize,similarity,escapeRE,type Row} from './data.mjs';
import {rankedSearch,threshold,stackThreshold,noThreshold,exactDiagnostic,suggest,type BM25} from './ranking.mjs';
export const domains=Object.keys(config.CSV_CONFIG),stacks=Object.keys(config.STACK_CONFIG);
export type SearchResult={domain?:string;stack?:string;query?:string;file?:string;count?:number;results?:Row[];error?:string;auto_detected?:boolean;runner_up_domain?:string;redirect?:{domain:string;id:string};suggestions?:string[];diagnostics?:Record<string,unknown>};
const styleFields=['Style ID','Style Category','Aliases'],landingFields=['Pattern ID','Pattern Name','Aliases'];
export function detectDomain(query:string):[string,string|undefined]{
  const keywords={...config.domainKeywords,product:[...new Set(['saas','ecommerce','fintech','healthcare','gaming','portfolio','crypto','fitness','marketplace','banking','cybersecurity','education','travel','restaurant','real estate','social media','beauty','spa','salon','wellness','booking',...rows('products.csv').map(r=>(r['Product Type']??'').replace(/\([^)]*\)/g,'').trim().toLowerCase()).filter(x=>x.length>=4)])]};
  const order=['ux','product','style','color','typography','google-fonts','chart','landing','icons','gsap','react','web'];const text=normalize(query.toLowerCase());
  const scores=Object.entries(keywords).map(([domain,terms]):[string,number]=>[domain,terms.reduce((score,term)=>score+(contains(text,term)?Math.max(1,term.split(/\s+/).length)*(domain==='product'?1:2):0),0)+(domain==='color'&&/(?<!\w)#[0-9a-f]{3,8}(?!\w)/i.test(text)?2:0)]).sort((a,b)=>b[1]-a[1]||order.indexOf(a[0])-order.indexOf(b[0]));
  return [scores[0][1]>0?scores[0][0]:'style',scores[1][1]>0?scores[1][0]:undefined];
}
export function styleIdentity(data:Row[],query:string,contained=true):Row|undefined{
  const folded=query.trim().toLowerCase(),tokens=new Set(normalize(folded).match(/[\p{L}\p{N}_]+/gu)??[]),generic=new Set(['app','design','interface','style','system','ui']);
  const candidates:{row:Row;distinct:number;count:number;length:number}[]=[];
  for(const row of data){const values=identities(row,styleFields);if(values.some(x=>x.toLowerCase()===folded))return row;if(!contained)continue;for(const identity of values){const parts=[...new Set(normalize(identity.toLowerCase()).match(/[\p{L}\p{N}_]+/gu)??[])];if(parts.length&&parts.every(x=>tokens.has(x))&&parts.some(x=>x.length>=4))candidates.push({row,distinct:parts.filter(x=>!generic.has(x)).length,count:parts.length,length:identity.length});}}
  candidates.sort((a,b)=>b.distinct-a.distinct||b.count-a.count);const best=candidates[0];if(!best)return undefined;const matches=[...new Map(candidates.filter(x=>x.distinct===best.distinct&&x.count===best.count&&x.length===best.length).map(x=>[x.row['Style ID'],x.row])).values()];return matches.length===1?matches[0]:undefined;
}
function destination(data:Row[],matched:Row|undefined):{row?:Row;redirect?:{domain:string;id:string}}{
  if(!matched||matched.Status!=='deprecated')return{row:matched};const parent=matched['Parent Style ID']?.trim();if(parent)return{row:data.find(r=>r['Style ID']===parent)};
  const domain=matched['Replacement Domain']?.trim(),id=matched['Replacement ID']?.trim();if(domain==='style'&&id)return{row:data.find(r=>r['Style ID']===id)};return domain&&id?{redirect:{domain,id}}:{};
}
function suggestIdentities(data:Row[],query:string):string[]{const tokens=tokenize(query);if(!tokens.length)return[];const candidates=data.flatMap(row=>identities(row,landingFields)).map(identity=>({identity,tokens:[...new Set(tokenize(identity))]})).filter(x=>x.tokens.length&&x.identity.toLowerCase()!==query.trim().toLowerCase()).map(x=>({...x,score:Math.max(...tokens.flatMap(t=>x.tokens.map(i=>similarity(t,i))))})).filter(x=>x.score>=0.72).sort((a,b)=>b.score-a.score||a.tokens.length-b.tokens.length||(a.identity<b.identity?-1:1));return [...new Set(candidates.map(x=>x.identity))].slice(0,6);}
export function search(query:string,domain?:string,max=3,diagnostics=false):SearchResult{
  if(!Number.isInteger(max)||max<1||max>20)return{error:'max_results must be an integer from 1 to 20',domain};
  const auto=domain===undefined;let runner:string|undefined;let exact:Row|undefined,redirect:{domain:string;id:string}|undefined;
  const styleRows=rows('styles.csv');
  if(auto){const match=styleIdentity(styleRows,query,false);if(match){domain='style';({row:exact,redirect}=destination(styleRows,match));}else [domain,runner]=detectDomain(query);}
  const selected=domain&&domain in config.CSV_CONFIG?domain:'style',cfg=config.CSV_CONFIG[selected],data=rows(cfg.file);
  if(selected==='style'&&!exact&&!redirect)({row:exact,redirect}=destination(styleRows,styleIdentity(styleRows,query)));
  else if(selected==='landing'){const matches=data.filter(r=>identities(r,landingFields).some(x=>x.toLowerCase()===query.trim().toLowerCase()));if(matches.length===1)exact=matches[0];}
  let results:Row[],index:BM25|null=null,diagnostic:Record<string,unknown>;
  if(exact){results=[project(exact,cfg.output_cols)];diagnostic=exactDiagnostic(query);}
  else if(redirect){results=[];diagnostic={normalized_query:normalize(query),search_query:query,query_rewrites:[],abstained:true,calibration_version:'2026-08-12-v1',reason:'cross-domain-redirect'};}
  else ({results,index,diagnostic}=rankedSearch(selected==='style'?data.filter(r=>(r.Status??'active')==='active'):data,cfg.search_cols,cfg.output_cols,query,max,threshold(selected),selected));
  if(selected==='icons'&&contains(normalize(query.toLowerCase()),'lucide')){results=[];Object.assign(diagnostic,{abstained:true,reason:'unsupported-library'});}
  const out:SearchResult={domain,query,file:cfg.file,count:results.length,results};if(auto){out.auto_detected=true;if(runner)out.runner_up_domain=runner;}if(redirect)out.redirect=redirect;
  if(!results.length)out.suggestions=selected==='landing'?suggestIdentities(data,query):suggest(index,query,threshold(selected));if(diagnostics)out.diagnostics=diagnostic;return out;
}
function legacyRequested(query:string,stack:string):boolean{
  if(stack==='uwp')return true;const text=normalize(query.toLowerCase()),current=config.versions[stack],name=config.stackQueryNames[stack];const migration=/\b(?:migrat\w*|upgrad\w*|replac\w*|instead|modern|current)\b/.test(text);
  if(current&&name){const pattern=new RegExp(`\\b(?:${name})\\s*(?:sdk|ui)?\\s*(?:[@(]\\s*)?(?:v(?:ersion)?\\s*)?(\\d+)(?:\\.(\\d+))?\\s*\\)?`,'g');const requested=[...text.matchAll(pattern)].map(m=>m.slice(1).filter(x=>x!==undefined).map(Number));if(stack==='threejs')requested.push(...[...text.matchAll(/\br(\d+)\b/g)].map(m=>[0,Number(m[1])]));const older=(version:number[])=>{for(let i=0;i<version.length;i++){if(version[i]!==current[i])return version[i]<current[i];}return false;};if(requested.length){if(migration&&requested.some(v=>!older(v)))return false;return requested.every(older);}}
  return !migration&&/\b(?:legacy|deprecated)\b/.test(text);
}
export function searchStack(query:string,stack:string,max=3,diagnostics=false):SearchResult{
  if(!Number.isInteger(max)||max<1||max>20)return{error:'max_results must be an integer from 1 to 20',stack};
  const cfg=config.STACK_CONFIG[stack];if(!cfg)return{error:`Unknown stack: ${stack}. Available: ${stacks.join(', ')}`};
  const data=rows(cfg.file),statuses=new Set(data.map(r=>r.Status??'unverified')),legacy=legacyRequested(query,stack);let variant:string,filtered:Row[];
  if(statuses.has('deprecated')&&legacy){variant='legacy-only';filtered=data.filter(r=>r.Status==='deprecated');}
  else if(legacy&&stack in config.versions){variant='legacy-unavailable';filtered=[];}
  else if(statuses.has('active')){variant='current-only';filtered=data.filter(r=>r.Status==='active');}
  else {variant='non-legacy';filtered=data.filter(r=>(r.Status??'unverified')!=='deprecated');}
  if(stack==='shadcn'){const text=normalize(query.toLowerCase());const base=text.includes('base ui')?'base':text.includes('react aria')?'aria':text.includes('radix')||text.includes('aschild')?'radix':undefined;if(base){filtered=filtered.filter(r=>r['Applies To']?.toLowerCase().match(/\bbase=([^;]+)/)?.[1].split('|').includes(base));variant+=`;base=${base}`;}}
  const t=variant==='legacy-only'?noThreshold:stackThreshold;let exact:Row|undefined;
  if(stack==='uwp'&&/\b(?:brand new|new)\s+(?:app|application|project)\b/.test(normalize(query.toLowerCase()))){const matches=filtered.filter(r=>/\b(?:prefer|choose|use)\b.*\bnew (?:apps?|projects?)\b/.test([r.Guideline,r.Description,r.Do].join(' ').toLowerCase()));if(matches.length===1)exact=matches[0];}
  if(!exact&&query.trim().length>=6&&!/\s/.test(query.trim())){const re=new RegExp(`(?<![A-Za-z0-9_])${escapeRE(query.trim())}(?![A-Za-z0-9_])`,'i');const matches=filtered.filter(r=>['Guideline','Description','Do',"Don't",'Code Good','Code Bad'].some(f=>re.test(r[f]??'')));if(matches.length===1)exact=matches[0];}
  const result=exact?{results:[project(exact,config.STACK_COLS.output_cols)],index:null,diagnostic:exactDiagnostic(query,'exact-identifier')}:rankedSearch(filtered,config.STACK_COLS.search_cols,config.STACK_COLS.output_cols,query,max,t);
  const out:SearchResult={domain:'stack',stack,query,file:cfg.file,count:result.results.length,results:result.results};if(!result.results.length)out.suggestions=suggest(result.index,query,t);if(diagnostics)out.diagnostics=result.diagnostic;return out;
}
