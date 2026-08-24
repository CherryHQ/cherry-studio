/**
 * Blocks schema changes that break a downgrade: the previously released app still runs
 * against a migrated DB, so a dropped column, a tightened constraint or a new NOT NULL
 * column takes it down. Rules are derived from the released drizzle snapshot rather than
 * from annotations, so a table rebuild that silently omits a column is caught too.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const MIGRATIONS_DIR = path.join(ROOT, 'migrations/sqlite-drizzle')
const CONTRACT_PATH = path.join(ROOT, 'migrations/downgrade-contract.json')

export type ViolationKind =
  | 'table-removed'
  | 'column-removed'
  | 'notnull-tightened'
  | 'notnull-added'
  | 'default-removed'
  | 'check-changed'
  | 'unique-added'

export interface Violation {
  id: string
  kind: ViolationKind
  /** The constraint body a disposition is bound to, so a later edit of the same name needs a fresh review. */
  value?: string
  detail: string
}

/** A break we accept, landing in a future minor. Patch releases must stay downgrade-safe. */
interface ScheduledEntry {
  id: string
  kind: ViolationKind
  value?: string
  in: string
  reason: string
}

/** A rule hit reviewed as harmless for a downgrade (a widened CHECK, a table the old app never writes). */
interface AcknowledgedEntry {
  id: string
  kind: ViolationKind
  value?: string
  reason: string
}

export interface Contract {
  baseline: { version: string; snapshot: string }
  scheduled: ScheduledEntry[]
  acknowledged: AcknowledgedEntry[]
}

interface ColumnSnapshot {
  name: string
  notNull?: boolean
  default?: unknown
}

interface IndexSnapshot {
  isUnique?: boolean
  columns?: string[]
  where?: string
}

interface TableSnapshot {
  columns: Record<string, ColumnSnapshot>
  indexes?: Record<string, IndexSnapshot>
  uniqueConstraints?: Record<string, { columns?: string[] }>
  checkConstraints?: Record<string, { value: string }>
}

export interface Snapshot {
  tables: Record<string, TableSnapshot>
}

/** Unique name → what it actually enforces, so a same-named index that narrows is not mistaken for the old one. */
function uniqueFingerprints(table: TableSnapshot): Map<string, string> {
  const fingerprints = new Map<string, string>()
  for (const [name, constraint] of Object.entries(table.uniqueConstraints ?? {})) {
    fingerprints.set(name, (constraint.columns ?? []).join(','))
  }
  for (const [name, index] of Object.entries(table.indexes ?? {})) {
    if (!index.isUnique) continue
    fingerprints.set(name, `${(index.columns ?? []).join(',')}${index.where ? ` WHERE ${index.where}` : ''}`)
  }
  return fingerprints
}

export function getDowngradeViolations(baseline: Snapshot, head: Snapshot): Violation[] {
  const violations: Violation[] = []

  for (const [table, baseTable] of Object.entries(baseline.tables)) {
    const headTable = head.tables[table]
    if (!headTable) {
      violations.push({ id: table, kind: 'table-removed', detail: `table \`${table}\` is gone` })
      continue
    }

    for (const [column, baseColumn] of Object.entries(baseTable.columns)) {
      const headColumn = headTable.columns[column]
      if (!headColumn) {
        violations.push({
          id: `${table}.${column}`,
          kind: 'column-removed',
          detail: `column \`${table}.${column}\` is gone — the released app still SELECTs it`
        })
        continue
      }
      // No default escape hatch here: SQLite applies DEFAULT only when the column is
      // omitted, and the released app has this column in its schema so it writes NULL.
      if (!baseColumn.notNull && headColumn.notNull) {
        violations.push({
          id: `${table}.${column}`,
          kind: 'notnull-tightened',
          detail: `column \`${table}.${column}\` became NOT NULL — the released app writes NULL into it`
        })
      }
      if (baseColumn.notNull && baseColumn.default !== undefined && headColumn.default === undefined) {
        violations.push({
          id: `${table}.${column}`,
          kind: 'default-removed',
          detail: `column \`${table}.${column}\` lost its DB default — the released app omits it and hits NOT NULL`
        })
      }
    }

    for (const [column, headColumn] of Object.entries(headTable.columns)) {
      if (baseTable.columns[column]) continue
      if (headColumn.notNull && headColumn.default === undefined) {
        violations.push({
          id: `${table}.${column}`,
          kind: 'notnull-added',
          detail: `new NOT NULL column \`${table}.${column}\` has no default — the released app INSERTs without it`
        })
      }
    }

    const baseChecks = baseTable.checkConstraints ?? {}
    for (const [name, headCheck] of Object.entries(headTable.checkConstraints ?? {})) {
      if (baseChecks[name]?.value === headCheck.value) continue
      violations.push({
        id: `${table}.${name}`,
        kind: 'check-changed',
        value: headCheck.value,
        detail: `CHECK \`${name}\` on \`${table}\` is new or changed — a narrowed one rejects the released app's writes`
      })
    }

    const baseUniques = uniqueFingerprints(baseTable)
    for (const [name, fingerprint] of uniqueFingerprints(headTable)) {
      if (baseUniques.get(name) === fingerprint) continue
      violations.push({
        id: `${table}.${name}`,
        kind: 'unique-added',
        value: fingerprint,
        detail: `unique \`${name}\` on \`${table}\` is new or changed — the released app may write rows it now rejects`
      })
    }
  }

  return violations
}

function compareVersions(left: string, right: string): number {
  const parse = (version: string): number[] => {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version)
    if (!match) throw new Error(`Unparsable version: ${version}`)
    return [Number(match[1]), Number(match[2]), Number(match[3])]
  }
  const [a, b] = [parse(left), parse(right)]
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return 0
}

function key(entry: { id: string; kind: ViolationKind; value?: string }): string {
  return entry.value === undefined ? `${entry.kind} ${entry.id}` : `${entry.kind} ${entry.id} ${entry.value}`
}

/** Every violation needs exactly one disposition, and every disposition needs to still apply. */
export function reconcile(violations: Violation[], contract: Contract): string[] {
  const failures: string[] = []
  const detected = new Set(violations.map(key))
  const disposed = new Set<string>()

  for (const entry of [...contract.scheduled, ...contract.acknowledged]) {
    if (disposed.has(key(entry))) {
      failures.push(`${key(entry)}: listed more than once in migrations/downgrade-contract.json`)
    }
    disposed.add(key(entry))
  }

  for (const entry of contract.scheduled) {
    if (!/^\d+\.\d+\.0$/.test(entry.in)) {
      failures.push(
        `${key(entry)}: "in": "${entry.in}" is not a minor release — a patch release must stay downgrade-compatible`
      )
      continue
    }
    if (compareVersions(entry.in, contract.baseline.version) <= 0) {
      failures.push(
        detected.has(key(entry))
          ? `${key(entry)}: "in": "${entry.in}" is not above the baseline ${contract.baseline.version} — a break may only ship in a later minor`
          : `${key(entry)}: ${entry.in} shipped without this landing — apply it now, or move "in" to the next minor`
      )
    }
  }

  for (const entry of contract.acknowledged) {
    if (detected.has(key(entry))) continue
    failures.push(`${key(entry)}: acknowledged but no longer detected — delete the entry`)
  }

  for (const violation of violations) {
    if (disposed.has(key(violation))) continue
    failures.push(
      `${violation.detail}\n    → in migrations/downgrade-contract.json, schedule it for the next minor or record it as reviewed-harmless (id "${violation.id}", kind "${violation.kind}"${violation.value === undefined ? '' : `, value ${JSON.stringify(violation.value)}`})`
    )
  }

  return failures
}

/** Release step: move the baseline onto the version being cut, dropping what it absorbed. */
export function advanceBaseline(
  contract: Contract,
  target: { version: string; snapshot: string },
  violations: Violation[]
): Contract {
  // A prerelease would absorb the minor it is a candidate for before that minor ships.
  if (!/^\d+\.\d+\.\d+$/.test(target.version)) {
    throw new Error(`Cannot advance the baseline onto ${target.version}: only a stable x.y.z release moves it.`)
  }
  if (compareVersions(target.version, contract.baseline.version) <= 0) {
    throw new Error(
      `Cannot advance the baseline onto ${target.version}: it must be newer than the current baseline ${contract.baseline.version}.`
    )
  }

  const failures = reconcile(violations, contract)
  if (failures.length > 0) {
    throw new Error(
      `Cannot advance the baseline: the contract has unresolved downgrade-compatibility violations:\n${failures.map((failure) => `  ${failure}`).join('\n')}`
    )
  }

  for (const violation of violations) {
    const scheduled = contract.scheduled.find((entry) => key(entry) === key(violation))
    if (!scheduled) continue
    if (compareVersions(target.version, scheduled.in) < 0) {
      throw new Error(
        `Cannot release ${target.version}: ${key(violation)} is a downgrade break scheduled for ${scheduled.in}. Cut ${scheduled.in} instead, or revert the change.`
      )
    }
  }

  for (const scheduled of contract.scheduled) {
    if (compareVersions(scheduled.in, target.version) > 0) continue
    if (violations.some((violation) => key(violation) === key(scheduled))) continue
    throw new Error(
      `Cannot release ${target.version}: ${key(scheduled)} was scheduled for ${scheduled.in} but never landed. Apply it, or move "in" to the next minor.`
    )
  }

  return {
    baseline: target,
    scheduled: contract.scheduled.filter((entry) => compareVersions(entry.in, target.version) > 0),
    acknowledged: []
  }
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

function snapshotFileForTag(tag: string): string {
  const journal = readJson<{ entries: Array<{ idx: number; tag: string }> }>(
    path.join(MIGRATIONS_DIR, 'meta/_journal.json')
  )
  const entry = journal.entries.find((candidate) => candidate.tag === tag)
  if (!entry) throw new Error(`Migration not found in the journal: ${tag}`)
  return path.join(MIGRATIONS_DIR, 'meta', `${String(entry.idx).padStart(4, '0')}_snapshot.json`)
}

function headTag(): string {
  const journal = readJson<{ entries: Array<{ idx: number; tag: string }> }>(
    path.join(MIGRATIONS_DIR, 'meta/_journal.json')
  )
  const last = journal.entries.at(-1)
  if (!last) throw new Error('The migration journal is empty')
  return last.tag
}

const main = (): void => {
  const contract = readJson<Contract>(CONTRACT_PATH)
  const violations = getDowngradeViolations(
    readJson<Snapshot>(snapshotFileForTag(contract.baseline.snapshot)),
    readJson<Snapshot>(snapshotFileForTag(headTag()))
  )

  if (process.argv.includes('--advance')) {
    const version = readJson<{ version: string }>(path.join(ROOT, 'package.json')).version
    const advanced = advanceBaseline(contract, { version, snapshot: headTag() }, violations)
    writeFileSync(CONTRACT_PATH, `${JSON.stringify(advanced, null, 2)}\n`)
    console.log(`Downgrade baseline advanced to ${version} (${advanced.baseline.snapshot}).`)
    return
  }

  const failures = reconcile(violations, contract)
  if (failures.length > 0) {
    console.error(
      `Found ${failures.length} downgrade-compatibility violation(s) against ${contract.baseline.version}:\n`
    )
    for (const failure of failures) console.error(`  ${failure}`)
    process.exit(1)
  }
  console.log(`Downgrade compatibility with ${contract.baseline.version} OK.`)
}

if (require.main === module) main()
