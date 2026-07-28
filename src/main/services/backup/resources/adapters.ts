/**
 * Resource requirement adapters (docs/references/backup/README.md §7).
 *
 * A Backup v2 archive always carries the complete database; what it cannot
 * always carry is the out-of-database content that database references —
 * attachment blobs, Knowledge sources, Notes trees, agent workspaces, installed
 * skills. Each adapter answers ONE question for its own kind:
 *
 *   "Which managed paths belong to this database's portable library?"
 *
 * The answer is EXISTENCE-ORIENTED and produced from database rows plus fixed
 * app-owned roots whose contents SQLite does not inventory (notably the sparse
 * Notes state table). An adapter never opens, stats, or hashes the target
 * resource: doing so would (a) make the inventory a snapshot of the producer's
 * disk rather than of the portable library, and (b) make restore preview cost
 * proportional to the user's whole library. Whether a declared path actually
 * exists on the RESTORING device is answered later against this inventory (§2).
 *
 * This is a private, static list — not a registry or extension point — and
 * feature modules never depend upward on it.
 */

import path from 'node:path'

import { agentTable } from '@data/db/schemas/agent'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { fileEntryTable } from '@data/db/schemas/file'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { noteTable } from '@data/db/schemas/note'
import type { DbOrTx } from '@data/db/types'
import { isSafeRelativeSubpath } from '@main/utils/relativePath'
import { isNull } from 'drizzle-orm'

import type { ResourceRequirement } from '../manifest'
import { type BackupPlatform, isPathContainedIn } from '../portability/managedPathRebase'

/**
 * The managed roots the adapters address, resolved ONCE by the caller through
 * `application.getPath()`. Passing them in (rather than resolving per adapter)
 * keeps this module free of path-registry I/O so it can run against a detached
 * database with target roots during restore preview, not only against the live
 * profile during export.
 */
export interface ResourceRoots {
  /** `feature.files.data` — flat internal blob storage. */
  readonly files: string
  /** `feature.knowledgebase.data` — one directory per base id. */
  readonly knowledge: string
  /** `feature.notes.data` — the managed Notes root. */
  readonly notes: string
  /** `feature.agents.data` — parent of per-agent identity and memory directories. */
  readonly agentData: string
  /** `feature.agents.system_workspaces` — parent of per-session system workspaces. */
  readonly systemWorkspaces: string
  /** `feature.agents.skills` — installed skill library. */
  readonly skills: string
}

export interface SnapshotReadContext {
  /**
   * Handle on the database whose references are being inventoried: the detached
   * portable snapshot at export and preview time, or the live database once a
   * restore has promoted it — at that point they ARE the same database. Never
   * the live one while a different profile is staged, since the inventory must
   * describe the database the archive ships.
   */
  readonly db: DbOrTx
  /** Absolute userData root that every `livePath` is relative to. */
  readonly userDataPath: string
  readonly roots: ResourceRoots
  readonly platform: BackupPlatform
}

/** Stable identifiers written into the manifest's `resourceRequirements[].kind`. */
export const BACKUP_RESOURCE_KINDS = [
  'file-blob',
  'knowledge-base',
  'note-root',
  'agent-data',
  'agent-workspace',
  'skill'
] as const

export type BackupResourceKind = (typeof BACKUP_RESOURCE_KINDS)[number]

/** The one trusted managed root each resource kind is allowed to replace. */
export const RESOURCE_ROOT_BY_KIND = Object.freeze({
  'file-blob': 'files',
  'knowledge-base': 'knowledge',
  'note-root': 'notes',
  'agent-data': 'agentData',
  'agent-workspace': 'systemWorkspaces',
  skill: 'skills'
} as const satisfies Record<BackupResourceKind, keyof ResourceRoots>)

/**
 * One adapter's view of the database.
 *
 * `unverifiable` is a COUNT, never a path list: the excluded references are
 * external user paths (`file_entry.origin='external'`, a Notes root the user
 * pointed outside the app, a workspace they chose themselves), and writing them
 * into an archive would export the user's directory layout to whoever reads the
 * backup. The count is enough for the "external/unverifiable" coverage bucket
 * §2 requires, and a restoring device recomputes it from the shipped database
 * whenever it wants the detail.
 */
export interface AdapterInventory {
  readonly requirements: readonly ResourceRequirement[]
  readonly unverifiable: number
}

export interface BackupResourceAdapter {
  readonly kind: BackupResourceKind
  collectRequirements(ctx: SnapshotReadContext): AdapterInventory
}

/**
 * Turn an absolute path into the userData-relative `livePath` a requirement
 * declares, or `null` when it is not a usable managed target.
 *
 * Two independent proofs must both hold, because either alone has a hole:
 *
 * 1. the path lies strictly BELOW `root` — component-exact via
 *    {@link isPathContainedIn}, so `…/Notes` never captures `…/NotesBackup`,
 *    and strictly below so a row claiming the root itself cannot turn the whole
 *    managed tree into one install unit;
 * 2. the userData-relative form is a portable subpath — which is also what
 *    rejects control characters, `..`, and over-long names that a hostile
 *    staged database could store.
 */
function managedLivePath(ctx: SnapshotReadContext, root: string, absolute: string): string | null {
  if (!isPathContainedIn(root, absolute, ctx.platform)) return null
  if (path.relative(root, absolute) === '') return null

  const relative = path.relative(ctx.userDataPath, absolute).split(path.sep).join('/')
  return isSafeRelativeSubpath(relative) ? relative : null
}

/** File extension suffix, matching internal blob storage (`{id}{.ext}`). */
function extSuffix(ext: string | null): string {
  return ext ? `.${ext}` : ''
}

/**
 * Internal attachment blobs. One requirement per row, because each blob is
 * independently present or absent and Full installs them individually.
 *
 * Soft-deleted rows remain requirements: FileManager trash is recoverable user
 * state, and the whole database snapshot preserves those rows, so omitting their
 * bytes would leave recycle-bin entries that can no longer be restored.
 * `origin='external'` rows point at a user-owned absolute path that is never an
 * overlay target (§4), so they only raise the count.
 */
const fileBlobAdapter: BackupResourceAdapter = {
  kind: 'file-blob',
  collectRequirements(ctx) {
    const rows = ctx.db
      .select({ id: fileEntryTable.id, ext: fileEntryTable.ext, origin: fileEntryTable.origin })
      .from(fileEntryTable)
      .all()

    const requirements: ResourceRequirement[] = []
    let unverifiable = 0
    for (const row of rows) {
      if (row.origin !== 'internal') {
        unverifiable++
        continue
      }
      const livePath = managedLivePath(
        ctx,
        ctx.roots.files,
        path.join(ctx.roots.files, `${row.id}${extSuffix(row.ext)}`)
      )
      if (livePath === null) {
        unverifiable++
        continue
      }
      requirements.push({ kind: 'file-blob', resourceType: 'file', livePath })
    }
    return { requirements, unverifiable }
  }
}

/**
 * Knowledge bases. The unit is the whole `{baseId}` directory: its raw sources
 * are only meaningful together, and overlaying two of them would produce a base
 * whose index describes files it does not contain. The rebuildable index inside
 * it is excluded when Phase 3 stages the bytes, not here — a requirement names
 * the unit, not its contents.
 */
const knowledgeBaseAdapter: BackupResourceAdapter = {
  kind: 'knowledge-base',
  collectRequirements(ctx) {
    const rows = ctx.db.select({ id: knowledgeBaseTable.id }).from(knowledgeBaseTable).all()

    const requirements: ResourceRequirement[] = []
    let unverifiable = 0
    for (const row of rows) {
      const livePath = managedLivePath(ctx, ctx.roots.knowledge, path.join(ctx.roots.knowledge, row.id))
      if (livePath === null) {
        unverifiable++
        continue
      }
      requirements.push({ kind: 'knowledge-base', resourceType: 'directory', livePath })
    }
    return { requirements, unverifiable }
  }
}

/**
 * Notes, declared as their ROOT directory rather than per row.
 *
 * `note` is a sparse STATE table, not a note index: its
 * `note_has_state_check` constraint admits a row only when `is_starred` or
 * `is_expanded` is set, so most notes have no row at all, and an `is_expanded`
 * row describes a FOLDER while an `is_starred` row describes a FILE. A row
 * therefore cannot say whether its path is a file or a directory without
 * stat-ing the target — exactly what an existence-oriented inventory must not
 * do. The root is the honest unit: if it is present the restored note state
 * resolves, and Full stages the tree beneath it as one directory unit.
 *
 * A root the user pointed outside the managed directory is never an overlay
 * target and only raises the count.
 */
const noteRootAdapter: BackupResourceAdapter = {
  kind: 'note-root',
  collectRequirements(ctx) {
    const rows = ctx.db.select({ rootPath: noteTable.rootPath }).from(noteTable).all()

    // `note` is sparse metadata, not the inventory of Markdown files. The
    // managed Notes root is therefore always one resource unit, even when no
    // file happens to be starred and the table has zero rows.
    const managedRoot = managedLivePath(ctx, ctx.userDataPath, ctx.roots.notes)
    const requirements: ResourceRequirement[] = managedRoot
      ? [{ kind: 'note-root', resourceType: 'directory', livePath: managedRoot }]
      : []

    let unverifiable = managedRoot ? 0 : 1
    // Rows below the managed root are covered by that one unit. Distinct
    // external roots remain unverifiable and are counted without disclosing
    // their paths.
    for (const rootPath of new Set(rows.map((row) => row.rootPath))) {
      const isManaged = rootPath === ctx.roots.notes || isPathContainedIn(ctx.roots.notes, rootPath, ctx.platform)
      if (!isManaged) unverifiable++
    }
    return { requirements, unverifiable }
  }
}

/** Agent identity and memory, one app-owned directory per live agent row. */
const agentDataAdapter: BackupResourceAdapter = {
  kind: 'agent-data',
  collectRequirements(ctx) {
    const rows = ctx.db.select({ id: agentTable.id }).from(agentTable).where(isNull(agentTable.deletedAt)).all()

    const requirements: ResourceRequirement[] = []
    let unverifiable = 0
    for (const row of rows) {
      const livePath = managedLivePath(ctx, ctx.roots.agentData, path.join(ctx.roots.agentData, row.id))
      if (livePath === null) {
        unverifiable++
        continue
      }
      requirements.push({ kind: 'agent-data', resourceType: 'directory', livePath })
    }
    return { requirements, unverifiable }
  }
}

/**
 * Agent workspaces. Only rows physically inside the managed workspaces root are
 * requirements; a user-chosen workspace is their own directory, which Cherry
 * neither owns nor may overwrite (§4). Containment — not the row's `type`
 * column — is the test, because containment is the property that actually makes
 * an overlay safe, and a hostile staged database controls the column.
 */
const agentWorkspaceAdapter: BackupResourceAdapter = {
  kind: 'agent-workspace',
  collectRequirements(ctx) {
    const rows = ctx.db.select({ path: agentWorkspaceTable.path }).from(agentWorkspaceTable).all()

    const requirements: ResourceRequirement[] = []
    let unverifiable = 0
    for (const row of rows) {
      const livePath = managedLivePath(ctx, ctx.roots.systemWorkspaces, row.path)
      if (livePath === null) {
        unverifiable++
        continue
      }
      requirements.push({ kind: 'agent-workspace', resourceType: 'directory', livePath })
    }
    return { requirements, unverifiable }
  }
}

/**
 * Installed skills. Every `agent_global_skill` row — whatever its `source`,
 * including `builtin` — is physically installed at
 * `feature.agents.skills/{folder_name}` before the row is inserted
 * (`SkillService.installSkillDir`), and `folder_name` carries a unique index, so
 * the database does enumerate the installed library.
 *
 * The Claude-config mirror (`feature.agents.claude.skills`) is deliberately NOT
 * a requirement: it is rebuilt from this library at startup reconcile, so it is
 * derived state, and declaring it would install the same skill twice.
 */
const skillAdapter: BackupResourceAdapter = {
  kind: 'skill',
  collectRequirements(ctx) {
    const rows = ctx.db.select({ folderName: agentGlobalSkillTable.folderName }).from(agentGlobalSkillTable).all()

    const requirements: ResourceRequirement[] = []
    let unverifiable = 0
    for (const row of rows) {
      const livePath = managedLivePath(ctx, ctx.roots.skills, path.join(ctx.roots.skills, row.folderName))
      if (livePath === null) {
        unverifiable++
        continue
      }
      requirements.push({ kind: 'skill', resourceType: 'directory', livePath })
    }
    return { requirements, unverifiable }
  }
}

export const RESOURCE_ADAPTERS: readonly BackupResourceAdapter[] = [
  fileBlobAdapter,
  knowledgeBaseAdapter,
  noteRootAdapter,
  agentDataAdapter,
  agentWorkspaceAdapter,
  skillAdapter
]
