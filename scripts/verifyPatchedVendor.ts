import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import type { Plugin } from 'vite'

import { parse } from 'yaml'

/**
 * Fails the build when a patched dependency is bundled WITHOUT its patch.
 *
 * v2.0.8 shipped a bundle whose vendored `@ai-sdk/openai-compatible` carried
 * neither #18121 nor #18702, although both patch files were correct in the tag
 * (#19116): the release build was produced from unpatched `node_modules`, and
 * nothing between `pnpm install` and packaging compares the emitted chunks
 * against the patches. This guard closes that gap at the only point where the
 * truth exists — the generated bundle itself.
 *
 * For every `patchedDependencies` entry in pnpm-workspace.yaml it:
 *
 *  1. extracts marker candidates from the patch's ADDED lines (string literals
 *     and long identifiers);
 *  2. in `generateBundle`, considers the dependency verified when any marker
 *     appears in any emitted chunk;
 *  3. otherwise decides whether the dependency is bundled at all by sampling
 *     long string literals from its installed `dist` — if the sampling strings
 *     are present but no patch marker is, the bundle was built from unpatched
 *     sources and the build FAILS; if the sampling strings are absent too, the
 *     dependency is simply not part of this build and the check passes.
 */

interface PatchedDependency {
  /** `name@version` as keyed by pnpm-workspace.yaml. */
  key: string
  /** Bare package name (without the version suffix). */
  name: string
  patchPath: string
  /** Minification-safe markers: string literals survive bundling. */
  literalMarkers: string[]
  /** Identifier markers: survive only in unminified output. */
  identifierMarkers: string[]
}

const SAMPLE_COUNT = 5

export function extractMarkers(patchText: string): { literals: string[]; identifiers: string[] } {
  const literals = new Set<string>()
  const identifiers = new Set<string>()
  for (const rawLine of patchText.split('\n')) {
    if (!rawLine.startsWith('+') || rawLine.startsWith('+++')) continue
    const line = rawLine.slice(1)
    const trimmed = line.trim()
    // Comment-only additions (a patch may merely comment code out) carry no
    // runtime footprint — identifiers lifted from them would be false markers.
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue
    for (const [, , literal] of line.matchAll(/(['"`])([^'"`\n]{10,})\1/g)) {
      // Only message-like literals survive bundling verbatim and identify the
      // patch: module specifiers are rewritten, template fragments and code
      // interleavings never appear as-is in minified output.
      if (/^[\w .:-]{10,}$/.test(literal)) {
        literals.add(literal)
      }
    }
    for (const [, identifier] of line.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]{9,})\b/g)) {
      identifiers.add(identifier)
    }
  }
  return { literals: [...literals], identifiers: [...identifiers] }
}

function resolveWorkspaceRoot(startDir: string): string {
  let dir = startDir
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return startDir
}

export function loadPatchedDependencies(rootDir: string): PatchedDependency[] {
  const workspacePath = join(rootDir, 'pnpm-workspace.yaml')
  if (!existsSync(workspacePath)) return []
  const workspace = parse(readFileSync(workspacePath, 'utf8')) as {
    patchedDependencies?: Record<string, string>
  }
  const patched = workspace.patchedDependencies ?? {}
  const result: PatchedDependency[] = []
  for (const [key, patchPath] of Object.entries(patched)) {
    if (typeof patchPath !== 'string') continue
    const absolutePatch = join(rootDir, patchPath)
    if (!existsSync(absolutePatch)) continue
    const markers = extractMarkers(readFileSync(absolutePatch, 'utf8'))
    result.push({
      key,
      name: key.split('@')[0] === '' ? `@${key.split('@').slice(1, -1).join('@')}` : key.split('@')[0],
      patchPath: absolutePatch,
      literalMarkers: markers.literals,
      identifierMarkers: markers.identifiers
    })
  }
  return result
}

/**
 * Long string literals sampled from the dependency's installed output: their
 * presence in the bundle is the "this dependency is bundled" signal.
 */
function sampleDistLiterals(nodeModulesDir: string, name: string): string[] {
  const require = createRequire(join(nodeModulesDir, 'noop.js'))
  let entry: string
  try {
    entry = require.resolve(name)
  } catch {
    return []
  }
  const literals: string[] = []
  const collect = (file: string): void => {
    if (literals.length >= 40) return
    if (!file.endsWith('.js') && !file.endsWith('.cjs') && !file.endsWith('.mjs')) return
    if (!existsSync(file) || !statSync(file).isFile()) return
    const text = readFileSync(file, 'utf8')
    const DIST_LITERAL_RE = /(['"])([^'"\n]{8,})\1/g
    for (const [, , literal] of text.matchAll(DIST_LITERAL_RE)) {
      literals.push(literal)
    }
  }
  collect(entry)
  const distDir = join(dirname(entry))
  if (existsSync(distDir)) {
    for (const file of readdirSync(distDir)) {
      collect(join(distDir, file))
    }
  }
  const unique = [...new Set(literals)]
  unique.sort((a, b) => b.length - a.length)
  return unique.slice(0, SAMPLE_COUNT * 4)
}

export function patchedVendorGuardPlugin(options: { rootDir?: string } = {}): Plugin {
  const rootDir = options.rootDir ?? resolveWorkspaceRoot(process.cwd())
  const patched = loadPatchedDependencies(rootDir)
  const nodeModulesDir = join(rootDir, 'node_modules')

  return {
    name: 'cherry-patched-vendor-guard',
    generateBundle(_options, bundle) {
      let bundleText = ''
      for (const output of Object.values(bundle)) {
        if (output.type === 'chunk') bundleText += '\n' + output.code
      }

      const failures: string[] = []
      for (const dep of patched) {
        // Literal markers survive minification; when a patch adds any, they are
        // the contract. Identifier-only patches (e.g. commenting code out) can
        // only be checked in unminified output — degrade to a warning instead
        // of blocking the release on something unverifiable.
        const primary = dep.literalMarkers.length > 0 ? dep.literalMarkers : dep.identifierMarkers
        const literalBacked = dep.literalMarkers.length > 0
        if (primary.length === 0) continue
        if (primary.some((marker) => bundleText.includes(marker))) continue

        const samples = sampleDistLiterals(nodeModulesDir, dep.name)
        if (samples.length === 0) continue
        const bundled = samples.filter((sample) => bundleText.includes(sample)).length >= 2
        if (bundled && literalBacked) {
          failures.push(
            `${dep.key} is bundled without its patch (${dep.patchPath}): none of ${dep.literalMarkers.length} patch markers found in the emitted chunks (#19116 failure mode — run pnpm install and rebuild)`
          )
        } else if (bundled) {
          this.warn(
            `${dep.key} is bundled and its patch adds no string-literal markers, so its application cannot be verified in minified output (${dep.patchPath})`
          )
        }
      }

      if (failures.length > 0) {
        this.error(`Patched vendor check failed:\n  ${failures.join('\n  ')}`)
      }
    }
  }
}
