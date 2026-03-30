/**
 * Maps a file path to a material-icon-theme icon name.
 * Used with @iconify/react: <Icon icon={`material-icon-theme:${getFileIconName(path)}`} />
 */

/** Exact filename → icon name */
const filenameMap: Record<string, string> = {
  dockerfile: 'docker',
  'docker-compose.yml': 'docker',
  'docker-compose.yaml': 'docker',
  '.dockerignore': 'docker',
  '.gitignore': 'git',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  'package.json': 'nodejs',
  'package-lock.json': 'nodejs',
  'tsconfig.json': 'tsconfig',
  'jsconfig.json': 'jsconfig',
  '.eslintrc': 'eslint',
  '.eslintrc.js': 'eslint',
  '.eslintrc.json': 'eslint',
  'eslint.config.js': 'eslint',
  'eslint.config.mjs': 'eslint',
  'eslint.config.ts': 'eslint',
  '.prettierrc': 'prettier',
  '.prettierrc.json': 'prettier',
  'prettier.config.js': 'prettier',
  'biome.json': 'biome',
  'biome.jsonc': 'biome',
  'vite.config.ts': 'vite',
  'vite.config.js': 'vite',
  'vite.config.mts': 'vite',
  'vitest.config.ts': 'vitest',
  'vitest.config.js': 'vitest',
  'webpack.config.js': 'webpack',
  'webpack.config.ts': 'webpack',
  'rollup.config.js': 'rollup',
  'rollup.config.ts': 'rollup',
  'next.config.js': 'next',
  'next.config.mjs': 'next',
  'next.config.ts': 'next',
  'nuxt.config.ts': 'nuxt',
  'svelte.config.js': 'svelte',
  'tailwind.config.js': 'tailwindcss',
  'tailwind.config.ts': 'tailwindcss',
  'postcss.config.js': 'postcss',
  'postcss.config.cjs': 'postcss',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
  'pnpm-workspace.yaml': 'pnpm',
  'bun.lock': 'bun',
  'bun.lockb': 'bun',
  'deno.json': 'deno',
  'deno.jsonc': 'deno',
  makefile: 'makefile',
  Makefile: 'makefile',
  'CMakeLists.txt': 'cmake',
  'Cargo.toml': 'rust',
  'Cargo.lock': 'rust',
  'go.mod': 'go-mod',
  'go.sum': 'go-mod',
  Gemfile: 'gemfile',
  Rakefile: 'ruby',
  LICENSE: 'license',
  'LICENSE.md': 'license',
  'CHANGELOG.md': 'changelog',
  'README.md': 'readme',
  '.env': 'tune',
  '.env.local': 'tune',
  '.env.development': 'tune',
  '.env.production': 'tune'
}

/** File extension → icon name */
const extensionMap: Record<string, string> = {
  // JavaScript / TypeScript
  ts: 'typescript',
  tsx: 'react-ts',
  js: 'javascript',
  jsx: 'react',
  mjs: 'javascript',
  cjs: 'javascript',
  mts: 'typescript',
  cts: 'typescript',
  'd.ts': 'typescript-def',

  // Web
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'sass',
  sass: 'sass',
  less: 'less',
  styl: 'stylus',
  vue: 'vue',
  svelte: 'svelte',
  astro: 'astro',

  // Data / Config
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  xml: 'xml',
  csv: 'csv',
  ini: 'settings',
  cfg: 'settings',
  conf: 'settings',
  env: 'tune',

  // Markup / Docs
  md: 'markdown',
  mdx: 'mdx',
  rst: 'readme',
  txt: 'document',
  pdf: 'pdf',
  tex: 'tex',
  latex: 'tex',

  // Systems languages
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  rs: 'rust',
  go: 'go',
  zig: 'zig',
  asm: 'assembly',
  s: 'assembly',
  wasm: 'wasm',

  // JVM
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  groovy: 'groovy',
  gradle: 'gradle',
  clj: 'clojure',

  // Scripting
  py: 'python',
  rb: 'ruby',
  php: 'php',
  pl: 'perl',
  pm: 'perl',
  lua: 'lua',
  r: 'r',
  R: 'r',
  jl: 'julia',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  lhs: 'haskell',
  ml: 'ocaml',
  mli: 'ocaml',
  fs: 'fsharp',
  fsx: 'fsharp',
  dart: 'dart',
  swift: 'swift',
  m: 'objective-c',
  mm: 'objective-cpp',
  cs: 'csharp',
  vb: 'visualbasic',

  // Shell
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  ps1: 'powershell',
  bat: 'windows',
  cmd: 'windows',

  // Database
  sql: 'database',
  sqlite: 'database',
  prisma: 'prisma',

  // DevOps / Infra
  tf: 'terraform',
  hcl: 'hcl',
  proto: 'proto',
  graphql: 'graphql',
  gql: 'graphql',

  // Images
  svg: 'svg',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  ico: 'image',
  bmp: 'image',

  // Media
  mp3: 'audio',
  wav: 'audio',
  ogg: 'audio',
  flac: 'audio',
  mp4: 'video',
  avi: 'video',
  mkv: 'video',
  mov: 'video',
  webm: 'video',

  // Archives
  zip: 'zip',
  tar: 'zip',
  gz: 'zip',
  bz2: 'zip',
  xz: 'zip',
  '7z': 'zip',
  rar: 'zip',

  // Misc
  lock: 'lock',
  log: 'log',
  diff: 'diff',
  patch: 'diff',
  woff: 'font',
  woff2: 'font',
  ttf: 'font',
  otf: 'font',
  eot: 'font',
  ipynb: 'jupyter'
}

const DEFAULT_ICON = 'document'

export function getFileIconName(filePath: string): string {
  if (!filePath) return DEFAULT_ICON

  const filename = filePath.split('/').pop() ?? ''
  const lowerFilename = filename.toLowerCase()

  // Check exact filename match first
  if (filenameMap[filename]) return filenameMap[filename]
  if (filenameMap[lowerFilename]) return filenameMap[lowerFilename]

  // Check compound extensions (e.g. .d.ts, .spec.ts)
  const parts = filename.split('.')
  if (parts.length > 2) {
    const compoundExt = parts.slice(-2).join('.')
    if (extensionMap[compoundExt]) return extensionMap[compoundExt]
  }

  // Check simple extension
  const ext = parts.pop()?.toLowerCase()
  if (ext && extensionMap[ext]) return extensionMap[ext]

  return DEFAULT_ICON
}
