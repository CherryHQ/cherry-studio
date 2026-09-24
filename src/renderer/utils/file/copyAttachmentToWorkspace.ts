import { ipcApi } from '@renderer/ipc'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { canonicalizeFilePath, createFilePathHandle, sanitizeFilename } from '@shared/utils/file'

const WINDOWS_PATH = /^([A-Za-z]:[/\\]|\\\\)/
const MAX_DESTINATION_ATTEMPTS = 100

function joinWorkspacePath(workspacePath: AbsoluteFilePath, filename: string): AbsoluteFilePath {
  const separator = WINDOWS_PATH.test(workspacePath) ? '\\' : '/'
  const base = workspacePath.endsWith('/') || workspacePath.endsWith('\\') ? workspacePath.slice(0, -1) : workspacePath
  return AbsoluteFilePathSchema.parse(`${base}${separator}${filename}`)
}

function withConflictSuffix(filename: string, index: number): string {
  if (index === 0) return filename
  const dotIndex = filename.lastIndexOf('.')
  if (dotIndex <= 0) return `${filename} (${index})`
  return `${filename.slice(0, dotIndex)} (${index})${filename.slice(dotIndex)}`
}

async function destinationExists(destPath: AbsoluteFilePath): Promise<boolean> {
  const metadata = await ipcApi.request('file.get_metadata', createFilePathHandle(destPath))
  return metadata !== null
}

function destinationIdentity(destPath: AbsoluteFilePath): string {
  try {
    return canonicalizeFilePath(destPath)
  } catch {
    return destPath
  }
}

function destinationReference(destPath: AbsoluteFilePath): AbsoluteFilePath {
  try {
    return canonicalizeFilePath(destPath)
  } catch {
    return destPath
  }
}

export type WorkspaceCopyReservation = {
  reservedDestinations: Set<string>
}

export type WorkspaceCopyResult = {
  reference: AbsoluteFilePath
  destPath: AbsoluteFilePath
}

/** Best-effort cleanup of workspace copies when a batched send fails mid-copy. */
export async function rollbackWorkspaceCopies(paths: readonly AbsoluteFilePath[]): Promise<void> {
  for (const path of paths) {
    try {
      await ipcApi.request('file.unlink', { path })
    } catch {
      // Preserve the original send failure; cleanup is best-effort.
    }
  }
}

/** Copy an external attachment into the agent workspace without overwriting existing files. */
export async function copyAttachmentToWorkspace(
  sourcePath: AbsoluteFilePath,
  workspacePath: AbsoluteFilePath,
  preferredName: string,
  reservation?: WorkspaceCopyReservation
): Promise<WorkspaceCopyResult> {
  const sanitized = sanitizeFilename(preferredName)
  for (let attempt = 0; attempt < MAX_DESTINATION_ATTEMPTS; attempt++) {
    const candidateName = withConflictSuffix(sanitized, attempt)
    const destPath = joinWorkspacePath(workspacePath, candidateName)
    const destKey = destinationIdentity(destPath)
    if (reservation?.reservedDestinations.has(destKey)) continue
    if (await destinationExists(destPath)) continue
    await ipcApi.request('file.copy', { sourcePath, destPath })
    reservation?.reservedDestinations.add(destKey)
    return { reference: destinationReference(destPath), destPath }
  }
  throw new Error(`Failed to copy attachment into workspace: ${preferredName}`)
}
