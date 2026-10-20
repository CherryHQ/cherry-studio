import path from 'node:path'

import { application } from '@application'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'

import { safeOpen } from '../system'

function expandHomePath(rawPath: string): string {
  if (!rawPath.startsWith('~/') && !rawPath.startsWith('~\\')) return rawPath
  return path.join(application.getPath('sys.home'), rawPath.slice(2))
}

function unavailableTarget(rawPath: string, reason: 'relative' | 'invalid'): IpcError {
  return new IpcError(fileErrorCodes.OPEN_TARGET_UNAVAILABLE, `Refusing to open an unusable path: ${rawPath}`, {
    path: rawPath,
    reason
  })
}

/**
 * Turn a renderer-supplied path text into the absolute path to open.
 *
 * A relative path is resolved against `workspaceRoot`, and only against it — the process cwd is
 * meaningless in a packaged app, so without a root the input is an error rather than a guess. No
 * workspace containment is applied on purpose: the artifact pane's contract lets an agent write
 * outside its workspace.
 */
export function resolveRequestedPath(rawPath: string, workspaceRoot?: AbsoluteFilePath): AbsoluteFilePath {
  const expanded = expandHomePath(rawPath.trim())
  if (!expanded) throw unavailableTarget(rawPath, 'invalid')

  // An unusable root is dropped, not trusted: resolving against a relative one would silently
  // point at whatever the cwd happens to be.
  const root = workspaceRoot && AbsoluteFilePathSchema.safeParse(workspaceRoot).success ? workspaceRoot : undefined
  const absolute = path.isAbsolute(expanded) ? expanded : root ? path.resolve(root, expanded) : null
  if (!absolute) throw unavailableTarget(rawPath, 'relative')

  const parsed = AbsoluteFilePathSchema.safeParse(absolute)
  if (!parsed.success) throw unavailableTarget(rawPath, 'invalid')
  return parsed.data
}

/**
 * Open a renderer-supplied path with the system default app.
 *
 * Every raw-path entry point (the legacy `file:openPath` channel, `system.shell.open_path`, the
 * session-scoped agent route) funnels through here, so an unusable path can never reach
 * `shell.openPath` — see `assertOpenableTarget` for why that matters on Linux.
 */
export async function openRequestPath(rawPath: string, workspaceRoot?: AbsoluteFilePath): Promise<void> {
  return safeOpen(resolveRequestedPath(rawPath, workspaceRoot))
}
