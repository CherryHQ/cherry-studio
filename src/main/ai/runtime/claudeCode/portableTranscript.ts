import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { loggerService } from '@logger'
import {
  decodePortableAgentResumePoint,
  isPortableAgentResumeToken,
  type PortableAgentResumePoint
} from '@main/ai/agents/portableProfilePolicy'
import { atomicWriteFile, ensureDir, exists, read } from '@main/utils/file'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import Database from 'better-sqlite3'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'

const logger = loggerService.withContext('portableTranscript')

const CLAUDE_PROJECT_DIR_MAX_LENGTH = 200

function asAbsolutePath(value: string): AbsoluteFilePath {
  return AbsoluteFilePathSchema.parse(value)
}

/**
 * The SDK's cwd → `projects/<dir>` sanitizer, byte-for-byte (verified against
 * @anthropic-ai/claude-agent-sdk 0.3.218 `sdk.mjs`): strip to `[a-zA-Z0-9]`
 * with `-`, and past 200 chars truncate plus a base36 `h*31+c` hash of the
 * full path. A canary test pins this against SDK upgrades.
 */
export function encodeClaudeProjectDir(cwd: string): string {
  const sanitized = cwd.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= CLAUDE_PROJECT_DIR_MAX_LENGTH) return sanitized
  let hash = 0
  for (let i = 0; i < cwd.length; i++) hash = ((hash << 5) - hash + cwd.charCodeAt(i)) | 0
  return `${sanitized.slice(0, CLAUDE_PROJECT_DIR_MAX_LENGTH)}-${Math.abs(hash).toString(36)}`
}

/**
 * Find the SDK-owned transcript for one session id. The encoded-cwd path is
 * only a hint: SDK session ids are UUIDs, so when the encoding drifts (SDK
 * upgrade, path normalization) a one-level scan of `projects/` still finds the
 * unique `<sessionId>.jsonl` and export does not depend on the encoding.
 */
async function locateSdkTranscript(
  projectsRoot: string,
  cwd: string | null,
  sdkSessionId: string
): Promise<string | null> {
  const fileName = `${sdkSessionId}.jsonl`
  if (cwd) {
    const exact = path.join(projectsRoot, encodeClaudeProjectDir(cwd), fileName)
    if (await exists(asAbsolutePath(exact))) return exact
  }
  let entries: string[]
  try {
    entries = await fs.readdir(projectsRoot)
  } catch {
    return null
  }
  for (const entry of entries) {
    const candidate = path.join(projectsRoot, entry, fileName)
    if (await exists(asAbsolutePath(candidate))) return candidate
  }
  return null
}

/**
 * Cut the live JSONL at the committed Turn boundary. Everything after the
 * anchor line — including a torn tail the subprocess is still appending — is
 * the next backup's business, so a concurrently running session captures
 * cleanly without any runtime coordination.
 */
export function truncateTranscriptAtBoundary(raw: string, resumeSessionAt: string | undefined): string {
  const lines = raw.split('\n')
  const kept: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === '') continue
    let uuid: unknown
    try {
      uuid = (JSON.parse(line) as { uuid?: unknown }).uuid
    } catch {
      const isTail = lines.slice(i + 1).every((rest) => rest === '')
      if (isTail) break
      throw new Error('Agent transcript is corrupt before its retained Turn boundary')
    }
    kept.push(line)
    if (resumeSessionAt !== undefined && uuid === resumeSessionAt) {
      return `${kept.join('\n')}\n`
    }
  }
  if (resumeSessionAt !== undefined) {
    throw new Error('Agent transcript does not contain its retained Turn boundary')
  }
  if (kept.length === 0) {
    throw new Error('Agent transcript has no complete entries')
  }
  return `${kept.join('\n')}\n`
}

interface DetachedResumeRow {
  readonly token: string | null
  readonly workspacePath: string | null
}

/**
 * Read through the Drizzle schema rather than hand-written SQL: these column
 * names are the only thing tying this owner to the detached database, so a
 * rename must fail at typecheck instead of at export time.
 */
function readDetachedResumeRow(detachedDbPath: string, hostSessionId: string): DetachedResumeRow {
  const sqlite = new Database(detachedDbPath, { fileMustExist: true, readonly: true })
  try {
    const db = drizzle({ client: sqlite, casing: 'snake_case' })
    const tokenRow = db
      .select({ runtimeResumeToken: agentSessionMessageTable.runtimeResumeToken })
      .from(agentSessionMessageTable)
      .where(
        and(
          eq(agentSessionMessageTable.sessionId, hostSessionId),
          isNotNull(agentSessionMessageTable.runtimeResumeToken)
        )
      )
      .orderBy(desc(agentSessionMessageTable.createdAt))
      .limit(1)
      .get()
    const workspaceRow = db
      .select({ workspacePath: agentWorkspaceTable.path })
      .from(agentSessionTable)
      .leftJoin(agentWorkspaceTable, eq(agentWorkspaceTable.id, agentSessionTable.workspaceId))
      .where(eq(agentSessionTable.id, hostSessionId))
      .get()
    return {
      token: tokenRow?.runtimeResumeToken ?? null,
      workspacePath: workspaceRow?.workspacePath ?? null
    }
  } finally {
    sqlite.close()
  }
}

/**
 * Produce the portable transcript snapshot for one owner-snapshot requirement.
 *
 * Backup supplies only paths and the detached DB; Agent owns the table lookup,
 * the SDK `projects/` layout, and the Turn-boundary cut. The anchor comes from
 * the detached database, so the staged bytes always match the resume point the
 * archive's database retains — a session that kept running after the snapshot
 * is truncated back to that committed boundary. A failure here fails the
 * export: a retained token without its transcript has no safe fallback.
 */
export async function stagePortableAgentTranscript(input: {
  readonly detachedDbPath: string
  readonly transcriptRoot: string
  readonly agentRuntimeConfigRoot: string
  readonly sourcePath: string
  readonly stagedPath: string
}): Promise<void> {
  const root = path.resolve(input.transcriptRoot)
  const source = path.resolve(input.sourcePath)
  if (path.dirname(source) !== root || path.extname(source) !== '.jsonl') {
    throw new Error('Portable Agent transcript is outside its owner-managed root')
  }
  const hostSessionId = path.basename(source, '.jsonl')

  const row = readDetachedResumeRow(input.detachedDbPath, hostSessionId)
  if (!isPortableAgentResumeToken(row.token)) {
    throw new Error('Detached Agent session has no portable resume point')
  }
  const point = decodePortableAgentResumePoint(row.token)
  if (!point) throw new Error('Detached Agent session has no portable resume point')

  const sdkTranscriptPath = await locateSdkTranscript(
    path.join(input.agentRuntimeConfigRoot, 'projects'),
    row.workspacePath,
    point.sessionId
  )
  if (!sdkTranscriptPath) {
    throw new Error('Agent session transcript was not found under the SDK projects root')
  }

  const raw = await read(asAbsolutePath(sdkTranscriptPath), { encoding: 'text' })
  const truncated = truncateTranscriptAtBoundary(raw, point.resumeSessionAt)
  await atomicWriteFile(asAbsolutePath(input.stagedPath), truncated, { mode: 0o600, directorySync: 'required' })
}

/**
 * Make a restored session's transcript visible to the SDK before it spawns.
 *
 * Restore installs transcripts at the workspace-independent canonical root;
 * the SDK reads `projects/<encoded cwd>/<sdkSessionId>.jsonl`. This projects
 * the canonical bytes to the SDK location once, on the session's first warmup
 * after a restore. Soft-fail by design: a failed projection degrades resume to
 * a fresh session and must never block the connection.
 */
export async function projectRestoredAgentTranscript(input: {
  readonly hostSessionId: string
  readonly cwd: string
  readonly resumePoint: PortableAgentResumePoint
}): Promise<void> {
  try {
    const sdkTranscriptPath = path.join(
      application.getPath('feature.agents.claude.root'),
      'projects',
      encodeClaudeProjectDir(input.cwd),
      `${input.resumePoint.sessionId}.jsonl`
    )
    if (await exists(asAbsolutePath(sdkTranscriptPath))) return

    const canonicalPath = path.join(application.getPath('feature.agents.transcripts'), `${input.hostSessionId}.jsonl`)
    if (!(await exists(asAbsolutePath(canonicalPath)))) return

    const content = await read(asAbsolutePath(canonicalPath), { encoding: 'text' })
    await ensureDir(asAbsolutePath(path.dirname(sdkTranscriptPath)))
    await atomicWriteFile(asAbsolutePath(sdkTranscriptPath), content, { mode: 0o600, directorySync: 'required' })
    logger.info('Projected restored agent transcript for resume', { hostSessionId: input.hostSessionId })
  } catch (error) {
    logger.warn('Could not project restored agent transcript; resume will start fresh', error as Error, {
      hostSessionId: input.hostSessionId
    })
  }
}
