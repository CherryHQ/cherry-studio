import type { Lang } from '@pierre/highlights'
import { themes } from '@pierre/highlights/themes/loader'

// Highlights 0.2 exposes language types but no public runtime catalog.
export const CODE_LANGUAGES = {
  text: ['plain', 'plaintext', 'txt'],
  'angular-html': [],
  asm: ['assembly', 's'],
  astro: [],
  bash: ['sh', 'shell', 'shellscript', 'shellsession', 'zsh'],
  bat: ['batch', 'batchfile', 'cmd', 'dos'],
  c: ['h'],
  c3: [],
  clojure: ['clj', 'cljc', 'cljs', 'edn'],
  cmake: [],
  cpp: ['c++', 'cc', 'cxx', 'hh', 'hpp', 'hxx'],
  csharp: ['c#', 'cs'],
  css: [],
  cuda: ['cu', 'cuh'],
  dart: [],
  diff: ['git-commit', 'git-rebase', 'patch'],
  dockerfile: ['containerfile', 'docker'],
  elixir: ['ex', 'exs'],
  elm: [],
  erlang: ['erl', 'hrl'],
  'fortran-free-form': ['f03', 'f08', 'f90', 'f95', 'fortran'],
  'fortran-fixed-form': ['f', 'f77', 'for'],
  fsharp: ['f#', 'fs', 'fsi', 'fsx'],
  gdresource: ['godot-resource', 'tres', 'tscn'],
  gdscript: ['gd'],
  gdshader: ['gdshaderinc', 'godot-shader'],
  gleam: [],
  glsl: ['comp', 'frag', 'geom', 'vert'],
  go: ['golang'],
  graphql: ['gql'],
  groovy: ['gradle', 'gsh', 'gvy', 'gy'],
  haskell: ['hs'],
  hlsl: [],
  html: ['htm'],
  java: [],
  javascript: ['cjs', 'js', 'mjs'],
  json: ['jsonc'],
  json5: [],
  jsonl: [],
  jsx: [],
  julia: ['jl'],
  kotlin: ['kt', 'kts'],
  latex: ['tex'],
  less: [],
  lisp: ['cl', 'el', 'elisp', 'emacs-lisp', 'lsp', 'scheme', 'scm'],
  lua: [],
  makefile: ['make', 'mk'],
  markdown: ['md'],
  matlab: ['octave'],
  mdx: [],
  nim: [],
  nix: [],
  'objective-c': ['m', 'mm', 'objc', 'objcpp', 'objective-cpp', 'objectivec', 'objective-c++', 'obj-c++', 'objc++'],
  ocaml: ['ml', 'mli'],
  pascal: ['delphi', 'dpk', 'dpr', 'lpr', 'object-pascal', 'objectpascal', 'pas', 'pp'],
  perl: ['pl', 'pm'],
  php: [],
  powershell: ['ps', 'ps1', 'psd1', 'psm1', 'pwsh'],
  proto: ['protobuf'],
  python: ['py'],
  r: ['rscript'],
  ruby: ['rb'],
  rust: ['rs'],
  sass: [],
  scala: ['sbt', 'sc'],
  scss: [],
  solidity: ['sol'],
  sql: [],
  svelte: [],
  swift: [],
  terraform: ['hcl', 'tf', 'tfvars'],
  toml: [],
  typescript: ['angular-ts', 'cts', 'mts', 'ts'],
  tsrx: [],
  tsx: [],
  vue: [],
  wasm: ['wat'],
  wgsl: [],
  xml: ['svg', 'xsd'],
  yaml: ['yml'],
  zig: ['zon']
} satisfies Partial<Record<Lang, string[]>>

const aliases = new Map(
  Object.entries(CODE_LANGUAGES).flatMap(([name, values]) => [name, ...values].map((value) => [value, name]))
)
export const CODE_THEME_NAMES = Object.keys(themes)
export const DEFAULT_LANGUAGES = ['text', 'javascript', 'typescript', 'python', 'java', 'markdown', 'json']
export function normalizeCodeLanguage(language: string): string {
  const value = language.trim().toLowerCase()
  return aliases.get(value) ?? value
}
export function supportsCodeLanguage(language: string): boolean {
  return aliases.has(language.trim().toLowerCase())
}
export function resolveCodeTheme(name: string, fallback = 'one-light'): string {
  return name === 'cherry' || Object.hasOwn(themes, name) ? name : fallback
}
