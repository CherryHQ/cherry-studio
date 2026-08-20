import type { Plugin } from 'vite'

/**
 * Fails the build when a chunk reads a binding its target chunk never exports.
 *
 * Rolldown can merge a re-export-only facade chunk into a real one and emit only the
 * facade's exports, so the importer resolves `undefined` at runtime with no build error.
 * That shipped a dead OpenAI provider in 2.0.6.
 */
export function chunkExportGuardPlugin(): Plugin {
  const REQUIRE_RE = /^const ([A-Za-z0-9_$]+) = require\("\.\/([^"]+)"\);$/gm
  const MEMBER_RE = /([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)/g
  const EXPORT_RE = /(?:exports\.([A-Za-z0-9_$]+)\s*=|Object\.defineProperty\(exports,\s*"([^"]+)")/g

  return {
    name: 'cherry-chunk-export-guard',
    generateBundle(_options, bundle) {
      const exportsOf = new Map<string, Set<string>>()
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') continue
        const names = new Set<string>()
        for (const [, assigned, defined] of output.code.matchAll(EXPORT_RE)) names.add(assigned ?? defined)
        exportsOf.set(fileName, names)
      }

      const broken = new Set<string>()
      for (const [fileName, output] of Object.entries(bundle)) {
        if (output.type !== 'chunk') continue
        const deps = new Map<string, string>()
        for (const [, local, dep] of output.code.matchAll(REQUIRE_RE)) deps.set(local, dep)
        for (const [, local, member] of output.code.matchAll(MEMBER_RE)) {
          const dep = deps.get(local)
          if (dep && !exportsOf.get(dep)?.has(member)) {
            broken.add(`${fileName} reads "${member}" from ${dep}, which does not export it`)
          }
        }
      }

      if (broken.size > 0) {
        this.error(`Broken cross-chunk imports:\n  ${[...broken].join('\n  ')}`)
      }
    }
  }
}
