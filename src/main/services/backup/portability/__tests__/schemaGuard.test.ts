import fs from 'node:fs'
import path from 'node:path'

import { agentTable } from '@data/db/schemas/agent'
import { agentChannelTable, agentChannelTaskTable } from '@data/db/schemas/agentChannel'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import { fileEntryTable } from '@data/db/schemas/file'
import { jobScheduleTable, jobTable } from '@data/db/schemas/job'
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { noteTable } from '@data/db/schemas/note'
import { preferenceTable } from '@data/db/schemas/preference'
import { sanitizeAgentChannelCapability } from '@main/ai/channelPortableProfilePolicy'
import { sanitizeMcpServerCapability } from '@main/ai/mcp/portableProfilePolicy'
import { getTableColumns, getTableName } from 'drizzle-orm'
import type { SQLiteTable } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'

import {
  isJobRowResettable,
  JOB_SCHEDULE_AUTOMATION_PATCH,
  PORTABLE_DB_POLICIES,
  resetKnowledgeItemStatus
} from '../tablePolicy'

/**
 * Every table the Phase 1c policy makes a decision about, bound to the
 * PRODUCTION Drizzle schema object. This binding is the point of the file: a
 * renamed table or column breaks the policy loudly here instead of degrading it
 * into a silent no-op against a table that no longer exists.
 */
const SCHEMA_UNDER_POLICY = {
  app_state: appStateTable,
  job: jobTable,
  job_schedule: jobScheduleTable,
  mcp_server: mcpServerTable,
  agent: agentTable,
  agent_channel: agentChannelTable,
  agent_channel_task: agentChannelTaskTable,
  agent_workspace: agentWorkspaceTable,
  note: noteTable,
  knowledge_item: knowledgeItemTable,
  knowledge_base: knowledgeBaseTable,
  file_entry: fileEntryTable,
  agent_global_skill: agentGlobalSkillTable,
  preference: preferenceTable
} as const satisfies Record<string, SQLiteTable>

const REVIEWED_REFERENCE_SURFACES = [
  'agent.configuration',
  'agent_channel.config',
  'agent_channel.workspace',
  'agent_global_skill.folderName',
  'agent_global_skill.sourceUrl',
  'agent_workspace.path',
  'file_entry.externalPath',
  'job.input',
  'job.metadata',
  'job_schedule.jobInputTemplate',
  'job_schedule.metadata',
  'knowledge_item.data',
  'mcp_server.args',
  'mcp_server.baseUrl',
  'mcp_server.command',
  'mcp_server.configSample',
  'mcp_server.dxtPath',
  'mcp_server.env',
  'mcp_server.headers',
  'mcp_server.logoUrl',
  'mcp_server.providerUrl',
  'mcp_server.reference',
  'mcp_server.registryUrl',
  'note.path',
  'note.rootPath',
  'preference.key',
  'preference.value'
] as const

function columnNamesOf(table: SQLiteTable): string[] {
  return Object.keys(getTableColumns(table))
}

describe('policy ↔ production schema', () => {
  it('covers exactly the tables the policy table declares', () => {
    expect(PORTABLE_DB_POLICIES.map((entry) => entry.table).sort()).toEqual(Object.keys(SCHEMA_UNDER_POLICY).sort())
  })

  it('declares no table twice', () => {
    const tables = PORTABLE_DB_POLICIES.map((entry) => entry.table)
    expect(new Set(tables).size).toBe(tables.length)
  })

  it.each(Object.entries(SCHEMA_UNDER_POLICY))('binds the policy table name %s to the real schema', (name, table) => {
    expect(getTableName(table)).toBe(name)
  })

  it('references only columns that exist in the production schema', () => {
    for (const entry of PORTABLE_DB_POLICIES) {
      const table = SCHEMA_UNDER_POLICY[entry.table as keyof typeof SCHEMA_UNDER_POLICY]
      const columns = columnNamesOf(table)
      for (const column of entry.columns) {
        expect(columns, `${entry.table}.${column}`).toContain(column)
      }
      for (const reference of entry.references ?? []) {
        for (const column of reference.columns) {
          expect(columns, `${entry.table}.${column} reference policy`).toContain(column)
        }
      }
    }
  })

  it('covers the complete reviewed path, URL, workspace, and reference-bearing JSON ledger', () => {
    const actual = PORTABLE_DB_POLICIES.flatMap((entry) =>
      (entry.references ?? []).flatMap((reference) => reference.columns.map((column) => `${entry.table}.${column}`))
    ).sort()

    expect(new Set(actual).size).toBe(actual.length)
    expect(actual).toEqual([...REVIEWED_REFERENCE_SURFACES].sort())
  })

  it('declares a safe disposition and checkable owner evidence for every reference surface', () => {
    for (const entry of PORTABLE_DB_POLICIES) {
      for (const reference of entry.references ?? []) {
        expect(['preserve-inert', 'rebase', 'reset', 'deactivate', 'drop']).toContain(reference.disposition)
        expect(reference.evidence.length, `${entry.table}.${reference.columns.join(',')}`).toBeGreaterThan(100)
        expect(reference.evidence, `${entry.table}.${reference.columns.join(',')}`).toMatch(
          /\.ts\b|unknown|malformed|reject/i
        )
      }
    }
  })

  it('gives every entry a policy and non-trivial evidence', () => {
    for (const entry of PORTABLE_DB_POLICIES) {
      expect(entry.policy, entry.table).toBeTruthy()
      expect(entry.evidence.length, entry.table).toBeGreaterThan(80)
      // Evidence must be checkable: a contract section (§) or a source file.
      expect(entry.evidence, entry.table).toMatch(/§|\.ts\b/)
    }
  })
})

describe('patch shapes ↔ production schema', () => {
  it('writes only real mcp_server columns, in both the clean and fail-closed shape', () => {
    const columns = columnNamesOf(mcpServerTable)
    const clean = sanitizeMcpServerCapability({
      args: null,
      env: null,
      headers: null,
      configSample: null,
      disabledTools: null,
      disabledAutoApproveTools: null
    })
    const failedClosed = sanitizeMcpServerCapability({
      args: 'malformed',
      env: null,
      headers: null,
      configSample: null,
      disabledTools: null,
      disabledAutoApproveTools: null
    })
    for (const patch of [clean.patch, failedClosed.patch]) {
      for (const column of Object.keys(patch)) {
        expect(columns, column).toContain(column)
      }
    }
    expect(failedClosed.malformedFields).toEqual(['args'])
  })

  it('writes only real agent_channel columns', () => {
    const columns = columnNamesOf(agentChannelTable)
    const { patch } = sanitizeAgentChannelCapability({
      type: 'telegram',
      config: { bot_token: 'secret' },
      permissionMode: null
    })
    for (const column of Object.keys(patch)) {
      expect(columns, column).toContain(column)
    }
  })

  it('writes only real job_schedule columns', () => {
    const columns = columnNamesOf(jobScheduleTable)
    for (const column of Object.keys(JOB_SCHEDULE_AUTOMATION_PATCH)) {
      expect(columns, column).toContain(column)
    }
  })

  it('leaves the derived scheduling cursors out of the job_schedule patch', () => {
    // Clearing `lastRun` would re-arm a spent `once` schedule and fire it
    // immediately; see JOB_SCHEDULE_AUTOMATION_PATCH.
    expect(Object.keys(JOB_SCHEDULE_AUTOMATION_PATCH)).toEqual(['enabled'])
    expect(columnNamesOf(jobScheduleTable)).toContain('lastRun')
  })

  it('writes the agent configuration column named by the policy', () => {
    expect(columnNamesOf(agentTable)).toContain('configuration')
  })

  it('names path columns that still exist on the rebased tables', () => {
    expect(columnNamesOf(noteTable)).toContain('rootPath')
    expect(columnNamesOf(agentWorkspaceTable)).toContain('path')
    expect(columnNamesOf(fileEntryTable)).toContain('externalPath')
    expect(columnNamesOf(mcpServerTable)).toContain('dxtPath')
  })
})

describe('row predicates ↔ declared domain values', () => {
  it('drops exactly the active job statuses and keeps the terminal ones', () => {
    for (const status of ['pending', 'delayed', 'running']) {
      expect(isJobRowResettable(status), status).toBe(true)
    }
    for (const status of ['completed', 'failed', 'cancelled']) {
      expect(isJobRowResettable(status), status).toBe(false)
    }
  })

  it.each([['unknown-status'], [null], [undefined], [42], [{}]])(
    'drops a row whose status cannot be classified (%s)',
    (status) => {
      expect(isJobRowResettable(status)).toBe(true)
    }
  )

  it('rewrites only the auto-executing knowledge_item status', () => {
    expect(resetKnowledgeItemStatus('deleting')?.status).toBe('failed')
    for (const status of ['idle', 'preparing', 'processing', 'reading', 'embedding', 'completed', 'failed']) {
      expect(resetKnowledgeItemStatus(status), status).toBeNull()
    }
    expect(resetKnowledgeItemStatus(null)).toBeNull()
  })

  it('pairs the reset status with the non-blank error its CHECK constraint demands', () => {
    // `knowledge_item_status_error_check` admits `failed` only alongside a
    // non-blank error, so a status-only reset would abort materialization and make
    // any archive holding a `deleting` item unrestorable.
    const reset = resetKnowledgeItemStatus('deleting')
    expect(reset?.error.trim().length ?? 0).toBeGreaterThan(0)

    const source = fs.readFileSync(path.resolve(__dirname, '../../../../data/db/schemas/knowledge.ts'), 'utf8')
    expect(source).toMatch(/knowledge_item_status_check/)
    expect(source).toMatch(/knowledge_item_status_error_check/)
    expect(source).toMatch(/'failed'/)
  })
})

/**
 * Phase 1c-i must not open a database or touch the filesystem: it is pure policy
 * that Phase 1c-ii applies to an already-staged DB. This walks the LOCAL module
 * graph of every shipped file in `portability/` and proves nothing in it can
 * perform I/O.
 *
 * `node:path` and `node:os` are forbidden alongside `fs`: they are pure, but they
 * resolve against the HOST platform, and a cross-platform archive path must be
 * interpreted with the PRODUCER's rules ({@link ../managedPathRebase}). Reaching
 * for `path.join` here would silently corrupt a win32 path on a POSIX target.
 */
describe('module purity', () => {
  const PORTABILITY_DIR = path.resolve(__dirname, '..')
  const REPO_SRC = path.resolve(__dirname, '../../../../..')
  const REPO_ROOT = path.resolve(REPO_SRC, '..')

  const ALIASES: Readonly<Record<string, string>> = {
    '@main': path.join(REPO_SRC, 'main'),
    '@shared': path.join(REPO_SRC, 'shared'),
    '@data': path.join(REPO_SRC, 'main/data'),
    '@renderer': path.join(REPO_SRC, 'renderer')
  }

  /**
   * Workspace packages resolve to their source, not their build output, so the
   * walk sees the same graph the bundler will. `@cherrystudio/pkg` is the
   * package's `.` export (`src/index.ts`); a subpath export such as
   * `@cherrystudio/provider-registry/node` maps to its own source file, which
   * matters because that is the entry point holding `readFileSync`.
   */
  const WORKSPACE_SCOPE = '@cherrystudio/'

  const FORBIDDEN = [
    'fs',
    'node:fs',
    'fs/promises',
    'node:fs/promises',
    'path',
    'node:path',
    'os',
    'node:os',
    'child_process',
    'node:child_process',
    'better-sqlite3',
    'electron',
    '@application',
    '@logger'
  ]

  /**
   * npm dependencies the graph is allowed to reach. An allowlist rather than a
   * denylist: a bare specifier cannot be walked, so anything not proven pure by
   * review must fail here instead of being silently trusted.
   */
  const PURE_DEPENDENCIES = ['zod']

  /** Runtime (value) imports only — `import type` is erased and cannot do I/O. */
  function runtimeImportsOf(source: string): string[] {
    const specifiers: string[] = []
    const pattern = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)\bfrom\s+['"]([^'"]+)['"]/g
    for (const match of source.matchAll(pattern)) {
      const isTypeOnly = match[1] !== undefined
      if (!isTypeOnly) specifiers.push(match[3])
    }
    return specifiers
  }

  /** Maps a workspace package's `exports` entry back to the source file it is built from. */
  function resolveWorkspace(specifier: string): string | null {
    const [pkg, ...rest] = specifier.slice(WORKSPACE_SCOPE.length).split('/')
    const packageDir = path.join(REPO_ROOT, 'packages', pkg)
    const manifestPath = path.join(packageDir, 'package.json')
    if (!fs.existsSync(manifestPath)) return null

    const subpath = rest.length === 0 ? '.' : `./${rest.join('/')}`
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      exports?: Record<string, unknown>
    }
    const built = firstStringLeaf(manifest.exports?.[subpath])
    if (built === null) {
      // No exports map (or an unmapped subpath): fall back to the conventional
      // source layout so the edge is still walked rather than silently trusted.
      const guess = subpath === '.' ? 'index' : rest.join('/')
      const candidate = path.join(packageDir, 'src', `${guess}.ts`)
      return fs.existsSync(candidate) ? candidate : null
    }
    const stem = path.basename(built).replace(/\.(d\.)?(m|c)?[jt]s$/, '')
    const candidate = path.join(packageDir, 'src', `${stem}.ts`)
    return fs.existsSync(candidate) ? candidate : null
  }

  /** The runtime entry of an `exports` condition tree; `types` conditions are erased. */
  function firstStringLeaf(value: unknown): string | null {
    if (typeof value === 'string') return value
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    for (const [condition, nested] of Object.entries(value)) {
      if (condition === 'types') continue
      const leaf = firstStringLeaf(nested)
      if (leaf !== null) return leaf
    }
    return null
  }

  function resolveLocal(specifier: string, fromFile: string): string | null {
    if (specifier.startsWith(WORKSPACE_SCOPE)) return resolveWorkspace(specifier)

    let base: string | null = null
    if (specifier.startsWith('.')) {
      base = path.resolve(path.dirname(fromFile), specifier)
    } else {
      for (const [alias, target] of Object.entries(ALIASES)) {
        if (specifier === alias || specifier.startsWith(`${alias}/`)) {
          base = path.join(target, specifier.slice(alias.length))
          break
        }
      }
    }
    if (base === null) return null
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (fs.existsSync(candidate)) return candidate
    }
    return null
  }

  /**
   * The POLICY modules, which decide what materialization does and must stay
   * pure, listed separately from the EFFECTFUL module that carries those
   * decisions out against a real database file.
   *
   * Explicit lists rather than a directory glob: a new file in this directory
   * must be consciously classified, and a new policy module cannot quietly
   * escape the purity walk by simply not being pure.
   */
  const POLICY_MODULES = ['managedPathRebase.ts', 'preferenceResetPolicy.ts', 'tablePolicy.ts']
  const PORTABLE_DB_OWNER_POLICY_MODULES = [
    path.join(REPO_SRC, 'main/ai/agents/portableProfilePolicy.ts'),
    path.join(REPO_SRC, 'main/ai/channelPortableProfilePolicy.ts'),
    path.join(REPO_SRC, 'main/ai/mcp/portableProfilePolicy.ts')
  ]
  const OWNER_POLICY_MODULES = [
    ...PORTABLE_DB_OWNER_POLICY_MODULES,
    path.join(REPO_SRC, 'main/ai/skills/capturePolicy.ts'),
    path.join(REPO_SRC, 'main/features/knowledge/capturePolicy.ts'),
    path.join(REPO_SRC, 'main/features/knowledge/portableProfilePolicy.ts'),
    path.join(REPO_SRC, 'main/features/knowledge/restorePolicy.ts'),
    path.join(REPO_SRC, 'main/services/file/portableProfilePolicy.ts')
  ]
  /**
   * `workspacePathPolicy.ts` is effectful on purpose: its decision is pure (and is
   * exercised as such through `gateExternalWorkspacePath`), but the last step of
   * that decision is an `lstat` existence probe, so the module cannot join the
   * purity walk.
   */
  const EFFECTFUL_MODULES = ['materializeDatabase.ts', 'workspacePathPolicy.ts']

  const shippedFiles = [
    ...POLICY_MODULES.map((name) => path.join(PORTABILITY_DIR, name)),
    ...PORTABLE_DB_OWNER_POLICY_MODULES
  ]

  it('classifies every shipped module as either policy or effectful', () => {
    const actual = fs
      .readdirSync(PORTABILITY_DIR)
      .filter((name) => name.endsWith('.ts'))
      .sort()
    expect(actual).toEqual([...POLICY_MODULES, ...EFFECTFUL_MODULES].sort())
    for (const file of [...shippedFiles, ...OWNER_POLICY_MODULES]) expect(fs.existsSync(file)).toBe(true)
  })

  it('performs no filesystem, database, or host-path I/O anywhere in its module graph', () => {
    const visited = new Set<string>()
    const violations: string[] = []
    const unresolved: string[] = []
    const dependencies = new Set<string>()
    const queue = [...shippedFiles]

    while (queue.length > 0) {
      const file = queue.pop() as string
      if (visited.has(file)) continue
      visited.add(file)

      for (const specifier of runtimeImportsOf(fs.readFileSync(file, 'utf8'))) {
        const relative = path.relative(REPO_SRC, file)
        if (FORBIDDEN.includes(specifier) || specifier.startsWith('drizzle-orm')) {
          violations.push(`${relative} imports ${specifier}`)
          continue
        }
        const resolved = resolveLocal(specifier, file)
        if (resolved !== null) {
          queue.push(resolved)
        } else if (specifier.startsWith('.') || specifier.startsWith('@')) {
          // An unresolvable local/aliased specifier means purity cannot be
          // proven for that edge, so it fails rather than being skipped.
          unresolved.push(`${relative} -> ${specifier}`)
        } else {
          dependencies.add(specifier)
        }
      }
    }

    expect(violations).toEqual([])
    expect(unresolved).toEqual([])
    expect([...dependencies].sort()).toEqual(PURE_DEPENDENCIES)
    // The walk must actually have followed the graph, not stopped at the roots.
    expect(visited.size).toBeGreaterThan(shippedFiles.length * 2)
  })

  it('keeps owner policy source independent of Backup types and state machines', () => {
    for (const file of OWNER_POLICY_MODULES) {
      expect(fs.readFileSync(file, 'utf8'), path.relative(REPO_SRC, file)).not.toMatch(/services\/backup/)
    }
  })

  it('detects a forbidden import when one is introduced', () => {
    // Proves the guard above can fail; otherwise a broken regex would make it
    // vacuously green.
    expect(runtimeImportsOf("import fs from 'node:fs'\n")).toEqual(['node:fs'])
    expect(runtimeImportsOf("import { a } from './x'\n")).toEqual(['./x'])
    expect(runtimeImportsOf("import type { A } from 'node:fs'\n")).toEqual([])
    expect(runtimeImportsOf("import { type A, b } from './x'\n")).toEqual(['./x'])
  })
})
