import { type BigIntStats, constants as fsConstants } from 'node:fs'
import { chmod, link, lstat, mkdir, mkdtemp, open, readFile, rm, unlink } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import * as z from 'zod'

const logger = loggerService.withContext('McpMemoryFileMigration')
const O_NOFOLLOW = fsConstants.O_NOFOLLOW ?? 0
const EMPTY_MEMORY_BYTES = Buffer.from(JSON.stringify({ entities: [], relations: [] }, null, 2))

const MemoryEntitySchema = z.object({
  name: z.string(),
  entityType: z.string(),
  observations: z.array(z.string()).optional()
})

const MemoryRelationSchema = z.object({
  from: z.string(),
  to: z.string(),
  relationType: z.string()
})

const MemoryGraphSchema = z.object({
  entities: z.array(MemoryEntitySchema),
  relations: z.array(MemoryRelationSchema)
})

export type McpMemoryFileMigrationResult = 'already-present' | 'migrated' | 'initialized' | 'concurrent-target'

/** Deterministic seam for proving the no-clobber publication race. */
export const memoryFileMigrationHooks = {
  async afterLegacyRead(sourcePath: string): Promise<void> {
    void sourcePath
  },
  async beforePublish(targetPath: string): Promise<void> {
    void targetPath
  },
  async afterPublish(targetPath: string): Promise<void> {
    void targetPath
  },
  hardLink(stagingPath: string, targetPath: string): Promise<void> {
    return link(stagingPath, targetPath)
  },
  removeStaging(stagingDir: string): Promise<void> {
    return rm(stagingDir, { recursive: true, force: true })
  }
}

function isMissing(error: unknown): boolean {
  return ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')
}

function sameFileIdentity(a: BigIntStats, b: BigIntStats): boolean {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeNs === b.mtimeNs &&
    a.ctimeNs === b.ctimeNs &&
    a.isFile() === b.isFile()
  )
}

type LegacyCapture =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly bytes: Buffer; readonly identity: BigIntStats }

function validateMemoryBytes(bytes: Buffer, sourcePath: string): void {
  const text = bytes.toString('utf8')
  if (text.trim() === '') return

  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`Legacy MCP memory file is not valid JSON: ${sourcePath}`, { cause: error })
  }
  const parsed = MemoryGraphSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`Legacy MCP memory file has an invalid knowledge-graph shape: ${sourcePath}`, {
      cause: parsed.error
    })
  }
}

async function assertRealTargetFile(targetPath: string): Promise<boolean> {
  let stats: Awaited<ReturnType<typeof lstat>>
  try {
    stats = await lstat(targetPath)
  } catch (error) {
    if (isMissing(error)) return false
    throw error
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`MCP memory target must be a real file: ${targetPath}`)
  }
  return true
}

async function readStableLegacyFile(sourcePath: string): Promise<LegacyCapture> {
  let initial: BigIntStats
  try {
    initial = await lstat(sourcePath, { bigint: true })
  } catch (error) {
    if (isMissing(error)) return { kind: 'absent' }
    throw error
  }
  if (initial.isSymbolicLink() || !initial.isFile()) {
    throw new Error(`Legacy MCP memory source must be a real file: ${sourcePath}`)
  }

  const handle = await open(sourcePath, fsConstants.O_RDONLY | O_NOFOLLOW)
  try {
    const opened = await handle.stat({ bigint: true })
    if (!sameFileIdentity(initial, opened)) {
      throw new Error(`Legacy MCP memory source changed before capture: ${sourcePath}`)
    }
    const bytes = await handle.readFile()
    await memoryFileMigrationHooks.afterLegacyRead(sourcePath)
    const afterRead = await handle.stat({ bigint: true })
    if (!sameFileIdentity(initial, afterRead)) {
      throw new Error(`Legacy MCP memory source changed during capture: ${sourcePath}`)
    }
    const finalPathStats = await lstat(sourcePath, { bigint: true })
    if (finalPathStats.isSymbolicLink() || !sameFileIdentity(initial, finalPathStats)) {
      throw new Error(`Legacy MCP memory source path changed during capture: ${sourcePath}`)
    }
    validateMemoryBytes(bytes, sourcePath)
    return { kind: 'present', bytes, identity: initial }
  } finally {
    await handle.close()
  }
}

async function assertLegacyCaptureStable(sourcePath: string, capture: LegacyCapture, phase: string): Promise<void> {
  let current: BigIntStats
  try {
    current = await lstat(sourcePath, { bigint: true })
  } catch (error) {
    if (isMissing(error) && capture.kind === 'absent') return
    if (isMissing(error)) throw new Error(`Legacy MCP memory source disappeared ${phase}: ${sourcePath}`)
    throw error
  }

  if (capture.kind === 'absent') {
    throw new Error(`Legacy MCP memory source appeared ${phase}: ${sourcePath}`)
  }
  if (current.isSymbolicLink() || !current.isFile() || !sameFileIdentity(capture.identity, current)) {
    throw new Error(`Legacy MCP memory source changed ${phase}: ${sourcePath}`)
  }
}

function relativeWithin(root: string, candidate: string, label: string): string {
  const relative = path.relative(root, candidate)
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside its trusted root: ${candidate}`)
  }
  return relative
}

async function assertSafeSourceAncestors(sourceRoot: string, sourcePath: string): Promise<void> {
  const root = path.resolve(sourceRoot)
  const source = path.resolve(sourcePath)
  relativeWithin(root, source, 'Legacy MCP memory source')
  const relativeParent = path.relative(root, path.dirname(source))
  let current = root
  for (const segment of ['', ...relativeParent.split(path.sep).filter(Boolean)]) {
    if (segment) current = path.join(current, segment)
    let stats: Awaited<ReturnType<typeof lstat>>
    try {
      stats = await lstat(current)
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`Legacy MCP memory source ancestor must be a real directory: ${current}`)
    }
  }
}

async function ensureSafeTargetParent(profileRoot: string, targetPath: string): Promise<string> {
  const root = path.resolve(profileRoot)
  const target = path.resolve(targetPath)
  relativeWithin(root, target, 'MCP memory target')

  const rootStats = await lstat(root)
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error(`MCP memory profile root must be a real directory: ${root}`)
  }

  const targetDir = path.dirname(target)
  const relativeDir = path.relative(root, targetDir)
  let current = root
  for (const segment of relativeDir.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    let stats: Awaited<ReturnType<typeof lstat>>
    try {
      stats = await lstat(current)
    } catch (error) {
      if (!isMissing(error)) throw error
      await mkdir(current, { mode: 0o700 })
      stats = await lstat(current)
    }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`MCP memory target ancestor must be a real directory: ${current}`)
    }
    await chmod(current, 0o700)
  }
  return targetDir
}

async function fsyncDirectory(dir: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(dir, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function removePublishedTargetIfOwned(targetPath: string, stagingPath: string): Promise<void> {
  const [targetStats, stagingStats] = await Promise.all([
    lstat(targetPath, { bigint: true }),
    lstat(stagingPath, { bigint: true })
  ])
  if (
    targetStats.isSymbolicLink() ||
    !targetStats.isFile() ||
    !stagingStats.isFile() ||
    targetStats.dev !== stagingStats.dev ||
    targetStats.ino !== stagingStats.ino
  ) {
    throw new Error(`Published MCP memory target ownership changed before rollback: ${targetPath}`)
  }
  await unlink(targetPath)
}

async function publishValidatedBytes(input: {
  readonly targetPath: string
  readonly targetDir: string
  readonly sourcePath: string
  readonly sourceRoot: string
  readonly capture: LegacyCapture
}): Promise<'published' | 'concurrent-target'> {
  const { targetPath, targetDir, sourcePath, sourceRoot, capture } = input
  const bytes = capture.kind === 'present' ? capture.bytes : EMPTY_MEMORY_BYTES
  const stagingDir = await mkdtemp(path.join(targetDir, '.memory-migration-'))
  await chmod(stagingDir, 0o700)
  const stagingPath = path.join(stagingDir, 'memory.json')
  let linked = false

  try {
    const stagingHandle = await open(
      stagingPath,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o600
    )
    try {
      await stagingHandle.writeFile(bytes)
      await stagingHandle.sync()
    } finally {
      await stagingHandle.close()
    }

    const stagingStats = await lstat(stagingPath)
    if (stagingStats.isSymbolicLink() || !stagingStats.isFile()) {
      throw new Error(`Staged MCP memory must be a real file: ${stagingPath}`)
    }
    const stagedBytes = await readFile(stagingPath)
    if (!stagedBytes.equals(bytes)) {
      throw new Error(`Staged MCP memory verification failed: ${stagingPath}`)
    }
    validateMemoryBytes(stagedBytes, stagingPath)

    await memoryFileMigrationHooks.beforePublish(targetPath)
    await assertSafeSourceAncestors(sourceRoot, sourcePath)
    await assertLegacyCaptureStable(sourcePath, capture, 'before publication')
    try {
      // Hard-link publication is atomic and fails rather than replacing a
      // target that appeared after the initial existence check.
      await memoryFileMigrationHooks.hardLink(stagingPath, targetPath)
      linked = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      if (!(await assertRealTargetFile(targetPath))) {
        throw new Error(`Concurrent MCP memory target disappeared before validation: ${targetPath}`)
      }
      return 'concurrent-target'
    }

    try {
      await memoryFileMigrationHooks.afterPublish(targetPath)
      await assertSafeSourceAncestors(sourceRoot, sourcePath)
      await assertLegacyCaptureStable(sourcePath, capture, 'during publication')
    } catch (error) {
      let rolledBack = true
      await removePublishedTargetIfOwned(targetPath, stagingPath).catch((rollbackError) => {
        rolledBack = false
        logger.warn('Could not roll back a drifted MCP memory publication', rollbackError as Error, { targetPath })
      })
      await fsyncDirectory(targetDir).catch(() => {})
      if (rolledBack) linked = false
      throw error
    }

    await fsyncDirectory(targetDir).catch((error) => {
      // `link()` is the no-clobber commit point. A later durability warning
      // cannot deny a target that is already visible and complete.
      logger.warn('MCP memory published but parent directory fsync failed', error as Error, { targetPath })
    })
    return 'published'
  } finally {
    await memoryFileMigrationHooks.removeStaging(stagingDir).catch((error) => {
      logger.warn('Could not clean MCP memory migration staging', error as Error, {
        targetPath,
        committed: linked
      })
    })
  }
}

/**
 * Move the default built-in MCP memory graph into the active profile without
 * overwriting either side. The legacy CHERRY_HOME source is intentionally
 * retained: this is an additive one-time adoption, not a destructive move.
 *
 * If neither file exists, initialize the new profile-owned file so every Full
 * snapshot has an explicit empty graph rather than a permanent degradation.
 */
export async function ensureMcpMemoryFile(input: {
  readonly legacyPath: string
  readonly legacyRoot: string
  readonly targetPath: string
  readonly profileRoot: string
}): Promise<McpMemoryFileMigrationResult> {
  const targetDir = await ensureSafeTargetParent(input.profileRoot, input.targetPath)
  if (await assertRealTargetFile(input.targetPath)) return 'already-present'

  await assertSafeSourceAncestors(input.legacyRoot, input.legacyPath)
  const capture = await readStableLegacyFile(input.legacyPath)
  const publish = await publishValidatedBytes({
    targetPath: input.targetPath,
    targetDir,
    sourcePath: input.legacyPath,
    sourceRoot: input.legacyRoot,
    capture
  })
  if (publish === 'concurrent-target') return 'concurrent-target'
  return capture.kind === 'absent' ? 'initialized' : 'migrated'
}
