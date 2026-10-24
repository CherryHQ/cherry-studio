import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const manifest = JSON.parse(read('../../package.json')) as Record<string, Record<string, unknown> | undefined>
const lockfile = read('../../../../pnpm-lock.yaml')

/** Runtime dependency names of one importer in pnpm-lock.yaml (v9 layout: two-space importer, four-space section). */
function importerDependencies(importer: string): string[] {
  const lines = lockfile.split('\n')
  const start = lines.indexOf(`  ${importer}:`)
  if (start < 0) throw new Error(`${importer} is not in pnpm-lock.yaml`)
  const names: string[] = []
  let inDependencies = false
  for (const line of lines.slice(start + 1)) {
    if (line === '' || /^ {2}\S/.test(line)) break
    if (/^ {4}\S/.test(line)) inDependencies = line === '    dependencies:'
    else if (inDependencies && /^ {6}\S/.test(line))
      names.push(
        line
          .trim()
          .replace(/:$/, '')
          .replace(/^'(.*)'$/, '$1')
      )
  }
  return names
}

describe('package boundary', () => {
  // Catches a runtime dependency (Pi, a logger, an AI SDK) or a peer slipping into a package that must stay harness-neutral.
  it('depends at runtime only on @cherrystudio/agent-runtime', () => {
    expect(Object.keys(manifest.dependencies ?? {})).toEqual(['@cherrystudio/agent-runtime'])
    expect(manifest.peerDependencies).toBeUndefined()
    expect(manifest.optionalDependencies).toBeUndefined()
  })

  // Catches the lockfile closure growing behind package.json (a workspace dep that itself pulls in runtime code).
  it('has a lockfile closure of agent-runtime alone', () => {
    expect(importerDependencies('packages/agent-behavior')).toEqual(['@cherrystudio/agent-runtime'])
    expect(importerDependencies('packages/agent-runtime')).toEqual([])
  })

  // Catches a second entry point (e.g. "./testing", §15 Q6) that would let adapters bypass the sealed barrel.
  it('exports only "."', () => {
    expect(Object.keys(manifest.exports ?? {})).toEqual(['.'])
  })
})
