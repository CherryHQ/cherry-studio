/**
 * `mini_app` authoring tool core (issue #21646, stage 2) — runtime-agnostic.
 *
 * One tool, four actions:
 *
 *   - `validate` checks a `.miniapp` package the session produced and returns an
 *     `artifactToken` binding the package bytes (SHA-256) to THIS chat session.
 *     Only paths under the request's workspace roots validate at all: the agent
 *     may only preview what its own session could have written. A token from
 *     another session, or a package whose bytes changed since validation, is
 *     refused by the preview service at open time.
 *   - `preview` opens the validated package as an isolated preview run
 *     (`MiniAppPreviewService`): real protocol, CSP, bridge and network policy,
 *     own partition and temporary tree, and automatic replacement of the
 *     session's previous preview.
 *   - `status` lists the session's live previews (or one by id).
 *   - `close` closes one preview, or every preview the session owns when no id is
 *     given — session teardown in tool form.
 *
 * `install` and `pin` are deliberately ABSENT: they are stage 3's consent-driven
 * flow, and an action that does not exist is the strongest form of "automation
 * cannot approve installation consent" (AC6).
 *
 * Stage 3 adds the repair cap (AC9): three consecutive failed validations of the
 * SAME package block it — validate answers with the failure evidence and recovery
 * steps, and the consent surfaces refuse install for it until one validation
 * succeeds. Session teardown clears the count with the tokens.
 *
 * Every failure returns `{ error, code? }` — never throws — so the model can tell
 * "refused" apart from "broke", mirroring the knowledge lookup core.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import * as z from 'zod'

import { application } from '@application'
import { loggerService } from '@logger'
import { ArtifactTokenError } from '@main/features/miniApp/preview/artifactTokens'
import { MiniAppPreviewError } from '@main/features/miniApp/preview/MiniAppPreviewService'

import { previewMiniAppArchive } from '../../features/miniApp/install/archive'
import { issueArtifactToken } from '../../features/miniApp/preview/artifactTokens'
import {
  getRepairBlocked,
  isRepairBlocked,
  noteValidationFailure,
  noteValidationSuccess,
  type RepairBlocked
} from '../../features/miniApp/preview/repairRounds'

const logger = loggerService.withContext('MiniAppAuthoring')

export const MINI_APP_TOOL_NAME = 'mini_app'

export const MINI_APP_DESCRIPTION = `Validate, preview, inspect and close agent-authored Mini Apps. validate a .miniapp package under the session workspace first, then preview with the returned artifactToken. status lists live previews; close ends one preview or all of the session's.`

/** What the tool layer threads in from the request context. */
export interface MiniAppAuthoringContext {
  /** The chat session that owns previews and tokens. Absent for synthetic invocations. */
  readonly sessionId?: string
  /** Workspace roots the request may read; `validate` never leaves them. */
  readonly roots?: ReadonlyArray<{ uri: string; name?: string }>
}

export const miniAppAuthoringInputSchema = z.discriminatedUnion('action', [
  z.strictObject({
    action: z.literal('validate'),
    packagePath: z.string().min(1).describe('Absolute path of the .miniapp package to validate')
  }),
  z.strictObject({
    action: z.literal('preview'),
    artifactToken: z.string().min(1).describe('Token returned by validate')
  }),
  z.strictObject({
    action: z.literal('status'),
    previewId: z.string().optional().describe('One preview to inspect; omit to list the session’s previews')
  }),
  z.strictObject({
    action: z.literal('close'),
    previewId: z.string().optional().describe('One preview to close; omit to close every preview of the session')
  })
])
export type MiniAppAuthoringInput = z.infer<typeof miniAppAuthoringInputSchema>

export const miniAppPreviewSummarySchema = z.object({
  previewId: z.string(),
  runtimeId: z.string(),
  sessionId: z.string(),
  appId: z.string(),
  version: z.string(),
  packageSha256: z.string(),
  openedAt: z.number()
})

const validateOutputSchema = z.object({
  artifactToken: z.string(),
  appId: z.string(),
  version: z.string(),
  name: z.string(),
  sha256: z.string(),
  size: z.number()
})

const statusOutputSchema = z.object({ previews: z.array(miniAppPreviewSummarySchema) })

/**
 * AC9: the third consecutive failed validation of one package. Not an error — a
 * verdict carrying the evidence and the recovery steps, so the session can stop
 * and hand both back instead of burning a fourth round.
 */
const repairBlockedOutputSchema = z.object({
  status: z.literal('repair-blocked'),
  rounds: z.number(),
  evidence: z.array(z.string()),
  recovery: z.array(z.string())
})
const closeOutputSchema = z.object({ closed: z.number(), tokensRevoked: z.number() })

export const miniAppAuthoringErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional()
})
export type MiniAppAuthoringError = z.infer<typeof miniAppAuthoringErrorSchema>

export const miniAppAuthoringOutputSchema = z.union([
  validateOutputSchema,
  miniAppPreviewSummarySchema,
  statusOutputSchema,
  closeOutputSchema,
  repairBlockedOutputSchema,
  miniAppAuthoringErrorSchema
])
export type MiniAppAuthoringOutput = z.infer<typeof miniAppAuthoringOutputSchema>

function failure(message: string, code?: string): MiniAppAuthoringError {
  return code === undefined ? { error: message } : { error: message, code }
}

function requireSession(ctx: MiniAppAuthoringContext): string | MiniAppAuthoringError {
  if (!ctx.sessionId) {
    return failure('The mini_app tool needs a chat session; this invocation has none', 'no-session')
  }
  return ctx.sessionId
}

/**
 * The request's workspace roots as absolute filesystem paths. A root that does not
 * resolve still authorizes by its literal path — a symlinked WORKSPACE must not
 * reject the session's own artifacts, and a nonexistent one authorizes nothing.
 */
function authorizedRoots(ctx: MiniAppAuthoringContext): string[] {
  const roots: string[] = []
  for (const root of ctx.roots ?? []) {
    let p: string
    try {
      p = root.uri.startsWith('file://') ? fileURLToPath(root.uri) : root.uri
    } catch {
      continue
    }
    try {
      roots.push(fs.realpathSync(p))
    } catch {
      // A nonexistent root authorizes nothing, but keep its literal path so a
      // not-yet-created workspace still matches the session's own artifacts.
      roots.push(p)
    }
  }
  return roots
}

/**
 * The package's real path, proven under a workspace root. Symlinks are resolved on
 * BOTH sides: a `..`-free string comparison against unresolved paths is the classic
 * way "the session's own file" turns into "anywhere on disk".
 */
async function resolveAuthorizedPackagePath(packagePath: string, ctx: MiniAppAuthoringContext): Promise<string> {
  if (!path.isAbsolute(packagePath)) {
    throw new Error('packagePath must be absolute')
  }
  const real = await fs.promises.realpath(packagePath)
  const roots = authorizedRoots(ctx)
  const under = roots.some((root) => real === root || real.startsWith(root + path.sep))
  if (!under) {
    throw new Error('The package path is outside this session’s workspace roots')
  }
  return real
}

/**
 * The repair-cap key for a path that may no longer exist: the realpath when it
 * resolves, else the real directory + literal name (a deleted package still keys
 * to its old identity, so a capped artifact stays capped when probed again).
 */
async function artifactKeyFor(packagePath: string): Promise<string> {
  try {
    return await fs.promises.realpath(packagePath)
  } catch {
    try {
      return path.join(await fs.promises.realpath(path.dirname(packagePath)), path.basename(packagePath))
    } catch {
      return path.resolve(packagePath)
    }
  }
}

function repairBlockedOutput(view: RepairBlocked): MiniAppAuthoringOutput {
  return { status: 'repair-blocked', rounds: view.rounds, evidence: [...view.evidence], recovery: [...view.recovery] }
}

export async function validateMiniAppPackage(
  packagePath: string,
  ctx: MiniAppAuthoringContext
): Promise<MiniAppAuthoringOutput> {
  const sessionId = requireSession(ctx)
  if (typeof sessionId !== 'string') return sessionId

  // The cap (AC9) is checked BEFORE the file is touched: re-reading a capped
  // artifact IS the fourth repair round the rule forbids, and a package deleted
  // after capping must still answer with the cap, not a path error.
  const artifactKey = await artifactKeyFor(packagePath)
  const alreadyBlocked = getRepairBlocked(sessionId, artifactKey)
  if (alreadyBlocked) return repairBlockedOutput(alreadyBlocked)

  let real: string
  try {
    real = await resolveAuthorizedPackagePath(packagePath, ctx)
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error), 'path-not-authorized')
  }

  try {
    // The install flow's own reader: entry-table checks, size caps, manifest parse —
    // a package that fails here would fail install later, so validate fails NOW.
    const preview = await previewMiniAppArchive(real)
    const { size } = await fs.promises.stat(real)
    noteValidationSuccess(sessionId, real)
    const record = issueArtifactToken({ sessionId, packagePath: real, sha256: preview.sha256, size })
    logger.info('Validated mini app package', {
      sessionId,
      appId: preview.manifest.id,
      version: preview.manifest.version
    })
    return {
      artifactToken: record.token,
      appId: preview.manifest.id,
      version: preview.manifest.version,
      name: typeof preview.manifest.name === 'string' ? preview.manifest.name : preview.manifest.id,
      sha256: preview.sha256,
      size
    }
  } catch (error) {
    const reason = `Package validation failed: ${error instanceof Error ? error.message : String(error)}`
    const blocked = noteValidationFailure(sessionId, real, reason)
    if (blocked) return repairBlockedOutput(blocked)
    return failure(reason, 'invalid-package')
  }
}

export async function previewValidatedMiniApp(
  artifactToken: string,
  ctx: MiniAppAuthoringContext
): Promise<MiniAppAuthoringOutput> {
  const sessionId = requireSession(ctx)
  if (typeof sessionId !== 'string') return sessionId
  try {
    return await application.get('MiniAppPreviewService').openPreview({ sessionId, artifactToken })
  } catch (error) {
    if (error instanceof ArtifactTokenError || error instanceof MiniAppPreviewError) {
      return failure(error.message, error.code)
    }
    throw error
  }
}

export async function miniAppPreviewStatus(
  previewId: string | undefined,
  ctx: MiniAppAuthoringContext
): Promise<MiniAppAuthoringOutput> {
  const sessionId = requireSession(ctx)
  if (typeof sessionId !== 'string') return sessionId
  const service = application.get('MiniAppPreviewService')
  if (previewId !== undefined) {
    const preview = service.getPreview(previewId)
    // Another session's preview is indistinguishable from a closed one: the tool
    // never confirms the existence of something the session does not own.
    if (!preview || preview.sessionId !== sessionId) {
      return failure('Unknown preview', 'unknown-preview')
    }
    return { previews: [preview] }
  }
  return { previews: service.listSessionPreviews(sessionId) }
}

export async function closeMiniAppPreviews(
  previewId: string | undefined,
  ctx: MiniAppAuthoringContext
): Promise<MiniAppAuthoringOutput> {
  const sessionId = requireSession(ctx)
  if (typeof sessionId !== 'string') return sessionId
  const service = application.get('MiniAppPreviewService')
  try {
    if (previewId !== undefined) {
      const before = service.listSessionPreviews(sessionId).length
      await service.closePreview(previewId, sessionId)
      const after = service.listSessionPreviews(sessionId).length
      return { closed: before - after, tokensRevoked: 0 }
    }
    return await service.closeSessionPreviews(sessionId)
  } catch (error) {
    if (error instanceof MiniAppPreviewError) return failure(error.message, error.code)
    throw error
  }
}

/** The stage-3 consent surfaces refuse install for a capped artifact (AC9). */
export function isArtifactRepairBlocked(sessionId: string, packagePath: string): boolean {
  return isRepairBlocked(sessionId, packagePath)
}

export async function runMiniAppAuthoring(
  input: MiniAppAuthoringInput,
  ctx: MiniAppAuthoringContext
): Promise<MiniAppAuthoringOutput> {
  switch (input.action) {
    case 'validate':
      return validateMiniAppPackage(input.packagePath, ctx)
    case 'preview':
      return previewValidatedMiniApp(input.artifactToken, ctx)
    case 'status':
      return miniAppPreviewStatus(input.previewId, ctx)
    case 'close':
      return closeMiniAppPreviews(input.previewId, ctx)
  }
}
