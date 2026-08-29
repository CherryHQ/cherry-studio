// Boundary assertion: the reconciliation engine may import only the SHARED side of
// contributorTypes (entity-graph vocabulary), never the backup-lifecycle hook side
// (BackupContextBase / BackupPhase / RowTransformContext / ...). Documentation rots; this test
// goes red the moment someone lets the engine reach across that line.
//
// See ../README.md §2 for the four-segment boundary and the 16-symbol shared whitelist.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const PKG_DIR = dirname(fileURLToPath(import.meta.url)) // …/reconciliation/__tests__
const SRC_DIR = dirname(PKG_DIR) // …/reconciliation — scan this, excluding __tests__/

// The full shared-side export set of contributorTypes.ts (README §2, segments 1 + the shared
// entries of segment 3 + segment 4). Anything imported from contributorTypes that is NOT in this
// set is a backup-lifecycle hook type crossing the boundary.
const SHARED_WHITELIST = new Set([
  // Segment 1 (:20-192) — reference + identity classification
  'ReferenceKind',
  'IdentityClass',
  'JsonSoftRefKind',
  'EntityReference',
  'AggregateMember',
  'AggregateBoundary',
  'RowScope',
  'FileRefSourcePolicy',
  'JsonSoftReferencePolicy',
  'JsonEntityIdSelector',
  'OmittedReferenceOverride',
  'UniqueMergeRule',
  'FieldMergePolicy',
  // Segment 3 (:357-438) — the shared entries
  'EntityGraphSchema',
  'BackupContributorPolicy',
  // Segment 4 (:439-471)
  'ReadonlyBackupRegistry'
])

/** Source .ts files in the package (NOT __tests__/ — those are test fixtures). */
function listSourceFiles(directory: string = SRC_DIR): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(directory, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : listSourceFiles(fullPath)
    }
    return entry.name.endsWith('.ts') && entry.name !== 'index.ts' ? [fullPath] : []
  })
}

// Match named imports/re-exports from contributorTypes, regardless of whether they are type-only
// or multiline. Separate patterns also flag namespace/default imports as opaque violations: the
// test cannot prove that an opaque module import stays inside the shared whitelist.
const CONTRIBUTOR_TYPES_NAMED_IMPORT =
  /(?:import|export)\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]@main\/data\/db\/backup\/contributorTypes['"]/g
const CONTRIBUTOR_TYPES_NAMESPACE_IMPORT =
  /(?:import|export)\s+(?:type\s+)?\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]@main\/data\/db\/backup\/contributorTypes['"]/g
const CONTRIBUTOR_TYPES_DEFAULT_IMPORT =
  /import\s+(?:type\s+)?[A-Za-z_$][\w$]*(?:\s*,[^;\n]*)?\s+from\s*['"]@main\/data\/db\/backup\/contributorTypes['"]/g

/** Extract contributorTypes symbols, flagging opaque import forms as boundary violations. */
function extractContributorTypeImports(source: string): string[] {
  const symbols: string[] = []
  let match: RegExpExecArray | null

  CONTRIBUTOR_TYPES_NAMED_IMPORT.lastIndex = 0
  while ((match = CONTRIBUTOR_TYPES_NAMED_IMPORT.exec(source)) !== null) {
    // The captured group is the comma-separated symbol block. Strip line comments + block
    // comments, split on commas, and keep only the imported name (drop `as Alias`).
    const cleaned = match[1].replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const raw of cleaned.split(',')) {
      const name = raw.split(/\s+as\s+/)[0].trim()
      if (name) symbols.push(name)
    }
  }

  CONTRIBUTOR_TYPES_NAMESPACE_IMPORT.lastIndex = 0
  while ((match = CONTRIBUTOR_TYPES_NAMESPACE_IMPORT.exec(source)) !== null) {
    symbols.push(`* as ${match[1]}`)
  }

  CONTRIBUTOR_TYPES_DEFAULT_IMPORT.lastIndex = 0
  while (CONTRIBUTOR_TYPES_DEFAULT_IMPORT.exec(source) !== null) {
    symbols.push('<opaque default import>')
  }

  return symbols
}

describe('reconciliation ↔ contributorTypes boundary', () => {
  const files = listSourceFiles()

  it('scans at least the known source files (guard against a path-resolution regression)', () => {
    const names = files.map((f) => f.split('/').pop())
    // The six engine modules — if any is missing the test would pass vacuously.
    for (const expected of [
      'MergeEngine.ts',
      'types.ts',
      'ftsCentral.ts',
      'junctionDeriver.ts',
      'polymorphicAssociationDeriver.ts',
      'platformSpecificKeyMatch.ts'
    ]) {
      expect(names, `expected ${expected} in the scanned set`).toContain(expected)
    }
  })

  it('every contributorTypes import is inside the shared whitelist', () => {
    const violations: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const imported = extractContributorTypeImports(source)
      for (const symbol of imported) {
        if (!SHARED_WHITELIST.has(symbol)) {
          violations.push(`${file.split('/').pop()}: ${symbol}`)
        }
      }
    }
    // Fail with the exact offending symbols + files so the fix is obvious, not "1 assertion failed".
    expect(violations, `backup-lifecycle hook types leaked into the engine:\n${violations.join('\n')}`).toEqual([])
  })
})
