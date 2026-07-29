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
import { knowledgeBaseTable, knowledgeItemTable } from '@data/db/schemas/knowledge'
import { noteTable } from '@data/db/schemas/note'
import type { DbOrTx } from '@data/db/types'
import { DISCONNECTED_AGENT_WORKSPACE_DIRECTORY } from '@main/ai/agents/portableProfilePolicy'
import { isAgentRuntimeConfigCaptureExcluded, isWorkspaceManagedSkillProjection } from '@main/ai/skills/capturePolicy'
import { collectKnowledgeRequiredMaterial, isKnowledgeCaptureExcluded } from '@main/features/knowledge'
import { toInternalBlobFileName } from '@main/services/file'
import { isSafeRelativeSubpath } from '@main/utils/relativePath'
import { eq, isNull, sql } from 'drizzle-orm'

import type { CapturePolicy } from '../dirScan'
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
  /** `feature.mcp.workspace` — default built-in filesystem MCP workspace. */
  readonly mcpWorkspace: string
  /** `feature.mcp.memory_file` — built-in memory MCP knowledge graph. */
  readonly mcpMemory: string
  /** `feature.agents.channels` — managed channel credentials and continuity state. */
  readonly agentChannels: string
  /** `feature.agents.claude.root` — profile-owned agent runtime configuration. */
  readonly agentRuntimeConfig: string
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
  'skill',
  'mcp-workspace',
  'mcp-memory',
  'agent-channel-state',
  'agent-runtime-config'
] as const

export type BackupResourceKind = (typeof BACKUP_RESOURCE_KINDS)[number]

/** The one trusted managed root each resource kind is allowed to replace. */
export const RESOURCE_ROOT_BY_KIND = Object.freeze({
  'file-blob': 'files',
  'knowledge-base': 'knowledge',
  'note-root': 'notes',
  'agent-data': 'agentData',
  'agent-workspace': 'systemWorkspaces',
  skill: 'skills',
  'mcp-workspace': 'mcpWorkspace',
  'mcp-memory': 'mcpMemory',
  'agent-channel-state': 'agentChannels',
  'agent-runtime-config': 'agentRuntimeConfig'
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
  /** Keyed by `livePath`; see {@link UnitContentRequirement}. Omitted by kinds that ship whole. */
  readonly requiredContent?: ReadonlyMap<string, UnitContentRequirement>
}

/**
 * Unit-relative paths a payload MUST carry for the restoring device to rebuild
 * the derived state the archive deliberately does not ship (§2, §6.7).
 *
 * `null` means the unit can never satisfy that proof — a completed leaf names no
 * material at all, which is what a v1→v2 upgrade leaves behind for a directory
 * child that only ever had a virtual path. Either way the proof itself is taken
 * later, against the staging baseline's own directory scan; this is a pure
 * database statement of what to look for.
 */
export type UnitContentRequirement = readonly string[] | null

/**
 * Kinds whose payload carries SOURCE MATERIAL only, with the derived index left
 * to the target's owner after restore (§2 coverage, §6.7). Their coverage bucket
 * is `rebuildable` rather than `available`: the bytes are there, the usable state
 * is not yet. Typed as `string` because a manifest `kind` is untrusted text
 * until matched here.
 */
export const REBUILDABLE_RESOURCE_KINDS: ReadonlySet<string> = new Set<BackupResourceKind>(['knowledge-base'])

export interface BackupResourceAdapter {
  readonly kind: BackupResourceKind
  readonly capturePolicy?: (roots: ResourceRoots | undefined) => CapturePolicy
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
      const livePath = managedLivePath(ctx, ctx.roots.files, path.join(ctx.roots.files, toInternalBlobFileName(row)))
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
 * Per base id, the `raw/` material every COMPLETED indexable leaf needs for the
 * target to rebuild the index this archive excludes.
 *
 * Only `completed` leaves count: an unfinished item has nothing indexed to
 * reproduce. `directory` items are containers whose children are separate rows,
 * and they are the rows that name material.
 */
function knowledgeMaterialsByBase(ctx: SnapshotReadContext): ReadonlyMap<string, UnitContentRequirement> {
  const rows = ctx.db
    .select({
      baseId: knowledgeItemTable.baseId,
      type: knowledgeItemTable.type,
      data: sql<string>`${knowledgeItemTable.data}`
    })
    .from(knowledgeItemTable)
    .where(eq(knowledgeItemTable.status, 'completed'))
    .all()
  return collectKnowledgeRequiredMaterial(rows)
}

/**
 * Knowledge bases. The unit is the whole `{baseId}` directory: its raw sources
 * are only meaningful together, and overlaying two of them would produce a base
 * whose index describes files it does not contain. The rebuildable index inside
 * it is excluded when Phase 3 stages the bytes, not here — a requirement names
 * the unit, not its contents.
 *
 * Because the index is excluded, the raw material is the ONLY thing that makes a
 * restored base recoverable, so each base also declares the material set staging
 * must find. A base that cannot supply it is degraded out of the archive rather
 * than shipped as an index-less shell that no device could ever rebuild.
 */
const knowledgeBaseAdapter: BackupResourceAdapter = {
  kind: 'knowledge-base',
  capturePolicy: () => ({ excludeRelativePath: isKnowledgeCaptureExcluded }),
  collectRequirements(ctx) {
    const rows = ctx.db.select({ id: knowledgeBaseTable.id }).from(knowledgeBaseTable).all()
    const materials = knowledgeMaterialsByBase(ctx)

    const requirements: ResourceRequirement[] = []
    const requiredContent = new Map<string, UnitContentRequirement>()
    let unverifiable = 0
    for (const row of rows) {
      const livePath = managedLivePath(ctx, ctx.roots.knowledge, path.join(ctx.roots.knowledge, row.id))
      if (livePath === null) {
        unverifiable++
        continue
      }
      requirements.push({ kind: 'knowledge-base', resourceType: 'directory', livePath })
      // `null` is a meaningful value here (unprovable), so `??` would erase it.
      requiredContent.set(livePath, materials.has(row.id) ? materials.get(row.id)! : [])
    }
    return { requirements, unverifiable, requiredContent }
  }
}

function fixedManagedResource(
  ctx: SnapshotReadContext,
  kind: BackupResourceKind,
  root: string,
  resourceType: 'file' | 'directory'
): AdapterInventory {
  const livePath = managedLivePath(ctx, ctx.userDataPath, root)
  return livePath
    ? { requirements: [{ kind, resourceType, livePath }], unverifiable: 0 }
    : { requirements: [], unverifiable: 1 }
}

const mcpWorkspaceAdapter: BackupResourceAdapter = {
  kind: 'mcp-workspace',
  collectRequirements(ctx) {
    return fixedManagedResource(ctx, this.kind, ctx.roots.mcpWorkspace, 'directory')
  }
}

const mcpMemoryAdapter: BackupResourceAdapter = {
  kind: 'mcp-memory',
  collectRequirements(ctx) {
    return fixedManagedResource(ctx, this.kind, ctx.roots.mcpMemory, 'file')
  }
}

const agentChannelStateAdapter: BackupResourceAdapter = {
  kind: 'agent-channel-state',
  collectRequirements(ctx) {
    return fixedManagedResource(ctx, this.kind, ctx.roots.agentChannels, 'directory')
  }
}

const agentRuntimeConfigAdapter: BackupResourceAdapter = {
  kind: 'agent-runtime-config',
  capturePolicy: () => ({ excludeRelativePath: isAgentRuntimeConfigCaptureExcluded }),
  collectRequirements(ctx) {
    return fixedManagedResource(ctx, this.kind, ctx.roots.agentRuntimeConfig, 'directory')
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
  capturePolicy: (roots) => ({
    decideNode(context) {
      if (
        context.nodeKind === 'symlink' &&
        context.resolvedTargetPath &&
        roots &&
        isWorkspaceManagedSkillProjection(context.relativePath, context.resolvedTargetPath, roots.skills)
      ) {
        return { kind: 'exclude-derived' }
      }
      return context.defaultDecision
    }
  }),
  collectRequirements(ctx) {
    const rows = ctx.db.select({ path: agentWorkspaceTable.path }).from(agentWorkspaceTable).all()

    const disconnected = path.join(ctx.roots.systemWorkspaces, DISCONNECTED_AGENT_WORKSPACE_DIRECTORY)

    const requirements: ResourceRequirement[] = []
    let unverifiable = 0
    for (const row of rows) {
      const livePath = managedLivePath(ctx, ctx.roots.systemWorkspaces, row.path)
      // A placeholder is inside the root but names nothing: a previous restore
      // put it there for a binding it could not carry over, and never created
      // it on disk. It is the same reference the producing device counted as
      // unverifiable, so it stays unverifiable here rather than becoming a
      // requirement no archive could ever satisfy.
      if (livePath === null || isPathContainedIn(disconnected, row.path, ctx.platform)) {
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
  mcpWorkspaceAdapter,
  mcpMemoryAdapter,
  agentChannelStateAdapter,
  agentRuntimeConfigAdapter,
  agentDataAdapter,
  agentWorkspaceAdapter,
  skillAdapter
]

export function capturePolicyForKind(kind: string, roots?: ResourceRoots): CapturePolicy {
  return RESOURCE_ADAPTERS.find((adapter) => adapter.kind === kind)?.capturePolicy?.(roots) ?? {}
}
