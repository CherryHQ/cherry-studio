/**
 * Backup schema-refs codegen (Track A2).
 *
 * Reads the Drizzle schemas in src/main/data/db/schemas/ via Drizzle runtime
 * reflection (getTableConfig), and emits src/main/data/db/backup/dbSchemaRefs.ts —
 * the single source of truth for table/column/PK/FK/FTS facts consumed by the
 * contributor framework (A1b types, A3 ContributorManager coverage, finalize).
 *
 * Contract: openspec/changes/modular-backup-contributors-refined/specs/
 *           modular-backup-contributor/{codegen,types-contracts}.md
 *
 * No SQLite connection, no Electron, no business code — pure schema reflection.
 *
 * Usage:
 *   pnpm backup:refs:generate            # write dbSchemaRefs.ts
 *   BACKUP_REFS_CHECK=1 pnpm ...         # byte-for-byte compare; exit 1 if stale
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { isTable } from 'drizzle-orm/table'
import { getTableConfig, type SQLiteColumn, type SQLiteTable } from 'drizzle-orm/sqlite-core'

const ROOT = process.cwd()
const SCHEMA_DIR = resolve(ROOT, 'src/main/data/db/schemas')
const OUTPUT_FILE = resolve(ROOT, 'src/main/data/db/backup/dbSchemaRefs.ts')
const CHECK_MODE = process.env.BACKUP_REFS_CHECK === '1'

// SQL types Drizzle can report for SQLite columns.
type SqlType = 'text' | 'integer' | 'real' | 'blob'
const VALID_SQL_TYPES = new Set<SqlType>(['text', 'integer', 'real', 'blob'])

interface ColumnInfo {
  /** JS property key (camelCase) — the backup-facing column identity. */
  readonly key: string
  readonly sqlType: SqlType
  readonly isPrimaryKey: boolean
  readonly isNullable: boolean
}

interface ForeignKeyInfo {
  readonly columns: readonly string[]
  readonly targetTable: string
  readonly targetColumns: readonly string[]
  readonly onDelete: 'cascade' | 'restrict' | 'set null' | 'no action' | 'set default'
}

interface PrimaryKeyInfo {
  readonly columns: readonly string[]
  readonly kind: 'uuid-v4' | 'uuid-v7' | 'natural' | 'composite' | 'autoincrement'
  readonly ambiguous: boolean
}

interface TableInfo {
  readonly name: string
  readonly columns: readonly ColumnInfo[]
  readonly primaryKey: PrimaryKeyInfo
  readonly foreignKeys: readonly ForeignKeyInfo[]
}

/**
 * Single pass over the schema dir: dynamic-import each module ONCE and partition
 * its exports into Drizzle tables (sqliteTable, via isTable) and FTS5 virtual
 * tables (parsed from *_FTS_STATEMENTS arrays). Importing each module once avoids
 * double module-eval. The schema dir is flat (only __tests__/ as a subdir, which
 * readdirSync skips); _columnHelpers.ts holds column-builder helpers, not tables.
 */
async function discoverSchemas(): Promise<{
  tables: SQLiteTable[]
  ftsVirtualTables: ReadonlyArray<readonly [string, string]>
}> {
  const files = readdirSync(SCHEMA_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.startsWith('_columnHelpers'))
    .sort()
  const tables = new Map<string, SQLiteTable>()
  const ftsVirtualTables = new Map<string, string>()
  for (const file of files) {
    const moduleUrl = pathToFileURL(resolve(SCHEMA_DIR, file)).href
    const mod = await import(moduleUrl)
    for (const [exportName, exportedValue] of Object.entries(mod)) {
      if (isTable(exportedValue)) {
        const table = exportedValue as SQLiteTable
        tables.set(getTableConfig(table).name, table)
        continue
      }
      if (!exportName.endsWith('_FTS_STATEMENTS') || !Array.isArray(exportedValue)) continue
      for (const statement of exportedValue as readonly string[]) {
        const ftsMatch = statement.match(/CREATE\s+VIRTUAL\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)\s+USING\s+fts5/i)
        if (!ftsMatch) continue
        // content= may use single or double quotes; \w+ requires a non-empty
        // content table. A missing/unparseable clause fails loudly so a future
        // schema author can't silently lose an FTS mapping that CHECK would bless.
        const contentMatch = statement.match(/content\s*=\s*["'](\w+)["']/i)
        if (!contentMatch) {
          throw new Error(
            `FTS virtual table '${ftsMatch[1]}' has no parseable non-empty content= clause (needed to map it to its content table): ${statement.slice(0, 80)}…`
          )
        }
        ftsVirtualTables.set(ftsMatch[1], contentMatch[1])
      }
    }
  }
  return {
    tables: [...tables.values()],
    ftsVirtualTables: [...ftsVirtualTables.entries()].sort(([a], [b]) => a.localeCompare(b))
  }
}

/**
 * Build a column→JS-key lookup for one table by matching table[key] identity.
 * Drizzle columns expose .name (which reflects a DB-name override, e.g. 'app_id'),
 * NOT the JS property key ('appId'). Backup uses the camelCase JS key throughout,
 * so we recover it via Object.keys identity rather than reading column.name.
 */
function buildKeyLookup(table: SQLiteTable): Map<SQLiteColumn, string> {
  const lookup = new Map<SQLiteColumn, string>()
  for (const key of Object.keys(table)) {
    const column = (table as unknown as Record<string, unknown>)[key]
    if (column) lookup.set(column as SQLiteColumn, key)
  }
  return lookup
}

/** Read the defaultFn source to detect UUID helpers (tsx form: import_uuid.v7). */
function detectUuidKind(defaultFnSource: string | undefined): 'uuid-v4' | 'uuid-v7' | null {
  if (!defaultFnSource || !/uuid/i.test(defaultFnSource)) return null
  if (/v7/.test(defaultFnSource)) return 'uuid-v7'
  if (/v4/.test(defaultFnSource)) return 'uuid-v4'
  return null
}

/** Extract the full TableInfo (columns, PK, FKs) from one Drizzle table. */
function extractTableInfo(table: SQLiteTable, autoIncrementKeys: Set<string>): TableInfo {
  const config = getTableConfig(table)
  const keyLookup = buildKeyLookup(table)

  // Columns in Drizzle declaration order (codegen must NOT re-sort). isPrimaryKey
  // starts from the inline .primaryKey() flag and is re-derived from the resolved
  // PK column set below, so constituents of a table-level composite primaryKey()
  // are also flagged — Drizzle does not backfill .primary on those columns.
  const rawColumns = config.columns.map((column) => {
    const sqlType = column.getSQLType() as SqlType
    if (!VALID_SQL_TYPES.has(sqlType)) {
      throw new Error(`Unexpected SQL type '${sqlType}' on column '${keyLookup.get(column)}' of table '${config.name}'`)
    }
    return {
      key: keyLookup.get(column) ?? column.name,
      sqlType,
      isPrimaryKey: (column as { primary?: boolean }).primary === true,
      isNullable: !(column as { notNull?: boolean }).notNull
    }
  })

  // Primary key: table-level composite (config.primaryKeys) takes precedence;
  // otherwise the inline .primaryKey() column (column.primary === true).
  const tableLevelPkColumns = config.primaryKeys.flatMap((pk) => pk.columns.map((c) => keyLookup.get(c) ?? c.name))
  const inlinePkColumns = rawColumns.filter((c) => c.isPrimaryKey).map((c) => c.key)
  const pkColumns = tableLevelPkColumns.length > 0 ? tableLevelPkColumns : inlinePkColumns
  const pkKeySet = new Set(pkColumns)
  // Re-flag isPrimaryKey from the resolved PK set so table-level composite PK
  // constituents match DB_PRIMARY_KEYS (inline-only tables are unaffected).
  const columns: ColumnInfo[] = rawColumns.map((c) => ({ ...c, isPrimaryKey: pkKeySet.has(c.key) }))

  let primaryKey: PrimaryKeyInfo
  if (pkColumns.length > 1) {
    // H1: composite PK (junction tables, scoped config slots).
    primaryKey = { columns: pkColumns, kind: 'composite', ambiguous: false }
  } else if (pkColumns.length === 1) {
    const pkColumnName = pkColumns[0]
    const pkColumn = columns.find((c) => c.key === pkColumnName)
    if (!pkColumn) throw new Error(`PK column '${pkColumnName}' not found in table '${config.name}'`)
    if (pkColumn.sqlType === 'integer' && autoIncrementKeys.has(`${config.name}.${pkColumnName}`)) {
      primaryKey = { columns: pkColumns, kind: 'autoincrement', ambiguous: false }
    } else if (pkColumn.key === 'id') {
      const defaultFnSource = readDefaultFn(table, pkColumnName)
      const uuid = detectUuidKind(defaultFnSource)
      if (uuid) {
        primaryKey = { columns: pkColumns, kind: uuid, ambiguous: false }
      } else {
        // H5: id column, non-UUID default.
        primaryKey = { columns: pkColumns, kind: 'natural', ambiguous: true }
      }
    } else {
      // H4: non-id single PK.
      primaryKey = { columns: pkColumns, kind: 'natural', ambiguous: true }
    }
  } else {
    throw new Error(`Table '${config.name}' has no detectable primary key`)
  }

  // Foreign keys: reference() is a function returning { columns, foreignTable, foreignColumns }.
  // Covers both inline .references() and table-level foreignKey() builders.
  const foreignKeys: ForeignKeyInfo[] = config.foreignKeys.map((fk) => {
    const reference = (
      fk as { reference: () => { columns: SQLiteColumn[]; foreignTable: SQLiteTable; foreignColumns: SQLiteColumn[] } }
    ).reference()
    const onDelete = (fk as { onDelete?: string }).onDelete
    // Target columns belong to the foreign table, so resolve their JS keys via the
    // TARGET table's lookup — the source table's keyLookup would miss any target
    // column with a DB-name override and fall back to its snake_case c.name.
    const targetKeyLookup = buildKeyLookup(reference.foreignTable)
    return {
      columns: reference.columns.map((c) => keyLookup.get(c) ?? c.name),
      targetTable: getTableConfig(reference.foreignTable).name,
      targetColumns: reference.foreignColumns.map((c) => targetKeyLookup.get(c) ?? c.name),
      onDelete: (onDelete ?? 'no action') as ForeignKeyInfo['onDelete']
    }
  })

  return { name: config.name, columns, primaryKey, foreignKeys }
}

/** Read a column's $defaultFn source string (for UUID helper detection). */
function readDefaultFn(table: SQLiteTable, columnName: string): string | undefined {
  const column = (table as unknown as Record<string, { defaultFn?: () => unknown }>)[columnName]
  return column?.defaultFn?.toString()
}

/** Collect which (table.column) pairs are autoIncrement, for PK classification. */
function collectAutoIncrement(tables: readonly SQLiteTable[]): Set<string> {
  const set = new Set<string>()
  for (const table of tables) {
    const config = getTableConfig(table)
    const keyLookup = buildKeyLookup(table)
    for (const column of config.columns) {
      if ((column as { autoIncrement?: boolean }).autoIncrement === true) {
        set.add(`${config.name}.${keyLookup.get(column) ?? column.name}`)
      }
    }
  }
  return set
}

/** Quote a string literal for emission. */
function str(value: string): string {
  return `'${value}'`
}

/** Emit the dbSchemaRefs.ts file content from the extracted facts. */
function emitDbSchemaRefs(
  tables: readonly TableInfo[],
  ftsVirtualTables: ReadonlyArray<readonly [string, string]>,
  meta: { generatedAt: string; schemaCommit: string }
): string {
  const sortedTables = [...tables].sort((a, b) => a.name.localeCompare(b.name))

  const dbTables = sortedTables.map((t) => `  ${str(t.name)},`).join('\n')

  const columnsByTable = sortedTables
    .map((t) => {
      const entries = t.columns
        .map(
          (c) =>
            `    { name: ${str(c.key)}, dbName: ${str(c.key)}, isPrimaryKey: ${c.isPrimaryKey}, isNullable: ${c.isNullable}, sqlType: ${str(c.sqlType)} }`
        )
        .join(',\n')
      return `  ${t.name}: [\n${entries}\n  ]`
    })
    .join(',\n')

  const primaryKeys = sortedTables
    .map((t) => {
      const pk = t.primaryKey
      const cols = pk.columns.map((c) => str(c)).join(', ')
      return `  ${t.name}: { table: ${str(t.name)}, columns: [${cols}], kind: ${str(pk.kind)}, ambiguous: ${pk.ambiguous} }`
    })
    .join(',\n')

  const foreignKeys = sortedTables
    .map((t) => {
      if (t.foreignKeys.length === 0) return `  ${t.name}: []`
      const facts = t.foreignKeys
        .map((fk) => {
          const local = fk.columns.map((c) => str(c)).join(', ')
          const target = fk.targetColumns.map((c) => str(c)).join(', ')
          return `    { columns: [${local}], targetTable: ${str(fk.targetTable)}, targetColumns: [${target}], onDelete: ${str(fk.onDelete)} }`
        })
        .join(',\n')
      return `  ${t.name}: [\n${facts}\n  ]`
    })
    .join(',\n')

  const ftsEntries = ftsVirtualTables
    .map(([ftsTable, contentTable]) => `  ${ftsTable}: ${str(contentTable)},`)
    .join('\n')

  return `// @generated by scripts/generate-backup-schema-refs.ts — DO NOT EDIT
//
// Auto-generated from src/main/data/db/schemas/*.ts via Drizzle runtime reflection.
// Regenerate: pnpm backup:refs:generate · Verify (CI-enforced): pnpm backup:refs:check.
// Do NOT edit by hand — change the Drizzle schemas and re-run the generator.

// Table/column identifier types (main-only neutral layer). These are literal unions
// derived from DB_TABLES / DB_COLUMNS_BY_TABLE, not the branded "string & { __brand }"
// form in types-contracts.md: the branded form would reject the literal argument to
// table()/column() and break compile-time membership validation. The union still
// makes a wrong literal fail tsc (table('nope') / column<'message'>('nope')), which
// is the spec intent. Consumers MUST build identifiers via the helpers below, never
// via "as" casts (an ESLint rule bans raw casts — wired in A1b with consumers).
export type DbTableName = (typeof DB_TABLES)[number]
export type DbColumnName<T extends DbTableName = DbTableName> =
  (typeof DB_COLUMNS_BY_TABLE)[T][number]['name']

export interface DbColumnEntry<T extends DbTableName = DbTableName> {
  readonly name: DbColumnName<T>
  readonly dbName: string
  readonly isPrimaryKey: boolean
  readonly isNullable: boolean
  readonly sqlType: 'text' | 'integer' | 'real' | 'blob'
}

export type PrimaryKeyKind = 'uuid-v4' | 'uuid-v7' | 'natural' | 'composite' | 'autoincrement'

export interface PrimaryKeyFact {
  readonly table: DbTableName
  readonly columns: readonly DbColumnName[]
  readonly kind: PrimaryKeyKind
  readonly ambiguous?: boolean
}

export interface ForeignKeyFact {
  readonly columns: readonly DbColumnName[]
  readonly targetTable: DbTableName
  readonly targetColumns: readonly DbColumnName[]
  readonly onDelete: 'cascade' | 'restrict' | 'set null' | 'no action' | 'set default'
}

// Compile-time validation helpers. table('x')/column<'t'>('c') fail tsc when the
// literal is not a known table/column, so typos surface at compile time.
export function table<T extends DbTableName>(literal: T): T {
  return literal
}
export function column<T extends DbTableName>(literal: DbColumnName<T>): DbColumnName<T> {
  return literal
}
export function columns<T extends DbTableName>(literals: readonly DbColumnName<T>[]): readonly DbColumnName<T>[] {
  return literals
}

// 1. Business tables discovered via sqliteTable() calls. Excludes
//    __drizzle_migrations (runtime infra, not a sqliteTable definition) and the
//    FTS virtual tables (raw CREATE VIRTUAL TABLE SQL, listed in DB_FTS_VIRTUAL_TABLES).
export const DB_TABLES = [
${dbTables}
] as const

// 2. Columns per table (Drizzle declaration order, NOT re-sorted). dbName is the
//    camelCase JS property key; the physical snake_case SQLite column is derived by
//    DbService casing:'snake_case' at query time — backup uses drizzle builders only.
export const DB_COLUMNS_BY_TABLE = {
${columnsByTable}
} as const satisfies { readonly [T in DbTableName]: readonly { readonly name: string; readonly dbName: string; readonly isPrimaryKey: boolean; readonly isNullable: boolean; readonly sqlType: 'text' | 'integer' | 'real' | 'blob' }[] }

// 3. Primary-key facts (keys dict-ascending). ambiguous:true means a contributor
//    MUST override this PK explicitly (H4/H5 heuristic — see types-contracts.md).
export const DB_PRIMARY_KEYS = {
${primaryKeys}
} as const satisfies Readonly<Record<DbTableName, PrimaryKeyFact>>

// 3b. Foreign-key facts — the single source of truth for onDelete policy,
//     consumed by finalize #19 (ReferenceKind vs onDelete) and #24 (every declared
//     EntityReference must match a generated FK). onDelete is normalized: a schema
//     FK without ON DELETE yields 'no action' (SQLite default), never undefined.
export const DB_FOREIGN_KEYS = {
${foreignKeys}
} as const satisfies Readonly<Record<DbTableName, readonly ForeignKeyFact[]>>

// 3c. FTS5 virtual tables (content-table mapping). Keys are the FTS virtual table
//     names (not in DB_TABLES, in ALWAYS_STRIP); values are content tables (in
//     DB_TABLES). Parsed from the *_FTS_STATEMENTS content= clauses.
export const DB_FTS_VIRTUAL_TABLES = {
${ftsEntries}
} as const satisfies Readonly<Record<string, DbTableName>>

// 5. Generation metadata for diagnostics. Excluded from byte-for-byte CHECK.
export const BACKUP_REFS_META = {
  generatedAt: '${meta.generatedAt}',
  schemaCommit: '${meta.schemaCommit}'
} as const
`
}

/**
 * Format emitted content with biome so the generated file matches `pnpm format`
 * output. This keeps backup:refs:check byte-equal stable: both the freshly
 * generated content and the committed file pass through the same formatter, so
 * line-wrapping (e.g. long FK entries expanded to multi-line) is deterministic.
 */
function formatViaBiome(content: string): string {
  const biomeBin = resolve(ROOT, 'node_modules', '.bin', 'biome')
  const result = spawnSync(biomeBin, ['format', `--stdin-file-path=${OUTPUT_FILE}`], {
    input: content,
    cwd: ROOT,
    encoding: 'utf8'
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`biome format failed (exit ${result.status}):\n${result.stderr}`)
  }
  return result.stdout
}

/** Best-effort current git HEAD short SHA, for BACKUP_REFS_META diagnostics. */
function getGitHead(): string {
  const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' })
  if (result.status !== 0 || !result.stdout.trim()) return 'unknown'
  return result.stdout.trim()
}

/** Strip the volatile BACKUP_REFS_META values for byte-equal comparison. */
function normalizeForCheck(content: string): string {
  return content
    .replace(/generatedAt: '[^']*'/, "generatedAt: '<generated-at>'")
    .replace(/schemaCommit: '[^']*'/, "schemaCommit: '<schema-commit>'")
}

async function main(): Promise<void> {
  const { tables, ftsVirtualTables } = await discoverSchemas()
  const autoIncrementKeys = collectAutoIncrement(tables)
  const tableInfos = tables
    .map((t) => extractTableInfo(t, autoIncrementKeys))
    .sort((a, b) => a.name.localeCompare(b.name))

  const meta = { generatedAt: new Date().toISOString(), schemaCommit: getGitHead() }
  const content = formatViaBiome(emitDbSchemaRefs(tableInfos, ftsVirtualTables, meta))

  if (CHECK_MODE) {
    if (!existsSync(OUTPUT_FILE)) {
      console.error('dbSchemaRefs.ts does not exist; run pnpm backup:refs:generate')
      process.exit(1)
    }
    const existing = normalizeForCheck(readFileSync(OUTPUT_FILE, 'utf8'))
    const generated = normalizeForCheck(content)
    if (existing !== generated) {
      console.error('dbSchemaRefs.ts is out of date; run pnpm backup:refs:generate')
      process.exit(1)
    }
    process.exit(0)
  }

  mkdirSync(dirname(OUTPUT_FILE), { recursive: true })
  writeFileSync(OUTPUT_FILE, content, 'utf8')
  console.log(`Generated ${OUTPUT_FILE} (${tableInfos.length} tables, ${ftsVirtualTables.length} FTS virtual tables)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
