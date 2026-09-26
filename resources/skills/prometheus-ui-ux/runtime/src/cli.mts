import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {route, type Request} from './routing.mjs';
import {install} from './install.mjs';

const skillRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function main(){
  const [command,...args]=process.argv.slice(2);
  let project='.',input:string|undefined,target='both',dryRun=false,check=false;
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(arg==='--project'||arg==='--path')project=args[++i]!;
    else if(arg==='--input')input=args[++i];
    else if(arg==='--target')target=args[++i]!;
    else if(arg==='--dry-run')dryRun=true;
    else if(arg==='--check')check=true;
    else throw new Error('unknown option '+arg);
  }
  if(check&&dryRun)throw new Error('--check and --dry-run are mutually exclusive');
  if(command==='install'){
    const result=install({project,skillRoot,target,dryRun,check});
    console.log(JSON.stringify(result,null,2));if(check&&result.changed)process.exitCode=1;return;
  }
  if(!input)throw new Error('route/phase-boundary requires --input request.json');
  const request=JSON.parse(fs.readFileSync(input,'utf8')) as Request;
  const routed=route(request);
  if(command==='route'){console.log(JSON.stringify(routed,null,2));return;}
  if(command==='phase-boundary'){
    console.log(JSON.stringify({schemaVersion:1,routing:routed,required:routed.ui?['applicable device/theme captures','keyboard and reduced-motion evidence','independent read-only review','one batched correction and confirmation']:[],
      executed:false,status:'evidence-required',hook:{command:'node',args:[path.join(skillRoot,'scripts/cli.mjs'),'phase-boundary','--input',path.resolve(input)]}},null,2));return;
  }
  throw new Error('expected route, install or phase-boundary');
}
try{main();}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=2;}

