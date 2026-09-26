import {config,rows,identities,type Row} from './data.mjs';
import {search} from './core.mjs';
import {parseDecisionRules,applyDecisionRules,resolveColorMode,selectPalette} from './reasoning.mjs';
export type DesignOptions={projectName?:string;variance?:number;motion?:number;density?:number};
export type Dial={value:number;label:string;style_keywords?:string[];tier?:string;spacing?:Record<string,string>};
function dial(name:string,value:number|undefined):Dial|null{if(value===undefined)return null;value=Math.max(1,Math.min(10,Math.trunc(value)));const tier=config.dials[name].find(([lo,hi])=>lo<=value&&value<=hi);return tier?{...tier[2],value} as Dial:null;}
export function generateDesignSystem(query:string,options:DesignOptions={}){
  const styleData=rows('styles.csv'),styleLookup=new Map(styleData.flatMap(row=>identities(row,['Style ID','Style Category','Aliases']).map(id=>[id.toLowerCase(),row] as const)));
  function resolveStyle(id:string):Row{let style=styleLookup.get(id.trim().toLowerCase());const seen=new Set<string>();while(style&&style.Status==='deprecated'){const parent=style['Parent Style ID'];if(!parent||seen.has(style['Style ID']))return{};seen.add(style['Style ID']);style=styleLookup.get(parent.toLowerCase());}return style??{};}
  const product=search(query,'product',1).results??[],category=product[0]?.['Product Type']??'General',rule=rows('ui-reasoning.csv').find(r=>r.UI_Category?.trim().toLowerCase()===category.trim().toLowerCase());
  const decisions=parseDecisionRules(rule?.Decision_Rules??'{}'),applied=applyDecisionRules(decisions,query);
  const reasoning=rule?{pattern:applied.pattern??rule.Recommended_Pattern??'',style_priority:[...applied.style_ids.map(id=>resolveStyle(id)['Style Category']??id),...(rule.Style_Priority??'').split('+').map(x=>x.trim())],color_mood:rule.Color_Mood??'',typography_mood:rule.Typography_Mood??'',key_effects:rule.Key_Effects??'',anti_patterns:rule.Anti_Patterns??'',severity:rule.Severity??'MEDIUM'}:{pattern:'Hero + Features + CTA',style_priority:['Minimalism','Flat Design'],color_mood:'Professional',typography_mood:'Clean',key_effects:'Subtle hover transitions',anti_patterns:'',severity:'MEDIUM'};
  const variance=dial('variance',options.variance),motion=dial('motion',options.motion),density=dial('density',options.density);
  const priority=[...(variance?.style_keywords??[]),...reasoning.style_priority];const resolved=[query,category,applied.constraints.map(x=>x.replaceAll('-',' ')).join(' ')].filter(Boolean).join(' ');
  const styleResults=search(`${resolved} ${priority.slice(0,2).join(' ')}`,'style',3).results??[];
  const colorResults=search(`${reasoning.color_mood} ${resolved}`,'color',5).results??[];
  const typographyResults=search(`${reasoning.typography_mood} ${resolved}`,'typography',2).results??[];
  const landingIdentities=new Set(rows('landing.csv').flatMap(r=>identities(r,['Pattern ID','Pattern Name','Aliases'])).map(x=>x.toLowerCase()));
  const landingQuery=landingIdentities.has(reasoning.pattern.toLowerCase())?reasoning.pattern:`${reasoning.pattern} ${resolved}`;
  const landingResults=search(landingQuery||query,'landing',2).results??[];
  function bestStyle():Row{if(!styleResults.length)return{};for(const p of priority){const style=resolveStyle(p);if(Object.keys(style).length)return style;}const score=(row:Row)=>priority.reduce((n,kw)=>{const tokens=[...new Set(kw.toLowerCase().match(/[a-z0-9]+/g)??[])],name=new Set(row['Style Category']?.toLowerCase().match(/[a-z0-9]+/g)??[]),keywords=new Set(row.Keywords?.toLowerCase().match(/[a-z0-9]+/g)??[]),text=JSON.stringify(row).toLowerCase();return n+(tokens.length&&tokens.every(t=>name.has(t))?10:tokens.some(t=>keywords.has(t))?3:tokens.some(t=>text.includes(t))?1:0);},0);return [...styleResults].sort((a,b)=>score(b)-score(a))[0];}
  const style=bestStyle(),mode=applied.mode??resolveColorMode(query,style),color=selectPalette(colorResults,mode,category),typography=typographyResults[0]??{},landing=landingResults.find(r=>r['Pattern Name']===reasoning.pattern)??landingResults[0]??{};
  let motionSnippet:Row={};if(motion){const results=search(`${query} ${motion.tier}`,'gsap',5).results??[];motionSnippet=results.find(r=>r['Intensity Tier']===motion.tier)??results[0]??{};}
  const colors:Record<string,string>={};const colorKeys:Record<string,string>={primary:'Primary',on_primary:'On Primary',secondary:'Secondary',on_secondary:'On Secondary',accent:'Accent',on_accent:'On Accent',background:'Background',foreground:'Foreground',card:'Card',card_foreground:'Card Foreground',muted:'Muted',muted_foreground:'Muted Foreground',border:'Border',destructive:'Destructive',on_destructive:'On Destructive',ring:'Ring',notes:'Notes',cta:'Accent',text:'Foreground',on_cta:'On Accent'};
  const defaults:Record<string,string>={Primary:'#2563EB',Secondary:'#3B82F6',Accent:'#F97316',Background:'#F8FAFC',Foreground:'#1E293B'};for(const [key,source]of Object.entries(colorKeys))colors[key]=color[source]??defaults[source]??'';
  return{
    project_name:options.projectName||query.toUpperCase(),category,
    pattern:{name:landing['Pattern Name']??reasoning.pattern,sections:landing['Section Order']??'Hero > Features > CTA',cta_placement:landing['Primary CTA Placement']??'Above fold',color_strategy:landing['Color Strategy']??'',conversion:landing['Conversion Optimization']??''},
    style:{id:style['Style ID']??'minimalism-and-swiss-style',name:style['Style Category']??'Minimalism',type:style.Type??'General',effects:style['Effects & Animation']??'',keywords:style.Keywords??'',best_for:style['Best For']??'',performance:style.Performance??'',accessibility:style.Accessibility??'',light_mode:style['Light Mode ✓']??'',dark_mode:style['Dark Mode ✓']??''},colors,
    typography:{heading:typography['Heading Font']??'Inter',body:typography['Body Font']??'Inter',mood:typography['Mood/Style Keywords']??reasoning.typography_mood,best_for:typography['Best For']??'',google_fonts_url:typography['Google Fonts URL']??'',css_import:typography['CSS Import']??''},
    key_effects:style['Effects & Animation']||reasoning.key_effects,
    anti_patterns:mode==='dark'?reasoning.anti_patterns.split('+').filter(c=>!['dark mode','dark modes','dark theme'].some(m=>c.toLowerCase().includes(m))).map(c=>c.trim()).filter(Boolean).join(' + '):reasoning.anti_patterns,
    decision_rules:decisions,activated_rules:applied.activated,constraints:applied.constraints,reasoning_default:!rule,
    source_identities:{product:product.length?category:null,reasoning:rule?category:null,style:style['Style ID']||style['Style Category']||null,color:color['Product Type']??null,typography:typography['Font Pairing Name']??null,landing:landing['Pattern Name']??null},
    source_derivations:{color_mode:color._mode_derivation??null},severity:reasoning.severity,
    dials:{variance:variance?.value??null,variance_label:variance?.label??null,motion:motion?.value??null,motion_label:motion?.label??null,density:density?.value??null,density_label:density?.label??null},motion_snippet:motionSnippet,spacing_scale:density?.spacing??null,
  };
}
export type DesignSystem=ReturnType<typeof generateDesignSystem>;
