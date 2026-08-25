import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'

const CLAUDE_PROJECT_DIRECTORY_NAME_MAX_LENGTH = 200

function claudeProjectDirectoryNameHash(workspacePath: string): string {
  let hash = 0
  for (let index = 0; index < workspacePath.length; index++) {
    hash = ((hash << 5) - hash + workspacePath.charCodeAt(index)) | 0
  }
  return Math.abs(hash).toString(36)
}

/** Mirror the Claude Agent SDK's private cwd-to-project-directory mapping for stored transcripts. */
export function claudeProjectDirectoryName(workspacePath: string): string {
  const sanitized = workspacePath.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= CLAUDE_PROJECT_DIRECTORY_NAME_MAX_LENGTH) return sanitized
  return `${sanitized.slice(0, CLAUDE_PROJECT_DIRECTORY_NAME_MAX_LENGTH)}-${claudeProjectDirectoryNameHash(workspacePath)}`
}

async function lstatIfExists(targetPath: string) {
  try {
    return await lstat(targetPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function ensureRegularDirectory(targetPath: string): Promise<boolean> {
  if (!(await lstatIfExists(targetPath))) {
    try {
      await mkdir(targetPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }

  const targetStat = await lstatIfExists(targetPath)
  return Boolean(targetStat?.isDirectory() && !targetStat.isSymbolicLink())
}

async function resolvedWorkspacePath(workspacePath: string): Promise<string> {
  try {
    return path.normalize(await realpath(workspacePath))
  } catch {
    return path.resolve(workspacePath)
  }
}

function isSafeResumeToken(runtimeResumeToken: string): boolean {
  return runtimeResumeToken.length > 0 && /^[a-zA-Z0-9_-]+$/.test(runtimeResumeToken)
}

export type ClaudeTranscriptAvailability = 'present' | 'copied' | 'missing' | 'unsafe'

/**
 * Make a restored Claude transcript visible under the current workspace key.
 * Existing destinations are never overwritten, and symbolic links are ignored.
 */
export async function ensureTranscriptAvailableForWorkspace(
  claudeRoot: string,
  workspacePath: string,
  runtimeResumeToken: string
): Promise<ClaudeTranscriptAvailability> {
  if (!isSafeResumeToken(runtimeResumeToken)) return 'unsafe'

  const projectsDirectory = path.join(claudeRoot, 'projects')
  const projectsStat = await lstatIfExists(projectsDirectory)
  if (!projectsStat?.isDirectory() || projectsStat.isSymbolicLink()) return 'missing'

  const projectDirectory = path.join(
    projectsDirectory,
    claudeProjectDirectoryName(await resolvedWorkspacePath(workspacePath))
  )
  const destinationPath = path.join(projectDirectory, `${runtimeResumeToken}.jsonl`)
  const destinationStat = await lstatIfExists(destinationPath)
  if (destinationStat?.isFile() && !destinationStat.isSymbolicLink()) return 'present'
  if (destinationStat) return 'unsafe'

  let sourcePath: string | undefined
  const projectEntries = await readdir(projectsDirectory, { withFileTypes: true })
  projectEntries.sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of projectEntries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const candidateDirectory = path.join(projectsDirectory, entry.name)
    if (path.resolve(candidateDirectory) === path.resolve(projectDirectory)) continue
    const candidatePath = path.join(candidateDirectory, `${runtimeResumeToken}.jsonl`)
    const candidateStat = await lstatIfExists(candidatePath)
    if (candidateStat?.isFile() && !candidateStat.isSymbolicLink()) {
      sourcePath = candidatePath
      break
    }
  }
  if (!sourcePath) return 'missing'

  if (!(await ensureRegularDirectory(projectDirectory))) return 'unsafe'

  try {
    await copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL)
    return 'copied'
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const racedDestinationStat = await lstatIfExists(destinationPath)
    return racedDestinationStat?.isFile() && !racedDestinationStat.isSymbolicLink() ? 'present' : 'unsafe'
  }
}
