// Adapted from UI/UX Pro Max, MIT. See provenance.json for immutable revision.
import { readFileSync } from 'node:fs';
export type Row = Record<string, string>;
export type Config = { file: string; search_cols: string[]; output_cols: string[] };
export const config = JSON.parse(readFileSync(new URL('../data/search-config.json', import.meta.url), 'utf8')) as {
  CSV_CONFIG: Record<string, Config>; STACK_CONFIG: Record<string, { file: string }>;
  STACK_COLS: Omit<Config, 'file'>; synonyms: Record<string,string>; stopwords: string[];
  domainKeywords: Record<string,string[]>; domainRewrites: Record<string,Record<string,string>>;
  conditions: Record<string,string[]>; dials: Record<string, [number,number, Record<string,unknown>][] >;
  versions: Record<string,number[]>; stackQueryNames: Record<string,string>;
};
// RFC 4180 records: quoted newlines, escaped quotes, UTF-8 BOM and CRLF.
export function parseCSV(text: string): Row[] {
  const records: string[][]=[]; let record: string[]=[]; let field=''; let quoted=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++) { const c=text[i];
    if(c==='"') { if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted; }
    else if(c===','&&!quoted){record.push(field);field='';}
    else if((c==='\r'||c==='\n')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;record.push(field);if(record.some(Boolean))records.push(record);record=[];field='';}
    else field+=c;
  }
  if(quoted)throw new Error('Unclosed CSV quote');
  if(field||record.length){record.push(field);records.push(record);}
  const headers=records.shift()??[];
  return records.map(values=>Object.fromEntries(headers.map((h,i)=>[h,values[i]??''])));
}
export function rows(file: string): Row[] { return parseCSV(readFileSync(new URL(`../data/${file}`, import.meta.url),'utf8')); }
export const escapeRE=(text:string)=>text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function contains(text:string,phrase:string):boolean {return new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRE(phrase)}(?![\\p{L}\\p{N}_])`,'u').test(text);}
export function normalize(text:string):string {for(const [variant,canonical] of Object.entries(config.synonyms).sort((a,b)=>b[0].length-a[0].length))text=text.replace(new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRE(variant)}(?![\\p{L}\\p{N}_])`,'giu'),canonical);return text;}
const stopwords=new Set(config.stopwords);
export function tokenize(text:string):string[]{return normalize(text.toLowerCase()).replace(/[^\p{L}\p{N}_\s]/gu,' ').split(/\s+/).filter(w=>w.length>=2&&!stopwords.has(w));}
export function identities(row:Row,fields:string[]):string[]{return fields.flatMap(field=>field==='Aliases'?(row[field]??'').split('|'):[row[field]??'']).map(x=>x.trim()).filter(Boolean);}
export const project=(row:Row,columns:string[]):Row=>Object.fromEntries(columns.filter(c=>c in row).map(c=>[c,row[c]]));
// SequenceMatcher's longest contiguous matching-block ratio, without junk tokens.
export function similarity(a:string,b:string):number {
  function matches(alo:number,ahi:number,blo:number,bhi:number):number {
    let best=0,ai=alo,bi=blo;let previous=new Map<number,number>();
    for(let i=alo;i<ahi;i++){const next=new Map<number,number>();for(let j=blo;j<bhi;j++)if(a[i]===b[j]){const n=(previous.get(j-1)??0)+1;next.set(j,n);if(n>best){best=n;ai=i-n+1;bi=j-n+1;}}previous=next;}
    if(!best)return 0;return best+matches(alo,ai,blo,bi)+matches(ai+best,ahi,bi+best,bhi);
  }
  return a.length+b.length?2*matches(0,a.length,0,b.length)/(a.length+b.length):1;
}
