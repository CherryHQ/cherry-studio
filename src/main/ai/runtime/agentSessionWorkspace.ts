import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { assertAgentStoragePath, ensureAgentStorageDirectory } from '@main/ai/agents/agentDataDirectory'
import { t } from '@main/i18n'
import {
  canonicalizePathForContainment,
  getPathStatus,
  isOutsidePath,
  isSameFile,
  lstat,
  type PathStatus
} from '@main/utils/file'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import { AbsoluteFilePathSchema } from '@shared/types/file'

const logger = loggerService.withContext('AgentSessionWorkspace')
const WORKSPACE_PROBE_TIMEOUT_MS = 5_000
const RETRYABLE_WORKSPACE_ERROR_CODES = new Set(['EBUSY', 'EIO', 'EMFILE', 'ENFILE', 'ENOSPC', 'ESTALE', 'ETIMEDOUT'])
const workspacePathProbes = new Map<string, Promise<PathStatus>>()

export class AgentSessionWorkspaceError extends Error {
  constructor(
    message: string,
    readonly retryable = false
  ) {
    super(message)
    this.name = 'AgentSessionWorkspaceError'
  }
}

export function isAgentSessionWorkspaceError(error: unknown): error is AgentSessionWorkspaceError {
  return error instanceof AgentSessionWorkspaceError
}

export async function prepareAgentSessionWorkspaceDirectory(session: AgentSessionEntity): Promise<void> {
  const workspace = session.workspace
  switch (workspace.type) {
    case AGENT_WORKSPACE_TYPE.SYSTEM:
      // System workspaces are app-owned session directories; user workspaces
      // must already exist, so auto-creating them would mask a bad user path.
      await ensureSystemWorkspaceDirectory(session.id, workspace.path)
      break
    case AGENT_WORKSPACE_TYPE.USER:
      break
    default: {
      const exhaustive: never = workspace.type
      throw new AgentSessionWorkspaceError(`Unsupported workspace type: ${String(exhaustive)}`)
    }
  }
  await assertAgentSessionWorkspaceDirectory(session.id, workspace.path)
}

async function ensureSystemWorkspaceDirectory(sessionId: string, cwd: string): Promise<void> {
  const root = path.resolve(application.getPath('feature.agents.system_workspaces'))
  const target = path.resolve(cwd)
  let canonicalRoot: string | undefined
  let canonicalTarget: string | undefined
  let sourceRoot: string | undefined
  let stage = 'absolute-path'
  const unconfirmed = () =>
    new AgentSessionWorkspaceError(
      workspaceCheckErrorMessage(sessionId, t('agent.session.workspace_status.outside_managed_root', { path: cwd }))
    )
  try {
    if (!path.isAbsolute(cwd)) throw unconfirmed()
    stage = 'prepare-root'
    await ensureAgentStorageDirectory(root, root)
    stage = 'canonicalize'
    canonicalRoot = await canonicalizePathForContainment(root, { allowMissing: false })
    if (canonicalRoot === undefined) throw unconfirmed()
    canonicalTarget = await canonicalizePathForContainment(target, { allowMissing: true })
    stage = 'find-source-root'
    for (let candidate = path.dirname(target); ; candidate = path.dirname(candidate)) {
      const canonicalCandidate = await canonicalizePathForContainment(candidate, { allowMissing: false })
      if (
        canonicalCandidate === canonicalRoot ||
        (await isSameFile(AbsoluteFilePathSchema.parse(candidate), AbsoluteFilePathSchema.parse(root)))
      ) {
        sourceRoot = candidate
        break
      }
      if (canonicalCandidate === undefined) {
        try {
          await lstat(AbsoluteFilePathSchema.parse(candidate))
          throw unconfirmed()
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      if (path.dirname(candidate) === candidate) break
    }
    if (!sourceRoot) throw unconfirmed()
    const suffix = path.relative(sourceRoot, target)
    if (!suffix || isOutsidePath(suffix)) throw unconfirmed()
    stage = 'original-path-guard'
    await assertAgentStoragePath(sourceRoot, target)
    const storageTarget = path.join(canonicalRoot, suffix)
    stage = 'prepare-target'
    await ensureAgentStorageDirectory(canonicalRoot, storageTarget)
    stage = 'verify-identity'
    await assertAgentStoragePath(sourceRoot, target)
    await assertAgentStoragePath(root, root)
    if (
      !(await isSameFile(AbsoluteFilePathSchema.parse(root), AbsoluteFilePathSchema.parse(sourceRoot))) ||
      !(await isSameFile(AbsoluteFilePathSchema.parse(storageTarget), AbsoluteFilePathSchema.parse(target)))
    ) {
      throw unconfirmed()
    }
  } catch (error) {
    logger.warn('Failed to validate or create system workspace directory', {
      sessionId,
      root,
      target,
      cwd,
      canonicalRoot,
      canonicalTarget,
      sourceRoot,
      stage,
      error
    })
    if (isAgentSessionWorkspaceError(error)) throw error
    throw new AgentSessionWorkspaceError(
      workspaceCheckErrorMessage(sessionId, workspacePathErrorMessage(cwd, { ok: false, reason: 'inaccessible' })),
      isRetryableWorkspaceErrorCode((error as NodeJS.ErrnoException)?.code)
    )
  }
}

export async function assertAgentSessionWorkspaceDirectory(sessionId: string, cwd: string): Promise<void> {
  const status = await getWorkspacePathStatus(cwd)
  if (status.ok && status.kind === 'directory') return
  logger.warn('Agent session workspace invalid', { sessionId, cwd, stage: 'probe', status })
  throw new AgentSessionWorkspaceError(
    workspaceCheckErrorMessage(sessionId, workspacePathErrorMessage(cwd, status)),
    !status.ok && status.reason === 'inaccessible' && isRetryableWorkspaceErrorCode(status.code)
  )
}

async function getWorkspacePathStatus(cwd: string): Promise<PathStatus> {
  // Node's stat is not abortable; the race bounds scheduler ownership even if the OS call lingers.
  let probe = workspacePathProbes.get(cwd)
  if (!probe) {
    probe = getPathStatus(cwd).finally(() => {
      if (workspacePathProbes.get(cwd) === probe) workspacePathProbes.delete(cwd)
    })
    workspacePathProbes.set(cwd, probe)
  }
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timeoutResult = new Promise<PathStatus>((resolve) => {
    timeout = setTimeout(
      () => resolve({ ok: false, reason: 'inaccessible', code: 'ETIMEDOUT' }),
      WORKSPACE_PROBE_TIMEOUT_MS
    )
    timeout.unref?.()
  })
  try {
    return await Promise.race([probe, timeoutResult])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function isRetryableWorkspaceErrorCode(code: string | undefined): boolean {
  return code !== undefined && RETRYABLE_WORKSPACE_ERROR_CODES.has(code)
}

function workspacePathErrorMessage(workspacePath: string, status: PathStatus): string {
  if (status.ok) {
    return t('agent.session.workspace_status.not_directory', { path: workspacePath })
  }
  return status.reason === 'missing'
    ? t('agent.session.workspace_status.missing', { path: workspacePath })
    : t('agent.session.workspace_status.inaccessible', { path: workspacePath })
}

function workspaceCheckErrorMessage(sessionId: string, detail: string): string {
  return t('agent.session.workspace_status.check_failed', { sessionId, detail })
}
