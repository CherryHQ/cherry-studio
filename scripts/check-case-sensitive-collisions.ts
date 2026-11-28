import { execFileSync } from 'node:child_process'

// Extensions TypeScript probes when resolving an extensionless import. Two
// files in one directory that share a case-insensitive stem with extensions
// from this set can resolve differently on case-sensitive (Linux) versus
// case-insensitive (Windows/macOS) filesystems. That is exactly what broke the
// Windows typecheck in #23890: `agent/PlanModeHint.tsx` (component) and
// `agent/planModeHint.ts` (hook) are distinct files on Linux, but resolving
// `./agent/PlanModeHint` on Windows matched the hook through the `.ts` probe
// and failed with "has no exported member named 'PlanModeHint'".
const TYPESCRIPT_RESOLVABLE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.d.ts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs'
])

function splitExtension(basename: string): { extension: string; stem: string } {
  const lower = basename.toLowerCase()
  if (lower.endsWith('.d.ts')) return { extension: '.d.ts', stem: basename.slice(0, -5) }
  const dot = basename.lastIndexOf('.')
  if (dot <= 0) return { extension: '', stem: basename }
  return { extension: basename.slice(dot).toLowerCase(), stem: basename.slice(0, dot) }
}

function stemOf(file: string): string {
  const basename = file.slice(file.lastIndexOf('/') + 1)
  return splitExtension(basename).stem
}

/**
 * Finds same-directory file groups whose TypeScript-resolvable stems collide
 * only by letter case (for example `PlanModeHint.tsx` and `planModeHint.ts`).
 * Pairs with byte-identical stems (for example `UsageSettings.test.ts` and
 * `UsageSettings.test.tsx`) resolve deterministically by extension priority on
 * every filesystem and are not reported.
 */
export function findCaseOnlyStemCollisions(files: readonly string[]): string[][] {
  const groups = new Map<string, string[]>()
  for (const file of files) {
    const slash = file.lastIndexOf('/')
    const directory = slash < 0 ? '' : file.slice(0, slash)
    const basename = slash < 0 ? file : file.slice(slash + 1)
    const { extension, stem } = splitExtension(basename)
    if (!TYPESCRIPT_RESOLVABLE_EXTENSIONS.has(extension)) continue
    const key = `${directory}/${stem.toLowerCase()}`
    const group = groups.get(key)
    if (group) group.push(file)
    else groups.set(key, [file])
  }
  return [...groups.values()].filter((group) => new Set(group.map(stemOf)).size > 1)
}

function main(): void {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)
  const collisions = findCaseOnlyStemCollisions(files)
  if (collisions.length === 0) {
    console.log(`check:case-collisions passed (${files.length} tracked files)`)
    return
  }
  console.error('check:case-collisions failed: TypeScript-resolvable stems collide by letter case.')
  console.error('On Windows/macOS these resolve to one file; on Linux they resolve to another (see #23890).')
  for (const group of collisions) {
    for (const file of group.sort()) console.error(`- ${file}`)
  }
  process.exit(1)
}

main()
