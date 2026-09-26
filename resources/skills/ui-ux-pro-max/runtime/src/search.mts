import {realpathSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {search,searchStack,domains,stacks} from './core.mjs';
import {generateDesignSystem} from './design-system.mjs';
import {persistDesignSystem} from './persistence.mjs';
import {formatOutput,formatMarkdown,formatAscii} from './format.mjs';
export {search,searchStack,generateDesignSystem,persistDesignSystem};
const usage='Usage: node <skill>/scripts/search.mjs "query" [--domain domain | --stack stack] [-n 1-20] [--json] [--full]\n       node <skill>/scripts/search.mjs "query" --design-system [-p name] [-f ascii|markdown] [--variance 1-10] [--motion 1-10] [--density 1-10] [--persist --output-dir project [--page page] [--force]]';
export async function main(args=process.argv.slice(2)):Promise<number>{
  if(args.includes('--help')||args.includes('-h')){console.log(`${usage}\nDomains: ${domains.join(', ')}\nStacks: ${stacks.join(', ')}`);return 0;}
  const aliases:Record<string,string>={'-d':'domain','-s':'stack','-n':'max-results','-p':'project-name','-f':'format','-o':'output-dir','-ds':'design-system'};
  const switches=new Set(['json','full','design-system','persist','force','diagnostics']),values=new Set(['domain','stack','max-results','project-name','format','page','output-dir','variance','motion','density']);const options:Record<string,string|boolean>={};const positionals:string[]=[];
  for(let i=0;i<args.length;i++){const arg=args[i];if(arg==='--'){positionals.push(...args.slice(i+1));break;}if(!arg.startsWith('-')){positionals.push(arg);continue;}const equals=arg.indexOf('='),name=aliases[arg]??(equals<0?arg.slice(2):arg.slice(2,equals));if(switches.has(name)){if(equals>=0)throw new Error(`${arg} does not take a value`);options[name]=true;}else if(values.has(name)){const value=equals<0?args[++i]:arg.slice(equals+1);if(value===undefined)throw new Error(`Missing value for ${arg}`);options[name]=value;}else throw new Error(`Unknown option: ${arg}`);}
  if(positionals.length!==1)throw new Error(usage);const query=positionals[0];
  const number=(key:string,min:number,max:number,fallback?:number):number|undefined=>{if(options[key]===undefined)return fallback;const n=Number(options[key]);if(!Number.isInteger(n)||n<min||n>max)throw new Error(`${key} must be an integer from ${min} to ${max}`);return n;};
  const count=number('max-results',1,20,3)!,variance=number('variance',1,10),motion=number('motion',1,10),density=number('density',1,10);
  if(options.domain&&!domains.includes(String(options.domain)))throw new Error(`Unknown domain: ${options.domain}`);if(options.stack&&!stacks.includes(String(options.stack)))throw new Error(`Unknown stack: ${options.stack}`);if(options.format&&!['ascii','markdown'].includes(String(options.format)))throw new Error('format must be ascii or markdown');
  if(options['design-system']){if(options.stack)console.error(`note: --stack ${options.stack} is ignored in --design-system mode; run a separate --stack query for stack-specific guidelines`);const system=generateDesignSystem(query,{projectName:options['project-name'] as string|undefined,variance,motion,density});const persistence=options.persist?await persistDesignSystem(system,{page:options.page as string|undefined,outputDir:options['output-dir'] as string|undefined,query,force:Boolean(options.force)}):null;
    if(options.json)console.log(JSON.stringify({design_system:system,persistence},null,2));else{console.log(options.format==='markdown'?formatMarkdown(system):formatAscii(system));if(persistence)console.log(JSON.stringify(persistence,null,2));}return 0;}
  const result=options.stack?searchStack(query,String(options.stack),count,Boolean(options.diagnostics)):search(query,options.domain as string|undefined,count,Boolean(options.diagnostics));console.log(options.json?JSON.stringify(result,null,2):formatOutput(result,Boolean(options.full)));return result.error?1:0;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href)main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(`Error: ${error.message}`);process.exitCode=1;});
