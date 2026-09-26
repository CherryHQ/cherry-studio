import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type Request = { project: string; affected?: string[]; operation?: string; surface?: string; model?: string; focus?: string; ui?: boolean; overlay?: string; role?: string; stack?: string };
const has = (p: string) => fs.existsSync(p);
const modes: Record<string, [string, number[], number[], number[]]> = {
  marketing: ['Persuade',[7,8],[5,7],[3,4]], landing: ['Persuade',[7,8],[5,7],[3,4]],
  docs: ['Read',[2,3],[1,2],[4,5]], reading: ['Read',[2,3],[1,2],[4,5]],
  showcase: ['Experience',[8,9],[7,8],[2,3]], portfolio: ['Experience',[8,9],[7,8],[2,3]]
};
const craft: Record<string,string> = {
  layout:'better-layout',typeset:'better-typography',typography:'better-typography',colorize:'better-colors',colors:'better-colors',
  clarify:'better-writing',copy:'better-writing',audit:'better-accessibility',harden:'better-accessibility',accessibility:'better-accessibility',
  animate:'better-ui',delight:'better-ui',motion:'better-ui'
};
function ancestors(root: string, affected: string): string[] {
  if(path.sep !== '\\' && (/^[a-z]:/i.test(affected) || affected.startsWith('\\\\'))) throw new Error('Windows absolute affected paths require Windows Node');
  const native = affected.replaceAll('\\',path.sep);
  let dir = path.resolve(root,native);
  if (dir !== root && !dir.startsWith(root+path.sep)) throw new Error('affected path escapes project');
  if (!has(dir) || !fs.statSync(dir).isDirectory()) dir=path.dirname(dir);
  const out: string[]=[];
  while(dir===root || dir.startsWith(root+path.sep)){ out.push(dir); if(dir===root) break; dir=path.dirname(dir); }
  return out;
}
function appInfo(root: string, affected: string) {
  const dirs=ancestors(root,affected);
  const app=dirs.find(d=>['package.json','pubspec.yaml','Package.swift','build.gradle.kts','build.gradle','Cargo.toml'].some(f=>has(path.join(d,f))))??root;
  const pkgPath=path.join(app,'package.json');
  const pkg=has(pkgPath)?JSON.parse(fs.readFileSync(pkgPath,'utf8')):{};
  const deps={...pkg.dependencies,...pkg.devDependencies};
  const stacks:string[]=[];
  const skills:string[]=[];
  const docs:string[]=[];
  if(deps.react && !deps['react-native']){stacks.push('react');skills.push('vercel-react-best-practices','vercel-composition-patterns','web-design-guidelines');}
  if(deps['react-native']){stacks.push('react-native');skills.push('vercel-react-native-skills');}
  if(deps.expo){stacks.push('expo');skills.push('expo-native-ui','expo-design-system','expo-router','expo-animation','expo-ui');docs.push('Match Expo guidance to declared SDK '+deps.expo+'; do not upgrade it to fit the skill.');}
  if(has(path.join(app,'pubspec.yaml'))){stacks.push('flutter');skills.push('flutter-build-responsive-layout','flutter-fix-layout-issues','flutter-setup-declarative-routing','flutter-setup-localization');}
  if((has(path.join(app,'Package.swift')) && /swiftui|iOS|macOS/i.test(fs.readFileSync(path.join(app,'Package.swift'),'utf8'))) || dirs.some(d=>has(d)&&fs.statSync(d).isDirectory()&&fs.readdirSync(d).some(n=>n.endsWith('.xcodeproj')))){stacks.push('swiftui');skills.push('swiftui-pro');docs.push('Apple build/profiling requires Apple tooling; preserve deployment targets.');}
  if(['build.gradle.kts','build.gradle'].some(f=>has(path.join(app,f)) && /compose/i.test(fs.readFileSync(path.join(app,f),'utf8')))){stacks.push('jetpack-compose');skills.push('android-compose-adaptive','android-edge-to-edge');docs.push('Confirm Compose and navigation prerequisites; never infer a migration from skill availability.');}
  if(deps['@tauri-apps/api'] || has(path.join(app,'src-tauri','tauri.conf.json'))){stacks.push('tauri');const available=['tauri-react-vite','tauri-ui-review','tauri-custom-titlebar'].filter(id=>has(path.join(root,'.agents/skills',id,'SKILL.md')) || has(path.join(root,'.claude/skills',id,'SKILL.md')));skills.push(...available);docs.push('Use existing project Tauri skills and titlebar/platform conventions; missing specialists require current official docs, not an invented installed capability.');}
  if(deps.electron){stacks.push('electron');if(has(path.join(root,'.agents/skills/cherry-electron-dev/SKILL.md')))skills.push('cherry-electron-dev');docs.push('Use the existing Electron workflow, security boundary, design tokens and capture tools.');}
  if(!stacks.length && pkgPath && has(pkgPath)){stacks.push('web');skills.push('web-design-guidelines');}
  return {root:app,stacks:[...new Set(stacks)],skills:[...new Set(skills)],guidance:docs};
}
export function route(request: Request) {
  const root=fs.realpathSync(request.project);
  if(request.ui===false) return {schemaVersion:1,ui:false,skills:[],context:[],teamRouting:'.agent-team/project-routing.json'};
  const operation=request.operation??'refine';
  if(!['new','redesign','refine','review'].includes(operation))throw new Error('operation must be new, redesign, refine or review');
  const review=operation==='review'|| /reviewer|verifier|auditor/.test(request.role??'');
  const applications=[...new Map((request.affected?.length?request.affected:['.']).map(p=>{const info=appInfo(root,p);return [info.root,info];})).values()];
  const context=[...new Set(applications.flatMap(a=>ancestors(root,a.root).flatMap(d=>['PRODUCT.md','DESIGN.md','.impeccable.md','.agents/UI_UX_PROTOCOL.md'].map(f=>path.join(d,f)).filter(has))))];
  const surfaceAliases: Record<string,string> = {pricing:'marketing',campaign:'marketing',article:'reading',articles:'reading',changelog:'reading',changelogs:'reading',documentation:'docs'};
  const surface=surfaceAliases[request.surface??'']??request.surface??'';
  const [mode,variance,motion,density]=modes[surface]??['Operate',[3,4],[2,3],[6,8]];
  const nativeSkill=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../impeccable/SKILL.md');
  const skills=[process.env.IMPECCABLE_BIN && has(process.env.IMPECCABLE_BIN) && has(nativeSkill) ? 'impeccable' : 'prometheus-impeccable-core','ui-ux-pro-max'];
  if(!review && ['new','redesign'].includes(operation)){
    skills.push(operation==='redesign'?'redesign-existing-projects':/(^|[/ :])gpt([\d-]|$)/i.test(request.model??'')?'gpt-taste':'design-taste-frontend');
    if(request.overlay){if(!['high-end-visual-design','minimalist-ui','industrial-brutalist-ui'].includes(request.overlay))throw new Error('unsupported explicit overlay');skills.push(request.overlay);}
  }
  skills.push(review?'prometheus-ui-review':craft[request.focus??'']??'better-interface');
  for(const app of applications)skills.push(...app.skills);
  return {schemaVersion:1,ui:true,operation:review?'review':operation,mode,dials:{variance,motion,density},context,applications,
    skills:[...new Set(skills)],proMax:{query:[request.surface??'application',request.focus??'interface',request.stack??applications.flatMap(a=>a.stacks).join(' ')].join(' '),
    generateDesignSystem:!review&&['new','redesign'].includes(operation)},projectProtocol:has(path.join(root,'.agents/UI_UX_PROTOCOL.md'))?'.agents/UI_UX_PROTOCOL.md':null,
    authority:'Existing product, design, tokens and project pins precede recommendations.',verification:'At completed phase only; independent reviewer required; one batched correction/confirmation.'};
}
