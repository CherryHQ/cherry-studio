import { ipcApi } from '@renderer/ipc'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { canonicalizeFilePath, createFilePathHandle, sanitizeFilename } from '@shared/utils/file'

const WINDOWS_DRIVE_PATH = /^[A-Za-z]:[/\\]/
const MAX_DESTINATION_ATTEMPTS = 100

function joinWorkspacePath(workspacePath: AbsoluteFilePath, filename: string): AbsoluteFilePath {
  const separator = WINDOWS_DRIVE_PATH.test(workspacePath) ? '\\' : '/'
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

export type WorkspaceCopyReservation = {
  reservedDestinations: Set<string>
}

/** Copy an external attachment into the agent workspace without overwriting existing files. */
export async function copyAttachmentToWorkspace(
  sourcePath: AbsoluteFilePath,
  workspacePath: AbsoluteFilePath,
  preferredName: string,
  reservation?: WorkspaceCopyReservation
): Promise<AbsoluteFilePath> {
  const sanitized = sanitizeFilename(preferredName)
  for (let attempt = 0; attempt < MAX_DESTINATION_ATTEMPTS; attempt++) {
    const candidateName = withConflictSuffix(sanitized, attempt)
    const destPath = joinWorkspacePath(workspacePath, candidateName)
    const destKey = canonicalizeFilePath(destPath)
    if (reservation?.reservedDestinations.has(destKey)) continue
    if (await destinationExists(destPath)) continue
    await ipcApi.request('file.copy', { sourcePath, destPath })
    reservation?.reservedDestinations.add(destKey)
    return destKey
  }
  throw new Error(`Failed to copy attachment into workspace: ${preferredName}`)
}
