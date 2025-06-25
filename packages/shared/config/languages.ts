/**
 * 代码语言扩展名列表
 */

type LanguageData = {
  type: string
  aliases?: string[]
  extensions?: string[]
}

export const languages: Record<string, LanguageData> = {
  'c2hs haskell': {
    extensions: ['.chs'],
    type: 'programming',
    aliases: ['c2hs']
  },
  tsql: {
    extensions: ['.sql'],
    type: 'programming'
  },
  uno: {
    extensions: ['.uno'],
    type: 'programming'
  },
  'html+ecr': {
    extensions: ['.ecr'],
    type: 'markup',
    aliases: ['ecr']
  },
  xpages: {
    extensions: ['.xsp-config', '.xsp.metadata'],
    type: 'data'
  },
  'module management system': {
    extensions: ['.mms', '.mmk'],
    type: 'programming'
  },
  turing: {
    extensions: ['.t', '.tu'],
    type: 'programming'
  },
  harbour: {
    extensions: ['.hb'],
    type: 'programming'
  },
  sass: {
    extensions: ['.sass'],
    type: 'markup'
  },
  cobol: {
    extensions: ['.cob', '.cbl', '.ccp', '.cobol', '.cpy'],
    type: 'programming'
  },
  ioke: {
    extensions: ['.ik'],
    type: 'programming'
  },
  'standard ml': {
    extensions: ['.ml', '.fun', '.sig', '.sml'],
    type: 'programming',
    aliases: ['sml']
  },
  less: {
    extensions: ['.less'],
    type: 'markup',
    aliases: ['less-css']
  },
  cue: {
    extensions: ['.cue'],
    type: 'programming'
  },
  'q#': {
    extensions: ['.qs'],
    type: 'programming',
    aliases: ['qsharp']
  },
  'c#': {
    extensions: ['.cs', '.cake', '.cs.pp', '.csx', '.linq'],
    type: 'programming',
    aliases: ['csharp', 'cake', 'cakescript']
  },
  'closure templates': {
    extensions: ['.soy'],
    type: 'markup',
    aliases: ['soy']
  },
  'modula-2': {
    extensions: ['.mod'],
    type: 'programming'
  },
  cirru: {
    extensions: ['.cirru'],
    type: 'programming'
  },
  prisma: {
    extensions: ['.prisma'],
    type: 'data'
  },
  xojo: {
    extensions: ['.xojo_code', '.xojo_menu', '.xojo_report', '.xojo_script', '.xojo_toolbar', '.xojo_window'],
    type: 'programming'
  },
  'vim script': {
    extensions: ['.vim', '.vba', '.vimrc', '.vmb'],
    type: 'programming',
    aliases: ['vim', 'viml', 'nvim', 'vimscript']
  },
  unrealscript: {
    extensions: ['.uc'],
    type: 'programming'
  },
  'kicad layout': {
    extensions: ['.kicad_pcb', '.kicad_mod', '.kicad_wks'],
    type: 'data',
    aliases: ['pcbnew']
  },
  urweb: {
    extensions: ['.ur', '.urs'],
    type: 'programming',
    aliases: ['Ur/Web', 'Ur']
  },
  'rpm spec': {
    extensions: ['.spec'],
    type: 'data',
    aliases: ['specfile']
  },
  hcl: {
    extensions: ['.hcl', '.nomad', '.tf', '.tfvars', '.workflow'],
    type: 'programming',
    aliases: ['HashiCorp Configuration Language', 'terraform']
  },
  'vim help file': {
    extensions: ['.txt'],
    type: 'prose',
    aliases: ['help', 'vimhelp']
  },
  'component pascal': {
    extensions: ['.cp', '.cps'],
    type: 'programming'
  },
  realbasic: {
    extensions: ['.rbbas', '.rbfrm', '.rbmnu', '.rbres', '.rbtbar', '.rbuistate'],
    type: 'programming'
  },
  cil: {
    extensions: ['.cil'],
    type: 'data'
  },
  nix: {
    extensions: ['.nix'],
    type: 'programming',
    aliases: ['nixos']
  },
  mirah: {
    extensions: ['.druby', '.duby', '.mirah'],
    type: 'programming'
  },
  red: {
    extensions: ['.red', '.reds'],
    type: 'programming',
    aliases: ['red/system']
  },
  zimpl: {
    extensions: ['.zimpl', '.zmpl', '.zpl'],
    type: 'programming'
  },
  'world of warcraft addon data': {
    extensions: ['.toc'],
    type: 'data'
  },
  logtalk: {
    extensions: ['.lgt', '.logtalk'],
    type: 'programming'
  },
  'digital command language': {
    extensions: ['.com'],
    type: 'programming',
    aliases: ['dcl']
  },
  'inno setup': {
    extensions: ['.iss', '.isl'],
    type: 'programming'
  },
  ruby: {
    extensions: [
      '.rb',
      '.builder',
      '.eye',
      '.fcgi',
      '.gemspec',
      '.god',
      '.jbuilder',
      '.mspec',
      '.pluginspec',
      '.podspec',
      '.prawn',
      '.rabl',
      '.rake',
      '.rbi',
      '.rbuild',
      '.rbw',
      '.rbx',
      '.ru',
      '.ruby',
      '.spec',
      '.thor',
      '.watchr'
    ],
    type: 'programming',
    aliases: ['jruby', 'macruby', 'rake', 'rb', 'rbx']
  },
  sqlpl: {
    extensions: ['.sql', '.db2'],
    type: 'programming'
  },
  qmake: {
    extensions: ['.pro', '.pri'],
    type: 'programming'
  },
  faust: {
    extensions: ['.dsp'],
    type: 'programming'
  },
  nextflow: {
    extensions: ['.nf'],
    type: 'programming'
  },
  ox: {
    extensions: ['.ox', '.oxh', '.oxo'],
    type: 'programming'
  },
  xproc: {
    extensions: ['.xpl', '.xproc'],
    type: 'programming'
  },
  'directx 3d file': {
    extensions: ['.x'],
    type: 'data'
  },
  'jupyter notebook': {
    extensions: ['.ipynb'],
    type: 'markup',
    aliases: ['IPython Notebook']
  },
  jolie: {
    extensions: ['.ol', '.iol'],
    type: 'programming'
  },
  cartocss: {
    extensions: ['.mss'],
    type: 'programming',
    aliases: ['Carto']
  },
  'ltspice symbol': {
    extensions: ['.asy'],
    type: 'data'
  },
  slash: {
    extensions: ['.sl'],
    type: 'programming'
  },
  'pure data': {
    extensions: ['.pd'],
    type: 'data'
  },
  yang: {
    extensions: ['.yang'],
    type: 'data'
  },
  prolog: {
    extensions: ['.pl', '.plt', '.pro', '.prolog', '.yap'],
    type: 'programming'
  },
  'g-code': {
    extensions: ['.g', '.cnc', '.gco', '.gcode'],
    type: 'programming'
  },
  minid: {
    extensions: ['.minid'],
    type: 'programming'
  },
  'ecere projects': {
    extensions: ['.epj'],
    type: 'data'
  },
  org: {
    extensions: ['.org'],
    type: 'prose'
  },
  tcsh: {
    extensions: ['.tcsh', '.csh'],
    type: 'programming'
  },
  scilab: {
    extensions: ['.sci', '.sce', '.tst'],
    type: 'programming'
  },
  hack: {
    extensions: ['.hack', '.hh', '.hhi', '.php'],
    type: 'programming'
  },
  coffeescript: {
    extensions: ['.coffee', '._coffee', '.cake', '.cjsx', '.iced'],
    type: 'programming',
    aliases: ['coffee', 'coffee-script']
  },
  'visual basic .net': {
    extensions: ['.vb', '.vbhtml'],
    type: 'programming',
    aliases: ['visual basic', 'vbnet', 'vb .net', 'vb.net']
  },
  opa: {
    extensions: ['.opa'],
    type: 'programming'
  },
  clean: {
    extensions: ['.icl', '.dcl'],
    type: 'programming'
  },
  batchfile: {
    extensions: ['.bat', '.cmd'],
    type: 'programming',
    aliases: ['bat', 'batch', 'dosbatch', 'winbatch']
  },
  v: {
    extensions: ['.v'],
    type: 'programming',
    aliases: ['vlang']
  },
  vhdl: {
    extensions: ['.vhdl', '.vhd', '.vhf', '.vhi', '.vho', '.vhs', '.vht', '.vhw'],
    type: 'programming'
  },
  pawn: {
    extensions: ['.pwn', '.inc', '.sma'],
    type: 'programming'
  },
  abap: {
    extensions: ['.abap'],
    type: 'programming'
  },
  'public key': {
    extensions: ['.asc', '.pub'],
    type: 'data'
  },
  svelte: {
    extensions: ['.svelte'],
    type: 'markup'
  },
  xonsh: {
    extensions: ['.xsh'],
    type: 'programming'
  },
  'api blueprint': {
    extensions: ['.apib'],
    type: 'markup'
  },
  'glyph bitmap distribution format': {
    extensions: ['.bdf'],
    type: 'data'
  },
  'common lisp': {
    extensions: ['.lisp', '.asd', '.cl', '.l', '.lsp', '.ny', '.podsl', '.sexp'],
    type: 'programming',
    aliases: ['lisp']
  },
  julia: {
    extensions: ['.jl'],
    type: 'programming'
  },
  rmarkdown: {
    extensions: ['.qmd', '.rmd'],
    type: 'prose'
  },
  applescript: {
    extensions: ['.applescript', '.scpt'],
    type: 'programming',
    aliases: ['osascript']
  },
  zap: {
    extensions: ['.zap', '.xzap'],
    type: 'programming'
  },
  filterscript: {
    extensions: ['.fs'],
    type: 'programming'
  },
  glsl: {
    extensions: [
      '.glsl',
      '.fp',
      '.frag',
      '.frg',
      '.fs',
      '.fsh',
      '.fshader',
      '.geo',
      '.geom',
      '.glslf',
      '.glslv',
      '.gs',
      '.gshader',
      '.rchit',
      '.rmiss',
      '.shader',
      '.tesc',
      '.tese',
      '.vert',
      '.vrx',
      '.vs',
      '.vsh',
      '.vshader'
    ],
    type: 'programming'
  },
  vcl: {
    extensions: ['.vcl'],
    type: 'programming'
  },
  gdb: {
    extensions: ['.gdb', '.gdbinit'],
    type: 'programming'
  },
  nanorc: {
    extensions: ['.nanorc'],
    type: 'data'
  },
  'parrot internal representation': {
    extensions: ['.pir'],
    type: 'programming',
    aliases: ['pir']
  },
  pod: {
    extensions: ['.pod'],
    type: 'prose'
  },
  m4sugar: {
    extensions: ['.m4'],
    type: 'programming',
    aliases: ['autoconf']
  },
  mlir: {
    extensions: ['.mlir'],
    type: 'programming'
  },
  monkey: {
    extensions: ['.monkey', '.monkey2'],
    type: 'programming'
  },
  nim: {
    extensions: ['.nim', '.nim.cfg', '.nimble', '.nimrod', '.nims'],
    type: 'programming'
  },
  'gentoo ebuild': {
    extensions: ['.ebuild'],
    type: 'programming'
  },
  racket: {
    extensions: ['.rkt', '.rktd', '.rktl', '.scrbl'],
    type: 'programming'
  },
  ebnf: {
    extensions: ['.ebnf'],
    type: 'data'
  },
  charity: {
    extensions: ['.ch'],
    type: 'programming'
  },
  groovy: {
    extensions: ['.groovy', '.grt', '.gtpl', '.gvy'],
    type: 'programming'
  },
  hiveql: {
    extensions: ['.q', '.hql'],
    type: 'programming'
  },
  'f*': {
    extensions: ['.fst', '.fsti'],
    type: 'programming',
    aliases: ['fstar']
  },
  systemverilog: {
    extensions: ['.sv', '.svh', '.vh'],
    type: 'programming'
  },
  jison: {
    extensions: ['.jison'],
    type: 'programming'
  },
  fantom: {
    extensions: ['.fan'],
    type: 'programming'
  },
  scheme: {
    extensions: ['.scm', '.sch', '.sld', '.sls', '.sps', '.ss'],
    type: 'programming'
  },
  'cpp-objdump': {
    extensions: ['.cppobjdump', '.c++-objdump', '.c++objdump', '.cpp-objdump', '.cxx-objdump'],
    type: 'data',
    aliases: ['c++-objdump']
  },
  arc: {
    extensions: ['.arc'],
    type: 'programming'
  },
  logos: {
    extensions: ['.xm', '.x', '.xi'],
    type: 'programming'
  },
  assembly: {
    extensions: ['.asm', '.a51', '.i', '.inc', '.nas', '.nasm', '.s'],
    type: 'programming',
    aliases: ['asm', 'nasm']
  },
  'java properties': {
    extensions: ['.properties'],
    type: 'data'
  },
  haskell: {
    extensions: ['.hs', '.hs-boot', '.hsc'],
    type: 'programming'
  },
  ragel: {
    extensions: ['.rl'],
    type: 'programming',
    aliases: ['ragel-rb', 'ragel-ruby']
  },
  gn: {
    extensions: ['.gn', '.gni'],
    type: 'data'
  },
  '1c enterprise': {
    extensions: ['.bsl', '.os'],
    type: 'programming'
  },
  diff: {
    extensions: ['.diff', '.patch'],
    type: 'data',
    aliases: ['udiff']
  },
  http: {
    extensions: ['.http'],
    type: 'data'
  },
  tex: {
    extensions: [
      '.tex',
      '.aux',
      '.bbx',
      '.cbx',
      '.cls',
      '.dtx',
      '.ins',
      '.lbx',
      '.ltx',
      '.mkii',
      '.mkiv',
      '.mkvi',
      '.sty',
      '.toc'
    ],
    type: 'markup',
    aliases: ['latex']
  },
  mathematica: {
    extensions: ['.mathematica', '.cdf', '.m', '.ma', '.mt', '.nb', '.nbp', '.wl', '.wlt'],
    type: 'programming',
    aliases: ['mma', 'wolfram', 'wolfram language', 'wolfram lang', 'wl']
  },
  'javascript+erb': {
    extensions: ['.js.erb'],
    type: 'programming'
  },
  muse: {
    extensions: ['.muse'],
    type: 'prose',
    aliases: ['amusewiki', 'emacs muse']
  },
  'openedge abl': {
    extensions: ['.p', '.cls', '.w'],
    type: 'programming',
    aliases: ['progress', 'openedge', 'abl']
  },
  ninja: {
    extensions: ['.ninja'],
    type: 'data'
  },
  agda: {
    extensions: ['.agda'],
    type: 'programming'
  },
  aspectj: {
    extensions: ['.aj'],
    type: 'programming'
  },
  jq: {
    extensions: ['.jq'],
    type: 'programming'
  },
  apex: {
    extensions: ['.cls', '.apex', '.trigger'],
    type: 'programming'
  },
  bluespec: {
    extensions: ['.bsv'],
    type: 'programming',
    aliases: ['bluespec bsv', 'bsv']
  },
  forth: {
    extensions: ['.fth', '.4th', '.f', '.for', '.forth', '.fr', '.frt', '.fs'],
    type: 'programming'
  },
  xc: {
    extensions: ['.xc'],
    type: 'programming'
  },
  fortran: {
    extensions: ['.f', '.f77', '.for', '.fpp'],
    type: 'programming'
  },
  haxe: {
    extensions: ['.hx', '.hxsl'],
    type: 'programming'
  },
  rust: {
    extensions: ['.rs', '.rs.in'],
    type: 'programming',
    aliases: ['rs']
  },
  'cabal config': {
    extensions: ['.cabal'],
    type: 'data',
    aliases: ['Cabal']
  },
  netlogo: {
    extensions: ['.nlogo'],
    type: 'programming'
  },
  'imagej macro': {
    extensions: ['.ijm'],
    type: 'programming',
    aliases: ['ijm']
  },
  autohotkey: {
    extensions: ['.ahk', '.ahkl'],
    type: 'programming',
    aliases: ['ahk']
  },
  haproxy: {
    extensions: ['.cfg'],
    type: 'data'
  },
  zil: {
    extensions: ['.zil', '.mud'],
    type: 'programming'
  },
  'abap cds': {
    extensions: ['.asddls'],
    type: 'programming'
  },
  'html+razor': {
    extensions: ['.cshtml', '.razor'],
    type: 'markup',
    aliases: ['razor']
  },
  boo: {
    extensions: ['.boo'],
    type: 'programming'
  },
  smarty: {
    extensions: ['.tpl'],
    type: 'programming'
  },
  mako: {
    extensions: ['.mako', '.mao'],
    type: 'programming'
  },
  nearley: {
    extensions: ['.ne', '.nearley'],
    type: 'programming'
  },
  llvm: {
    extensions: ['.ll'],
    type: 'programming'
  },
  piglatin: {
    extensions: ['.pig'],
    type: 'programming'
  },
  'unix assembly': {
    extensions: ['.s', '.ms'],
    type: 'programming',
    aliases: ['gas', 'gnu asm', 'unix asm']
  },
  metal: {
    extensions: ['.metal'],
    type: 'programming'
  },
  shen: {
    extensions: ['.shen'],
    type: 'programming'
  },
  labview: {
    extensions: ['.lvproj', '.lvclass', '.lvlib'],
    type: 'programming'
  },
  nemerle: {
    extensions: ['.n'],
    type: 'programming'
  },
  rpc: {
    extensions: ['.x'],
    type: 'programming',
    aliases: ['rpcgen', 'oncrpc', 'xdr']
  },
  'python traceback': {
    extensions: ['.pytb'],
    type: 'data'
  },
  clojure: {
    extensions: ['.clj', '.bb', '.boot', '.cl2', '.cljc', '.cljs', '.cljs.hl', '.cljscm', '.cljx', '.hic'],
    type: 'programming'
  },
  eiffel: {
    extensions: ['.e'],
    type: 'programming'
  },
  genie: {
    extensions: ['.gs'],
    type: 'programming'
  },
  shaderlab: {
    extensions: ['.shader'],
    type: 'programming'
  },
  makefile: {
    extensions: ['.mak', '.d', '.make', '.makefile', '.mk', '.mkfile'],
    type: 'programming',
    aliases: ['bsdmake', 'make', 'mf']
  },
  rouge: {
    extensions: ['.rg'],
    type: 'programming'
  },
  dircolors: {
    extensions: ['.dircolors'],
    type: 'data'
  },
  ncl: {
    extensions: ['.ncl'],
    type: 'programming'
  },
  puppet: {
    extensions: ['.pp'],
    type: 'programming'
  },
  sparql: {
    extensions: ['.sparql', '.rq'],
    type: 'data'
  },
  'qt script': {
    extensions: ['.qs'],
    type: 'programming'
  },
  golo: {
    extensions: ['.golo'],
    type: 'programming'
  },
  lark: {
    extensions: ['.lark'],
    type: 'data'
  },
  nginx: {
    extensions: ['.nginx', '.nginxconf', '.vhost'],
    type: 'data',
    aliases: ['nginx configuration file']
  },
  wikitext: {
    extensions: ['.mediawiki', '.wiki', '.wikitext'],
    type: 'prose',
    aliases: ['mediawiki', 'wiki']
  },
  ceylon: {
    extensions: ['.ceylon'],
    type: 'programming'
  },
  stan: {
    extensions: ['.stan'],
    type: 'programming'
  },
  cmake: {
    extensions: ['.cmake', '.cmake.in'],
    type: 'programming'
  },
  loomscript: {
    extensions: ['.ls'],
    type: 'programming'
  },
  ooc: {
    extensions: ['.ooc'],
    type: 'programming'
  },
  json: {
    extensions: [
      '.json',
      '.4DForm',
      '.4DProject',
      '.avsc',
      '.geojson',
      '.gltf',
      '.har',
      '.ice',
      '.JSON-tmLanguage',
      '.json.example',
      '.jsonl',
      '.mcmeta',
      '.sarif',
      '.tact',
      '.tfstate',
      '.tfstate.backup',
      '.topojson',
      '.webapp',
      '.webmanifest',
      '.yy',
      '.yyp'
    ],
    type: 'data',
    aliases: ['geojson', 'jsonl', 'sarif', 'topojson']
  },
  formatted: {
    extensions: ['.for', '.eam.fs'],
    type: 'data'
  },
  'html+eex': {
    extensions: ['.html.eex', '.heex', '.leex'],
    type: 'markup',
    aliases: ['eex', 'heex', 'leex']
  },
  q: {
    extensions: ['.q'],
    type: 'programming'
  },
  pike: {
    extensions: ['.pike', '.pmod'],
    type: 'programming'
  },
  robotframework: {
    extensions: ['.robot', '.resource'],
    type: 'programming'
  },
  gedcom: {
    extensions: ['.ged'],
    type: 'data'
  },
  rdoc: {
    extensions: ['.rdoc'],
    type: 'prose'
  },
  'literate agda': {
    extensions: ['.lagda'],
    type: 'programming'
  },
  dm: {
    extensions: ['.dm'],
    type: 'programming',
    aliases: ['byond']
  },
  ec: {
    extensions: ['.ec', '.eh'],
    type: 'programming'
  },
  kusto: {
    extensions: ['.csl', '.kql'],
    type: 'data'
  },
  "cap'n proto": {
    extensions: ['.capnp'],
    type: 'programming'
  },
  'darcs patch': {
    extensions: ['.darcspatch', '.dpatch'],
    type: 'data',
    aliases: ['dpatch']
  },
  'srecode template': {
    extensions: ['.srt'],
    type: 'markup'
  },
  factor: {
    extensions: ['.factor'],
    type: 'programming'
  },
  tsx: {
    extensions: ['.tsx'],
    type: 'programming'
  },
  css: {
    extensions: ['.css'],
    type: 'markup'
  },
  json5: {
    extensions: ['.json5'],
    type: 'data'
  },
  'jison lex': {
    extensions: ['.jisonlex'],
    type: 'programming'
  },
  mtml: {
    extensions: ['.mtml'],
    type: 'markup'
  },
  ballerina: {
    extensions: ['.bal'],
    type: 'programming'
  },
  brainfuck: {
    extensions: ['.b', '.bf'],
    type: 'programming'
  },
  swift: {
    extensions: ['.swift'],
    type: 'programming'
  },
  gherkin: {
    extensions: ['.feature', '.story'],
    type: 'programming',
    aliases: ['cucumber']
  },
  textile: {
    extensions: ['.textile'],
    type: 'prose'
  },
  mql4: {
    extensions: ['.mq4', '.mqh'],
    type: 'programming'
  },
  ejs: {
    extensions: ['.ejs', '.ect', '.ejs.t', '.jst'],
    type: 'markup'
  },
  'asn.1': {
    extensions: ['.asn', '.asn1'],
    type: 'data'
  },
  parrot: {
    extensions: ['.parrot'],
    type: 'programming'
  },
  plantuml: {
    extensions: ['.puml', '.iuml', '.plantuml'],
    type: 'data'
  },
  brightscript: {
    extensions: ['.brs'],
    type: 'programming'
  },
  slim: {
    extensions: ['.slim'],
    type: 'markup'
  },
  svg: {
    extensions: ['.svg'],
    type: 'data'
  },
  e: {
    extensions: ['.e'],
    type: 'programming'
  },
  text: {
    extensions: ['.txt', '.fr', '.nb', '.ncl', '.no'],
    type: 'prose',
    aliases: ['fundamental', 'plain text']
  },
  'fortran free form': {
    extensions: ['.f90', '.f03', '.f08', '.f95'],
    type: 'programming'
  },
  grace: {
    extensions: ['.grace'],
    type: 'programming'
  },
  clarion: {
    extensions: ['.clw'],
    type: 'programming'
  },
  'kicad legacy layout': {
    extensions: ['.brd'],
    type: 'data'
  },
  asymptote: {
    extensions: ['.asy'],
    type: 'programming'
  },
  kotlin: {
    extensions: ['.kt', '.ktm', '.kts'],
    type: 'programming'
  },
  texinfo: {
    extensions: ['.texinfo', '.texi', '.txi'],
    type: 'prose'
  },
  pogoscript: {
    extensions: ['.pogo'],
    type: 'programming'
  },
  xml: {
    extensions: [
      '.xml',
      '.adml',
      '.admx',
      '.ant',
      '.axaml',
      '.axml',
      '.builds',
      '.ccproj',
      '.ccxml',
      '.clixml',
      '.cproject',
      '.cscfg',
      '.csdef',
      '.csl',
      '.csproj',
      '.ct',
      '.depproj',
      '.dita',
      '.ditamap',
      '.ditaval',
      '.dll.config',
      '.dotsettings',
      '.filters',
      '.fsproj',
      '.fxml',
      '.glade',
      '.gml',
      '.gmx',
      '.gpx',
      '.grxml',
      '.gst',
      '.hzp',
      '.iml',
      '.ivy',
      '.jelly',
      '.jsproj',
      '.kml',
      '.launch',
      '.mdpolicy',
      '.mjml',
      '.mm',
      '.mod',
      '.mojo',
      '.mxml',
      '.natvis',
      '.ncl',
      '.ndproj',
      '.nproj',
      '.nuspec',
      '.odd',
      '.osm',
      '.pkgproj',
      '.pluginspec',
      '.proj',
      '.props',
      '.ps1xml',
      '.psc1',
      '.pt',
      '.qhelp',
      '.rdf',
      '.res',
      '.resx',
      '.rs',
      '.rss',
      '.sch',
      '.scxml',
      '.sfproj',
      '.shproj',
      '.slnx',
      '.srdf',
      '.storyboard',
      '.sublime-snippet',
      '.sw',
      '.targets',
      '.tml',
      '.ts',
      '.tsx',
      '.typ',
      '.ui',
      '.urdf',
      '.ux',
      '.vbproj',
      '.vcxproj',
      '.vsixmanifest',
      '.vssettings',
      '.vstemplate',
      '.vxml',
      '.wixproj',
      '.workflow',
      '.wsdl',
      '.wsf',
      '.wxi',
      '.wxl',
      '.wxs',
      '.x3d',
      '.xacro',
      '.xaml',
      '.xib',
      '.xlf',
      '.xliff',
      '.xmi',
      '.xml.dist',
      '.xmp',
      '.xproj',
      '.xsd',
      '.xspec',
      '.xul',
      '.zcml'
    ],
    type: 'data',
    aliases: ['rss', 'xsd', 'wsdl']
  },
  raml: {
    extensions: ['.raml'],
    type: 'markup'
  },
  flux: {
    extensions: ['.fx', '.flux'],
    type: 'programming'
  },
  nasl: {
    extensions: ['.nasl', '.inc'],
    type: 'programming'
  },
  saltstack: {
    extensions: ['.sls'],
    type: 'programming',
    aliases: ['saltstate', 'salt']
  },
  markdown: {
    extensions: [
      '.md',
      '.livemd',
      '.markdown',
      '.mdown',
      '.mdwn',
      '.mkd',
      '.mkdn',
      '.mkdown',
      '.ronn',
      '.scd',
      '.workbook'
    ],
    type: 'prose',
    aliases: ['md', 'pandoc']
  },
  starlark: {
    extensions: ['.bzl', '.star'],
    type: 'programming',
    aliases: ['bazel', 'bzl']
  },
  dylan: {
    extensions: ['.dylan', '.dyl', '.intr', '.lid'],
    type: 'programming'
  },
  'altium designer': {
    extensions: ['.OutJob', '.PcbDoc', '.PrjPCB', '.SchDoc'],
    type: 'data',
    aliases: ['altium']
  },
  mask: {
    extensions: ['.mask'],
    type: 'markup'
  },
  aidl: {
    extensions: ['.aidl'],
    type: 'programming'
  },
  powerbuilder: {
    extensions: ['.pbt', '.sra', '.sru', '.srw'],
    type: 'programming'
  },
  max: {
    extensions: ['.maxpat', '.maxhelp', '.maxproj', '.mxt', '.pat'],
    type: 'programming',
    aliases: ['max/msp', 'maxmsp']
  },
  'ti program': {
    extensions: ['.8xp', '.8xp.txt'],
    type: 'programming'
  },
  moocode: {
    extensions: ['.moo'],
    type: 'programming'
  },
  sql: {
    extensions: ['.sql', '.cql', '.ddl', '.inc', '.mysql', '.prc', '.tab', '.udf', '.viw'],
    type: 'data'
  },
  dhall: {
    extensions: ['.dhall'],
    type: 'programming'
  },
  befunge: {
    extensions: ['.befunge', '.bf'],
    type: 'programming'
  },
  'irc log': {
    extensions: ['.irclog', '.weechatlog'],
    type: 'data',
    aliases: ['irc', 'irc logs']
  },
  krl: {
    extensions: ['.krl'],
    type: 'programming'
  },
  'apollo guidance computer': {
    extensions: ['.agc'],
    type: 'programming'
  },
  ring: {
    extensions: ['.ring'],
    type: 'programming'
  },
  ada: {
    extensions: ['.adb', '.ada', '.ads'],
    type: 'programming',
    aliases: ['ada95', 'ada2005']
  },
  lua: {
    extensions: ['.lua', '.fcgi', '.nse', '.p8', '.pd_lua', '.rbxs', '.rockspec', '.wlua'],
    type: 'programming'
  },
  gams: {
    extensions: ['.gms'],
    type: 'programming'
  },
  csv: {
    extensions: ['.csv'],
    type: 'data'
  },
  asl: {
    extensions: ['.asl', '.dsl'],
    type: 'programming'
  },
  'graphviz (dot)': {
    extensions: ['.dot', '.gv'],
    type: 'data'
  },
  'figlet font': {
    extensions: ['.flf'],
    type: 'data',
    aliases: ['FIGfont']
  },
  edn: {
    extensions: ['.edn'],
    type: 'data'
  },
  txl: {
    extensions: ['.txl'],
    type: 'programming'
  },
  roff: {
    extensions: [
      '.roff',
      '.1',
      '.1in',
      '.1m',
      '.1x',
      '.2',
      '.3',
      '.3in',
      '.3m',
      '.3p',
      '.3pm',
      '.3qt',
      '.3x',
      '.4',
      '.5',
      '.6',
      '.7',
      '.8',
      '.9',
      '.l',
      '.man',
      '.mdoc',
      '.me',
      '.ms',
      '.n',
      '.nr',
      '.rno',
      '.tmac'
    ],
    type: 'markup',
    aliases: ['groff', 'man', 'manpage', 'man page', 'man-page', 'mdoc', 'nroff', 'troff']
  },
  idl: {
    extensions: ['.pro', '.dlm'],
    type: 'programming'
  },
  neon: {
    extensions: ['.neon'],
    type: 'data',
    aliases: ['nette object notation', 'ne-on']
  },
  'rich text format': {
    extensions: ['.rtf'],
    type: 'markup'
  },
  'peg.js': {
    extensions: ['.pegjs', '.peggy'],
    type: 'programming'
  },
  glyph: {
    extensions: ['.glf'],
    type: 'programming'
  },
  io: {
    extensions: ['.io'],
    type: 'programming'
  },
  nsis: {
    extensions: ['.nsi', '.nsh'],
    type: 'programming'
  },
  papyrus: {
    extensions: ['.psc'],
    type: 'programming'
  },
  'raw token data': {
    extensions: ['.raw'],
    type: 'data',
    aliases: ['raw']
  },
  'windows registry entries': {
    extensions: ['.reg'],
    type: 'data'
  },
  zephir: {
    extensions: ['.zep'],
    type: 'programming'
  },
  'objective-c++': {
    extensions: ['.mm'],
    type: 'programming',
    aliases: ['obj-c++', 'objc++', 'objectivec++']
  },
  wisp: {
    extensions: ['.wisp'],
    type: 'programming'
  },
  'protocol buffer': {
    extensions: ['.proto'],
    type: 'data',
    aliases: ['proto', 'protobuf', 'Protocol Buffers']
  },
  'object data instance notation': {
    extensions: ['.odin'],
    type: 'data'
  },
  modelica: {
    extensions: ['.mo'],
    type: 'programming'
  },
  easybuild: {
    extensions: ['.eb'],
    type: 'data'
  },
  'web ontology language': {
    extensions: ['.owl'],
    type: 'data'
  },
  sage: {
    extensions: ['.sage', '.sagews'],
    type: 'programming'
  },
  basic: {
    extensions: ['.bas'],
    type: 'programming'
  },
  smt: {
    extensions: ['.smt2', '.smt', '.z3'],
    type: 'programming'
  },
  tea: {
    extensions: ['.tea'],
    type: 'markup'
  },
  powershell: {
    extensions: ['.ps1', '.psd1', '.psm1'],
    type: 'programming',
    aliases: ['posh', 'pwsh']
  },
  boogie: {
    extensions: ['.bpl'],
    type: 'programming'
  },
  maxscript: {
    extensions: ['.ms', '.mcr'],
    type: 'programming'
  },
  gaml: {
    extensions: ['.gaml'],
    type: 'programming'
  },
  vbscript: {
    extensions: ['.vbs'],
    type: 'programming'
  },
  antlr: {
    extensions: ['.g4'],
    type: 'programming'
  },
  verilog: {
    extensions: ['.v', '.veo'],
    type: 'programming'
  },
  limbo: {
    extensions: ['.b', '.m'],
    type: 'programming'
  },
  j: {
    extensions: ['.ijs'],
    type: 'programming'
  },
  fennel: {
    extensions: ['.fnl'],
    type: 'programming'
  },
  tla: {
    extensions: ['.tla'],
    type: 'programming'
  },
  eq: {
    extensions: ['.eq'],
    type: 'programming'
  },
  'igor pro': {
    extensions: ['.ipf'],
    type: 'programming',
    aliases: ['igor', 'igorpro']
  },
  'regular expression': {
    extensions: ['.regexp', '.regex'],
    type: 'data',
    aliases: ['regexp', 'regex']
  },
  apacheconf: {
    extensions: ['.apacheconf', '.vhost'],
    type: 'data',
    aliases: ['aconf', 'apache']
  },
  objdump: {
    extensions: ['.objdump'],
    type: 'data'
  },
  pickle: {
    extensions: ['.pkl'],
    type: 'data'
  },
  cweb: {
    extensions: ['.w'],
    type: 'programming'
  },
  plsql: {
    extensions: [
      '.pls',
      '.bdy',
      '.ddl',
      '.fnc',
      '.pck',
      '.pkb',
      '.pks',
      '.plb',
      '.plsql',
      '.prc',
      '.spc',
      '.sql',
      '.tpb',
      '.tps',
      '.trg',
      '.vw'
    ],
    type: 'programming'
  },
  shellsession: {
    extensions: ['.sh-session'],
    type: 'programming',
    aliases: ['bash session', 'console']
  },
  x10: {
    extensions: ['.x10'],
    type: 'programming',
    aliases: ['xten']
  },
  thrift: {
    extensions: ['.thrift'],
    type: 'programming'
  },
  'microsoft visual studio solution': {
    extensions: ['.sln'],
    type: 'data'
  },
  freemarker: {
    extensions: ['.ftl'],
    type: 'programming',
    aliases: ['ftl']
  },
  creole: {
    extensions: ['.creole'],
    type: 'prose'
  },
  python: {
    extensions: [
      '.py',
      '.cgi',
      '.fcgi',
      '.gyp',
      '.gypi',
      '.lmi',
      '.py3',
      '.pyde',
      '.pyi',
      '.pyp',
      '.pyt',
      '.pyw',
      '.rpy',
      '.spec',
      '.tac',
      '.wsgi',
      '.xpy'
    ],
    type: 'programming',
    aliases: ['python3', 'rusthon']
  },
  livescript: {
    extensions: ['.ls', '._ls'],
    type: 'programming',
    aliases: ['live-script', 'ls']
  },
  numpy: {
    extensions: ['.numpy', '.numpyw', '.numsc'],
    type: 'programming'
  },
  objectscript: {
    extensions: ['.cls'],
    type: 'programming'
  },
  'jest snapshot': {
    extensions: ['.snap'],
    type: 'data'
  },
  'unified parallel c': {
    extensions: ['.upc'],
    type: 'programming'
  },
  'openstep property list': {
    extensions: ['.plist', '.glyphs'],
    type: 'data'
  },
  'conll-u': {
    extensions: ['.conllu', '.conll'],
    type: 'data',
    aliases: ['CoNLL', 'CoNLL-X']
  },
  frege: {
    extensions: ['.fr'],
    type: 'programming'
  },
  toml: {
    extensions: ['.toml'],
    type: 'data'
  },
  haml: {
    extensions: ['.haml', '.haml.deface'],
    type: 'markup'
  },
  jsoniq: {
    extensions: ['.jq'],
    type: 'programming'
  },
  picolisp: {
    extensions: ['.l'],
    type: 'programming'
  },
  collada: {
    extensions: ['.dae'],
    type: 'data'
  },
  erlang: {
    extensions: ['.erl', '.app', '.app.src', '.es', '.escript', '.hrl', '.xrl', '.yrl'],
    type: 'programming'
  },
  'ignore list': {
    extensions: ['.gitignore'],
    type: 'data',
    aliases: ['ignore', 'gitignore', 'git-ignore']
  },
  ini: {
    extensions: ['.ini', '.cfg', '.cnf', '.dof', '.frm', '.lektorproject', '.prefs', '.pro', '.properties', '.url'],
    type: 'data',
    aliases: ['dosini']
  },
  '4d': {
    extensions: ['.4dm'],
    type: 'programming'
  },
  freebasic: {
    extensions: ['.bi', '.bas'],
    type: 'programming',
    aliases: ['fb']
  },
  'classic asp': {
    extensions: ['.asp'],
    type: 'programming',
    aliases: ['asp']
  },
  'c-objdump': {
    extensions: ['.c-objdump'],
    type: 'data'
  },
  gradle: {
    extensions: ['.gradle'],
    type: 'data'
  },
  dataweave: {
    extensions: ['.dwl'],
    type: 'programming'
  },
  matlab: {
    extensions: ['.matlab', '.m'],
    type: 'programming',
    aliases: ['octave']
  },
  bicep: {
    extensions: ['.bicep', '.bicepparam'],
    type: 'programming'
  },
  'e-mail': {
    extensions: ['.eml', '.mbox'],
    type: 'data',
    aliases: ['email', 'eml', 'mail', 'mbox']
  },
  rebol: {
    extensions: ['.reb', '.r', '.r2', '.r3', '.rebol'],
    type: 'programming'
  },
  r: {
    extensions: ['.r', '.rd', '.rsx'],
    type: 'programming',
    aliases: ['Rscript', 'splus']
  },
  restructuredtext: {
    extensions: ['.rst', '.rest', '.rest.txt', '.rst.txt'],
    type: 'prose',
    aliases: ['rst']
  },
  pug: {
    extensions: ['.jade', '.pug'],
    type: 'markup'
  },
  ecl: {
    extensions: ['.ecl', '.eclxml'],
    type: 'programming'
  },
  myghty: {
    extensions: ['.myt'],
    type: 'programming'
  },
  'game maker language': {
    extensions: ['.gml'],
    type: 'programming'
  },
  redcode: {
    extensions: ['.cw'],
    type: 'programming'
  },
  'x pixmap': {
    extensions: ['.xpm', '.pm'],
    type: 'data',
    aliases: ['xpm']
  },
  'propeller spin': {
    extensions: ['.spin'],
    type: 'programming'
  },
  xslt: {
    extensions: ['.xslt', '.xsl'],
    type: 'programming',
    aliases: ['xsl']
  },
  dart: {
    extensions: ['.dart'],
    type: 'programming'
  },
  astro: {
    extensions: ['.astro'],
    type: 'markup'
  },
  java: {
    extensions: ['.java', '.jav', '.jsh'],
    type: 'programming'
  },
  'groovy server pages': {
    extensions: ['.gsp'],
    type: 'programming',
    aliases: ['gsp', 'java server page']
  },
  postscript: {
    extensions: ['.ps', '.eps', '.epsi', '.pfa'],
    type: 'markup',
    aliases: ['postscr']
  },
  bibtex: {
    extensions: ['.bib', '.bibtex'],
    type: 'markup'
  },
  cython: {
    extensions: ['.pyx', '.pxd', '.pxi'],
    type: 'programming',
    aliases: ['pyrex']
  },
  gosu: {
    extensions: ['.gs', '.gst', '.gsx', '.vark'],
    type: 'programming'
  },
  ston: {
    extensions: ['.ston'],
    type: 'data'
  },
  renderscript: {
    extensions: ['.rs', '.rsh'],
    type: 'programming'
  },
  lfe: {
    extensions: ['.lfe'],
    type: 'programming'
  },
  ampl: {
    extensions: ['.ampl', '.mod'],
    type: 'programming'
  },
  beef: {
    extensions: ['.bf'],
    type: 'programming'
  },
  'cue sheet': {
    extensions: ['.cue'],
    type: 'data'
  },
  'objective-c': {
    extensions: ['.m', '.h'],
    type: 'programming',
    aliases: ['obj-c', 'objc', 'objectivec']
  },
  scaml: {
    extensions: ['.scaml'],
    type: 'markup'
  },
  slice: {
    extensions: ['.ice'],
    type: 'programming'
  },
  zig: {
    extensions: ['.zig', '.zig.zon'],
    type: 'programming'
  },
  'open policy agent': {
    extensions: ['.rego'],
    type: 'programming'
  },
  opal: {
    extensions: ['.opal'],
    type: 'programming'
  },
  macaulay2: {
    extensions: ['.m2'],
    type: 'programming',
    aliases: ['m2']
  },
  twig: {
    extensions: ['.twig'],
    type: 'markup'
  },
  autoit: {
    extensions: ['.au3'],
    type: 'programming',
    aliases: ['au3', 'AutoIt3', 'AutoItScript']
  },
  mupad: {
    extensions: ['.mu'],
    type: 'programming'
  },
  coldfusion: {
    extensions: ['.cfm', '.cfml'],
    type: 'programming',
    aliases: ['cfm', 'cfml', 'coldfusion html']
  },
  'valve data format': {
    extensions: ['.vdf'],
    type: 'data',
    aliases: ['keyvalues', 'vdf']
  },
  sourcepawn: {
    extensions: ['.sp', '.inc'],
    type: 'programming',
    aliases: ['sourcemod']
  },
  p4: {
    extensions: ['.p4'],
    type: 'programming'
  },
  'spline font database': {
    extensions: ['.sfd'],
    type: 'data'
  },
  c: {
    extensions: ['.c', '.cats', '.h', '.h.in', '.idc'],
    type: 'programming'
  },
  'xml property list': {
    extensions: ['.plist', '.stTheme', '.tmCommand', '.tmLanguage', '.tmPreferences', '.tmSnippet', '.tmTheme'],
    type: 'data'
  },
  blitzmax: {
    extensions: ['.bmx'],
    type: 'programming',
    aliases: ['bmax']
  },
  'literate coffeescript': {
    extensions: ['.litcoffee', '.coffee.md'],
    type: 'programming',
    aliases: ['litcoffee']
  },
  moonscript: {
    extensions: ['.moon'],
    type: 'programming'
  },
  zenscript: {
    extensions: ['.zs'],
    type: 'programming'
  },
  desktop: {
    extensions: ['.desktop', '.desktop.in', '.service'],
    type: 'data'
  },
  angelscript: {
    extensions: ['.as', '.angelscript'],
    type: 'programming'
  },
  'csound score': {
    extensions: ['.sco'],
    type: 'programming',
    aliases: ['csound-sco']
  },
  scss: {
    extensions: ['.scss'],
    type: 'markup'
  },
  eagle: {
    extensions: ['.sch', '.brd'],
    type: 'data'
  },
  jsonld: {
    extensions: ['.jsonld'],
    type: 'data'
  },
  'microsoft developer studio project': {
    extensions: ['.dsp'],
    type: 'data'
  },
  liquid: {
    extensions: ['.liquid'],
    type: 'markup'
  },
  yara: {
    extensions: ['.yar', '.yara'],
    type: 'programming'
  },
  yasnippet: {
    extensions: ['.yasnippet'],
    type: 'markup',
    aliases: ['snippet', 'yas']
  },
  qml: {
    extensions: ['.qml', '.qbs'],
    type: 'programming'
  },
  newlisp: {
    extensions: ['.nl', '.lisp', '.lsp'],
    type: 'programming'
  },
  m4: {
    extensions: ['.m4', '.mc'],
    type: 'programming'
  },
  'gcc machine description': {
    extensions: ['.md'],
    type: 'programming'
  },
  odin: {
    extensions: ['.odin'],
    type: 'programming',
    aliases: ['odinlang', 'odin-lang']
  },
  'subrip text': {
    extensions: ['.srt'],
    type: 'data'
  },
  nesc: {
    extensions: ['.nc'],
    type: 'programming'
  },
  isabelle: {
    extensions: ['.thy'],
    type: 'programming'
  },
  jsonnet: {
    extensions: ['.jsonnet', '.libsonnet'],
    type: 'programming'
  },
  purebasic: {
    extensions: ['.pb', '.pbi'],
    type: 'programming'
  },
  proguard: {
    extensions: ['.pro'],
    type: 'data'
  },
  nunjucks: {
    extensions: ['.njk'],
    type: 'markup',
    aliases: ['njk']
  },
  stringtemplate: {
    extensions: ['.st'],
    type: 'markup'
  },
  'roff manpage': {
    extensions: [
      '.1',
      '.1in',
      '.1m',
      '.1x',
      '.2',
      '.3',
      '.3in',
      '.3m',
      '.3p',
      '.3pm',
      '.3qt',
      '.3x',
      '.4',
      '.5',
      '.6',
      '.7',
      '.8',
      '.9',
      '.man',
      '.mdoc'
    ],
    type: 'markup'
  },
  'vim snippet': {
    extensions: ['.snip', '.snippet', '.snippets'],
    type: 'markup',
    aliases: ['SnipMate', 'UltiSnip', 'UltiSnips', 'NeoSnippet']
  },
  'html+erb': {
    extensions: ['.erb', '.erb.deface', '.rhtml'],
    type: 'markup',
    aliases: ['erb', 'rhtml', 'html+ruby']
  },
  fluent: {
    extensions: ['.ftl'],
    type: 'programming'
  },
  turtle: {
    extensions: ['.ttl'],
    type: 'data'
  },
  'objective-j': {
    extensions: ['.j', '.sj'],
    type: 'programming',
    aliases: ['obj-j', 'objectivej', 'objj']
  },
  'kaitai struct': {
    extensions: ['.ksy'],
    type: 'programming',
    aliases: ['ksy']
  },
  scala: {
    extensions: ['.scala', '.kojo', '.sbt', '.sc'],
    type: 'programming'
  },
  sas: {
    extensions: ['.sas'],
    type: 'programming'
  },
  zeek: {
    extensions: ['.zeek', '.bro'],
    type: 'programming',
    aliases: ['bro']
  },
  vba: {
    extensions: ['.bas', '.cls', '.frm', '.vba'],
    type: 'programming',
    aliases: ['visual basic for applications']
  },
  go: {
    extensions: ['.go'],
    type: 'programming',
    aliases: ['golang']
  },
  php: {
    extensions: ['.php', '.aw', '.ctp', '.fcgi', '.inc', '.php3', '.php4', '.php5', '.phps', '.phpt'],
    type: 'programming',
    aliases: ['inc']
  },
  smali: {
    extensions: ['.smali'],
    type: 'programming'
  },
  gnuplot: {
    extensions: ['.gp', '.gnu', '.gnuplot', '.p', '.plot', '.plt'],
    type: 'programming'
  },
  fish: {
    extensions: ['.fish'],
    type: 'programming'
  },
  'selinux policy': {
    extensions: ['.te'],
    type: 'data',
    aliases: ['SELinux Kernel Policy Language', 'sepolicy']
  },
  tcl: {
    extensions: ['.tcl', '.adp', '.sdc', '.tcl.in', '.tm', '.xdc'],
    type: 'programming',
    aliases: ['sdc', 'xdc']
  },
  webvtt: {
    extensions: ['.vtt'],
    type: 'data',
    aliases: ['vtt']
  },
  'graph modeling language': {
    extensions: ['.gml'],
    type: 'data'
  },
  netlinx: {
    extensions: ['.axs', '.axi'],
    type: 'programming'
  },
  fancy: {
    extensions: ['.fy', '.fancypack'],
    type: 'programming'
  },
  'edje data collection': {
    extensions: ['.edc'],
    type: 'data'
  },
  rascal: {
    extensions: ['.rsc'],
    type: 'programming'
  },
  vue: {
    extensions: ['.vue'],
    type: 'markup'
  },
  chuck: {
    extensions: ['.ck'],
    type: 'programming'
  },
  nwscript: {
    extensions: ['.nss'],
    type: 'programming'
  },
  eclipse: {
    extensions: ['.ecl'],
    type: 'programming'
  },
  'pod 6': {
    extensions: ['.pod', '.pod6'],
    type: 'prose'
  },
  rescript: {
    extensions: ['.res', '.resi'],
    type: 'programming'
  },
  idris: {
    extensions: ['.idr', '.lidr'],
    type: 'programming'
  },
  hy: {
    extensions: ['.hy'],
    type: 'programming',
    aliases: ['hylang']
  },
  apl: {
    extensions: ['.apl', '.dyalog'],
    type: 'programming'
  },
  hlsl: {
    extensions: ['.hlsl', '.cginc', '.fx', '.fxh', '.hlsli'],
    type: 'programming'
  },
  csound: {
    extensions: ['.orc', '.udo'],
    type: 'programming',
    aliases: ['csound-orc']
  },
  genshi: {
    extensions: ['.kid'],
    type: 'programming',
    aliases: ['xml+genshi', 'xml+kid']
  },
  elm: {
    extensions: ['.elm'],
    type: 'programming'
  },
  swig: {
    extensions: ['.i'],
    type: 'programming'
  },
  reason: {
    extensions: ['.re', '.rei'],
    type: 'programming'
  },
  processing: {
    extensions: ['.pde'],
    type: 'programming'
  },
  'common workflow language': {
    extensions: ['.cwl'],
    type: 'programming',
    aliases: ['cwl']
  },
  mustache: {
    extensions: ['.mustache'],
    type: 'markup'
  },
  'asp.net': {
    extensions: ['.asax', '.ascx', '.ashx', '.asmx', '.aspx', '.axd'],
    type: 'programming',
    aliases: ['aspx', 'aspx-vb']
  },
  rexx: {
    extensions: ['.rexx', '.pprx', '.rex'],
    type: 'programming',
    aliases: ['arexx']
  },
  lsl: {
    extensions: ['.lsl', '.lslp'],
    type: 'programming'
  },
  'pov-ray sdl': {
    extensions: ['.pov', '.inc'],
    type: 'programming',
    aliases: ['pov-ray', 'povray']
  },
  pep8: {
    extensions: ['.pep'],
    type: 'programming'
  },
  'ags script': {
    extensions: ['.asc', '.ash'],
    type: 'programming',
    aliases: ['ags']
  },
  dockerfile: {
    extensions: ['.dockerfile', '.containerfile'],
    type: 'programming',
    aliases: ['Containerfile']
  },
  muf: {
    extensions: ['.muf', '.m'],
    type: 'programming'
  },
  javascript: {
    extensions: [
      '.js',
      '._js',
      '.bones',
      '.cjs',
      '.es',
      '.es6',
      '.frag',
      '.gs',
      '.jake',
      '.javascript',
      '.jsb',
      '.jscad',
      '.jsfl',
      '.jslib',
      '.jsm',
      '.jspre',
      '.jss',
      '.jsx',
      '.mjs',
      '.njs',
      '.pac',
      '.sjs',
      '.ssjs',
      '.xsjs',
      '.xsjslib'
    ],
    type: 'programming',
    aliases: ['js', 'node']
  },
  'type language': {
    extensions: ['.tl'],
    type: 'data',
    aliases: ['tl']
  },
  runoff: {
    extensions: ['.rnh', '.rno'],
    type: 'markup'
  },
  wdl: {
    extensions: ['.wdl'],
    type: 'programming',
    aliases: ['Workflow Description Language']
  },
  blitzbasic: {
    extensions: ['.bb', '.decls'],
    type: 'programming',
    aliases: ['b3d', 'blitz3d', 'blitzplus', 'bplus']
  },
  actionscript: {
    extensions: ['.as'],
    type: 'programming',
    aliases: ['actionscript 3', 'actionscript3', 'as3']
  },
  pic: {
    extensions: ['.pic', '.chem'],
    type: 'markup',
    aliases: ['pikchr']
  },
  xbase: {
    extensions: ['.prg', '.ch', '.prw'],
    type: 'programming',
    aliases: ['advpl', 'clipper', 'foxpro']
  },
  sed: {
    extensions: ['.sed'],
    type: 'programming'
  },
  'gettext catalog': {
    extensions: ['.po', '.pot'],
    type: 'prose',
    aliases: ['pot']
  },
  cool: {
    extensions: ['.cl'],
    type: 'programming'
  },
  'java server pages': {
    extensions: ['.jsp', '.tag'],
    type: 'programming',
    aliases: ['jsp']
  },
  ocaml: {
    extensions: ['.ml', '.eliom', '.eliomi', '.ml4', '.mli', '.mll', '.mly'],
    type: 'programming'
  },
  bison: {
    extensions: ['.bison'],
    type: 'programming'
  },
  stylus: {
    extensions: ['.styl'],
    type: 'markup'
  },
  click: {
    extensions: ['.click'],
    type: 'programming'
  },
  marko: {
    extensions: ['.marko'],
    type: 'markup',
    aliases: ['markojs']
  },
  clips: {
    extensions: ['.clp'],
    type: 'programming'
  },
  wollok: {
    extensions: ['.wlk'],
    type: 'programming'
  },
  sqf: {
    extensions: ['.sqf', '.hqf'],
    type: 'programming'
  },
  al: {
    extensions: ['.al'],
    type: 'programming'
  },
  alloy: {
    extensions: ['.als'],
    type: 'programming'
  },
  futhark: {
    extensions: ['.fut'],
    type: 'programming'
  },
  shell: {
    extensions: [
      '.sh',
      '.bash',
      '.bats',
      '.cgi',
      '.command',
      '.fcgi',
      '.ksh',
      '.sh.in',
      '.tmux',
      '.tool',
      '.trigger',
      '.zsh',
      '.zsh-theme'
    ],
    type: 'programming',
    aliases: ['sh', 'shell-script', 'bash', 'zsh', 'envrc']
  },
  codeql: {
    extensions: ['.ql', '.qll'],
    type: 'programming',
    aliases: ['ql']
  },
  'motorola 68k assembly': {
    extensions: ['.asm', '.i', '.inc', '.s', '.x68'],
    type: 'programming',
    aliases: ['m68k']
  },
  postcss: {
    extensions: ['.pcss', '.postcss'],
    type: 'markup'
  },
  xs: {
    extensions: ['.xs'],
    type: 'programming'
  },
  pascal: {
    extensions: ['.pas', '.dfm', '.dpr', '.inc', '.lpr', '.pascal', '.pp'],
    type: 'programming',
    aliases: ['delphi', 'objectpascal']
  },
  'html+php': {
    extensions: ['.phtml'],
    type: 'markup'
  },
  bitbake: {
    extensions: ['.bb', '.bbappend', '.bbclass', '.inc'],
    type: 'programming'
  },
  'kicad schematic': {
    extensions: ['.kicad_sch', '.kicad_sym', '.sch'],
    type: 'data',
    aliases: ['eeschema schematic']
  },
  'mirc script': {
    extensions: ['.mrc'],
    type: 'programming'
  },
  emberscript: {
    extensions: ['.em', '.emberscript'],
    type: 'programming'
  },
  oxygene: {
    extensions: ['.oxygene'],
    type: 'programming'
  },
  awk: {
    extensions: ['.awk', '.auk', '.gawk', '.mawk', '.nawk'],
    type: 'programming'
  },
  jinja: {
    extensions: ['.jinja', '.j2', '.jinja2'],
    type: 'markup',
    aliases: ['django', 'html+django', 'html+jinja', 'htmldjango']
  },
  augeas: {
    extensions: ['.aug'],
    type: 'programming'
  },
  webidl: {
    extensions: ['.webidl'],
    type: 'programming'
  },
  'opentype feature file': {
    extensions: ['.fea'],
    type: 'data',
    aliases: ['AFDKO']
  },
  'emacs lisp': {
    extensions: ['.el', '.emacs', '.emacs.desktop'],
    type: 'programming',
    aliases: ['elisp', 'emacs']
  },
  'gentoo eclass': {
    extensions: ['.eclass'],
    type: 'programming'
  },
  pony: {
    extensions: ['.pony'],
    type: 'programming'
  },
  chapel: {
    extensions: ['.chpl'],
    type: 'programming',
    aliases: ['chpl']
  },
  ats: {
    extensions: ['.dats', '.hats', '.sats'],
    type: 'programming',
    aliases: ['ats2']
  },
  'git config': {
    extensions: ['.gitconfig'],
    type: 'data',
    aliases: ['gitconfig', 'gitmodules']
  },
  'd-objdump': {
    extensions: ['.d-objdump'],
    type: 'data'
  },
  hxml: {
    extensions: ['.hxml'],
    type: 'data'
  },
  'dns zone': {
    extensions: ['.zone', '.arpa'],
    type: 'data'
  },
  handlebars: {
    extensions: ['.handlebars', '.hbs'],
    type: 'markup',
    aliases: ['hbs', 'htmlbars']
  },
  sieve: {
    extensions: ['.sieve'],
    type: 'programming'
  },
  sugarss: {
    extensions: ['.sss'],
    type: 'markup'
  },
  'csound document': {
    extensions: ['.csd'],
    type: 'programming',
    aliases: ['csound-csd']
  },
  tsv: {
    extensions: ['.tsv', '.vcf'],
    type: 'data',
    aliases: ['tab-seperated values']
  },
  jasmin: {
    extensions: ['.j'],
    type: 'programming'
  },
  'linux kernel module': {
    extensions: ['.mod'],
    type: 'data'
  },
  supercollider: {
    extensions: ['.sc', '.scd'],
    type: 'programming'
  },
  'x bitmap': {
    extensions: ['.xbm'],
    type: 'data',
    aliases: ['xbm']
  },
  opencl: {
    extensions: ['.cl', '.opencl'],
    type: 'programming'
  },
  'literate haskell': {
    extensions: ['.lhs'],
    type: 'programming',
    aliases: ['lhaskell', 'lhs']
  },
  html: {
    extensions: ['.html', '.hta', '.htm', '.html.hl', '.inc', '.xht', '.xhtml'],
    type: 'markup',
    aliases: ['xhtml']
  },
  typescript: {
    extensions: ['.ts', '.cts', '.mts'],
    type: 'programming',
    aliases: ['ts']
  },
  smalltalk: {
    extensions: ['.st', '.cs'],
    type: 'programming',
    aliases: ['squeak']
  },
  cson: {
    extensions: ['.cson'],
    type: 'data'
  },
  riot: {
    extensions: ['.riot'],
    type: 'markup'
  },
  solidity: {
    extensions: ['.sol'],
    type: 'programming'
  },
  volt: {
    extensions: ['.volt'],
    type: 'programming'
  },
  lex: {
    extensions: ['.l', '.lex'],
    type: 'programming',
    aliases: ['flex']
  },
  'inform 7': {
    extensions: ['.ni', '.i7x'],
    type: 'programming',
    aliases: ['i7', 'inform7']
  },
  yaml: {
    extensions: [
      '.yml',
      '.mir',
      '.reek',
      '.rviz',
      '.sublime-syntax',
      '.syntax',
      '.yaml',
      '.yaml-tmlanguage',
      '.yaml.sed',
      '.yml.mysql'
    ],
    type: 'data',
    aliases: ['yml']
  },
  'avro idl': {
    extensions: ['.avdl'],
    type: 'data'
  },
  omgrofl: {
    extensions: ['.omgrofl'],
    type: 'programming'
  },
  kit: {
    extensions: ['.kit'],
    type: 'markup'
  },
  'modula-3': {
    extensions: ['.i3', '.ig', '.m3', '.mg'],
    type: 'programming'
  },
  xquery: {
    extensions: ['.xquery', '.xq', '.xql', '.xqm', '.xqy'],
    type: 'programming'
  },
  nu: {
    extensions: ['.nu'],
    type: 'programming',
    aliases: ['nush']
  },
  lasso: {
    extensions: ['.lasso', '.las', '.lasso8', '.lasso9'],
    type: 'programming',
    aliases: ['lassoscript']
  },
  openscad: {
    extensions: ['.scad'],
    type: 'programming'
  },
  vala: {
    extensions: ['.vala', '.vapi'],
    type: 'programming'
  },
  lookml: {
    extensions: ['.lkml', '.lookml'],
    type: 'programming'
  },
  hyphy: {
    extensions: ['.bf'],
    type: 'programming'
  },
  openqasm: {
    extensions: ['.qasm'],
    type: 'programming'
  },
  'wavefront material': {
    extensions: ['.mtl'],
    type: 'data'
  },
  'linker script': {
    extensions: ['.ld', '.lds', '.x'],
    type: 'programming'
  },
  nl: {
    extensions: ['.nl'],
    type: 'data'
  },
  dogescript: {
    extensions: ['.djs'],
    type: 'programming'
  },
  'adobe font metrics': {
    extensions: ['.afm'],
    type: 'data',
    aliases: ['acfm', 'adobe composite font metrics', 'adobe multiple font metrics', 'amfm']
  },
  'gerber image': {
    extensions: [
      '.gbr',
      '.cmp',
      '.gbl',
      '.gbo',
      '.gbp',
      '.gbs',
      '.gko',
      '.gml',
      '.gpb',
      '.gpt',
      '.gtl',
      '.gto',
      '.gtp',
      '.gts',
      '.ncl',
      '.sol'
    ],
    type: 'data',
    aliases: ['rs-274x']
  },
  nit: {
    extensions: ['.nit'],
    type: 'programming'
  },
  'grammatical framework': {
    extensions: ['.gf'],
    type: 'programming',
    aliases: ['gf']
  },
  pan: {
    extensions: ['.pan'],
    type: 'programming'
  },
  self: {
    extensions: ['.self'],
    type: 'programming'
  },
  purescript: {
    extensions: ['.purs'],
    type: 'programming'
  },
  latte: {
    extensions: ['.latte'],
    type: 'markup'
  },
  blade: {
    extensions: ['.blade', '.blade.php'],
    type: 'markup'
  },
  lolcode: {
    extensions: ['.lol'],
    type: 'programming'
  },
  'coldfusion cfc': {
    extensions: ['.cfc'],
    type: 'programming',
    aliases: ['cfc']
  },
  mql5: {
    extensions: ['.mq5', '.mqh'],
    type: 'programming'
  },
  'wavefront object': {
    extensions: ['.obj'],
    type: 'data'
  },
  cuda: {
    extensions: ['.cu', '.cuh'],
    type: 'programming'
  },
  smpl: {
    extensions: ['.cocci'],
    type: 'programming',
    aliases: ['coccinelle']
  },
  crystal: {
    extensions: ['.cr'],
    type: 'programming'
  },
  'netlinx+erb': {
    extensions: ['.axs.erb', '.axi.erb'],
    type: 'programming'
  },
  xtend: {
    extensions: ['.xtend'],
    type: 'programming'
  },
  mcfunction: {
    extensions: ['.mcfunction'],
    type: 'programming'
  },
  'f#': {
    extensions: ['.fs', '.fsi', '.fsx'],
    type: 'programming',
    aliases: ['fsharp']
  },
  gdscript: {
    extensions: ['.gd'],
    type: 'programming'
  },
  dtrace: {
    extensions: ['.d'],
    type: 'programming',
    aliases: ['dtrace-script']
  },
  gap: {
    extensions: ['.g', '.gap', '.gd', '.gi', '.tst'],
    type: 'programming'
  },
  oz: {
    extensions: ['.oz'],
    type: 'programming'
  },
  "ren'py": {
    extensions: ['.rpy'],
    type: 'programming',
    aliases: ['renpy']
  },
  elixir: {
    extensions: ['.ex', '.exs'],
    type: 'programming'
  },
  webassembly: {
    extensions: ['.wast', '.wat'],
    type: 'programming',
    aliases: ['wast', 'wasm']
  },
  lean: {
    extensions: ['.lean', '.hlean'],
    type: 'programming'
  },
  lilypond: {
    extensions: ['.ly', '.ily'],
    type: 'programming'
  },
  squirrel: {
    extensions: ['.nut'],
    type: 'programming'
  },
  asciidoc: {
    extensions: ['.asciidoc', '.adoc', '.asc'],
    type: 'prose'
  },
  yacc: {
    extensions: ['.y', '.yacc', '.yy'],
    type: 'programming'
  },
  'filebench wml': {
    extensions: ['.f'],
    type: 'programming'
  },
  dafny: {
    extensions: ['.dfy'],
    type: 'programming'
  },
  plpgsql: {
    extensions: ['.pgsql', '.sql'],
    type: 'programming'
  },
  'parrot assembly': {
    extensions: ['.pasm'],
    type: 'programming',
    aliases: ['pasm']
  },
  kakounescript: {
    extensions: ['.kak'],
    type: 'programming',
    aliases: ['kak', 'kakscript']
  },
  raku: {
    extensions: [
      '.6pl',
      '.6pm',
      '.nqp',
      '.p6',
      '.p6l',
      '.p6m',
      '.pl',
      '.pl6',
      '.pm',
      '.pm6',
      '.raku',
      '.rakumod',
      '.t'
    ],
    type: 'programming',
    aliases: ['perl6', 'perl-6']
  },
  stata: {
    extensions: ['.do', '.ado', '.doh', '.ihlp', '.mata', '.matah', '.sthlp'],
    type: 'programming'
  },
  'c++': {
    extensions: [
      '.cpp',
      '.c++',
      '.cc',
      '.cp',
      '.cppm',
      '.cxx',
      '.h',
      '.h++',
      '.hh',
      '.hpp',
      '.hxx',
      '.inc',
      '.inl',
      '.ino',
      '.ipp',
      '.ixx',
      '.re',
      '.tcc',
      '.tpp',
      '.txx'
    ],
    type: 'programming',
    aliases: ['cpp']
  },
  holyc: {
    extensions: ['.hc'],
    type: 'programming'
  },
  mercury: {
    extensions: ['.m', '.moo'],
    type: 'programming'
  },
  'unity3d asset': {
    extensions: ['.anim', '.asset', '.mask', '.mat', '.meta', '.prefab', '.unity'],
    type: 'data'
  },
  'json with comments': {
    extensions: [
      '.jsonc',
      '.code-snippets',
      '.code-workspace',
      '.sublime-build',
      '.sublime-color-scheme',
      '.sublime-commands',
      '.sublime-completions',
      '.sublime-keymap',
      '.sublime-macro',
      '.sublime-menu',
      '.sublime-mousemap',
      '.sublime-project',
      '.sublime-settings',
      '.sublime-theme',
      '.sublime-workspace',
      '.sublime_metrics',
      '.sublime_session'
    ],
    type: 'data',
    aliases: ['jsonc']
  },
  abnf: {
    extensions: ['.abnf'],
    type: 'data'
  },
  perl: {
    extensions: ['.pl', '.al', '.cgi', '.fcgi', '.perl', '.ph', '.plx', '.pm', '.psgi', '.t'],
    type: 'programming',
    aliases: ['cperl']
  },
  graphql: {
    extensions: ['.graphql', '.gql', '.graphqls'],
    type: 'data'
  },
  d: {
    extensions: ['.d', '.di'],
    type: 'programming',
    aliases: ['Dlang']
  },
  m: {
    extensions: ['.mumps', '.m'],
    type: 'programming',
    aliases: ['mumps']
  },
  terra: {
    extensions: ['.t'],
    type: 'programming'
  },
  jflex: {
    extensions: ['.flex', '.jflex'],
    type: 'programming'
  },
  cycript: {
    extensions: ['.cy'],
    type: 'programming'
  }
}
