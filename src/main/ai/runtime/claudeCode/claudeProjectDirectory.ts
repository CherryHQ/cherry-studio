import { createHash, randomUUID } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { copyFile, link, lstat, mkdir, readdir, realpath, unlink } from 'node:fs/promises'
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

export interface ClaudeTranscriptSource {
  transcriptPath: string
  modifiedAtMs: number
}

export async function existingClaudeProjectsDirectories(projectsDirectories: string[]): Promise<string[]> {
  const existingDirectories: string[] = []
  const seenDirectories = new Set<string>()
  for (const projectsDirectory of projectsDirectories) {
    const normalizedProjectsDirectory = path.resolve(projectsDirectory)
    if (seenDirectories.has(normalizedProjectsDirectory)) continue
    seenDirectories.add(normalizedProjectsDirectory)
    const projectsStat = await lstatIfExists(normalizedProjectsDirectory)
    if (projectsStat?.isDirectory() && !projectsStat.isSymbolicLink())
      existingDirectories.push(normalizedProjectsDirectory)
  }
  return existingDirectories
}

export async function claudeProjectDirectoryPath(projectsDirectory: string, workspacePath: string): Promise<string> {
  return path.join(projectsDirectory, claudeProjectDirectoryName(await resolvedWorkspacePath(workspacePath)))
}

export async function expectedClaudeProjectDirectories(
  projectsDirectories: string[],
  workspacePath: string
): Promise<string[]> {
  const projectDirectoryName = claudeProjectDirectoryName(await resolvedWorkspacePath(workspacePath))
  const existingDirectories: string[] = []
  for (const projectsDirectory of projectsDirectories) {
    const projectDirectory = path.join(projectsDirectory, projectDirectoryName)
    const projectStat = await lstatIfExists(projectDirectory)
    if (projectStat?.isDirectory() && !projectStat.isSymbolicLink()) existingDirectories.push(projectDirectory)
  }
  return existingDirectories
}

export async function findClaudeTranscriptInProjectDirectories(
  projectDirectories: string[],
  runtimeResumeToken: string
): Promise<ClaudeTranscriptSource | undefined> {
  for (const projectDirectory of projectDirectories) {
    const transcriptPath = path.join(projectDirectory, `${runtimeResumeToken}.jsonl`)
    const transcriptStat = await lstatIfExists(transcriptPath)
    if (transcriptStat?.isFile() && !transcriptStat.isSymbolicLink()) {
      return { transcriptPath, modifiedAtMs: transcriptStat.mtimeMs }
    }
  }
  return undefined
}

export async function findClaudeTranscriptsGlobally(
  projectsDirectories: string[],
  runtimeResumeTokens: Set<string>,
  excludedProjectDirectory?: string
): Promise<Map<string, ClaudeTranscriptSource>> {
  const sources = new Map<string, ClaudeTranscriptSource>()
  const excludedPath = excludedProjectDirectory ? path.resolve(excludedProjectDirectory) : undefined
  for (const projectsDirectory of projectsDirectories) {
    const projectEntries = await readdir(projectsDirectory, { withFileTypes: true })
    projectEntries.sort((left, right) => left.name.localeCompare(right.name))
    for (const projectEntry of projectEntries) {
      if (!projectEntry.isDirectory() || projectEntry.isSymbolicLink()) continue
      const projectDirectory = path.join(projectsDirectory, projectEntry.name)
      if (excludedPath && path.resolve(projectDirectory) === excludedPath) continue
      const sessionEntries = await readdir(projectDirectory, { withFileTypes: true })
      sessionEntries.sort((left, right) => left.name.localeCompare(right.name))
      for (const sessionEntry of sessionEntries) {
        if (!sessionEntry.isFile() || !sessionEntry.name.endsWith('.jsonl')) continue
        const runtimeResumeToken = sessionEntry.name.slice(0, -'.jsonl'.length)
        if (!runtimeResumeTokens.has(runtimeResumeToken)) continue
        const transcriptPath = path.join(projectDirectory, sessionEntry.name)
        const transcriptStat = await lstatIfExists(transcriptPath)
        if (!transcriptStat?.isFile() || transcriptStat.isSymbolicLink()) continue
        const incumbent = sources.get(runtimeResumeToken)
        if (!incumbent || transcriptStat.mtimeMs > incumbent.modifiedAtMs) {
          sources.set(runtimeResumeToken, { transcriptPath, modifiedAtMs: transcriptStat.mtimeMs })
        }
      }
    }
  }
  return sources
}

async function fileDigest(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function transcriptsMatch(leftPath: string, rightPath: string): Promise<boolean> {
  const [leftStat, rightStat] = await Promise.all([lstatIfExists(leftPath), lstatIfExists(rightPath)])
  if (
    !leftStat?.isFile() ||
    leftStat.isSymbolicLink() ||
    !rightStat?.isFile() ||
    rightStat.isSymbolicLink() ||
    leftStat.size !== rightStat.size
  )
    return false
  const [leftDigest, rightDigest] = await Promise.all([fileDigest(leftPath), fileDigest(rightPath)])
  return leftDigest === rightDigest
}

export type ClaudeTranscriptAvailability = 'present' | 'copied' | 'missing' | 'unsafe'

/**
 * Make a restored Claude transcript visible under the current workspace key.
 * A discovered source is staged and verified before being published without replacing current history.
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
  const projectDirectory = await claudeProjectDirectoryPath(projectsDirectory, workspacePath)
  const projectDirectoryStat = await lstatIfExists(projectDirectory)
  if (projectDirectoryStat && (!projectDirectoryStat.isDirectory() || projectDirectoryStat.isSymbolicLink())) {
    return 'unsafe'
  }
  const destinationPath = path.join(projectDirectory, `${runtimeResumeToken}.jsonl`)
  const destinationStat = await lstatIfExists(destinationPath)
  if (destinationStat && (!destinationStat.isFile() || destinationStat.isSymbolicLink())) return 'unsafe'
  const source = (
    await findClaudeTranscriptsGlobally([projectsDirectory], new Set([runtimeResumeToken]), projectDirectory)
  ).get(runtimeResumeToken)
  if (!source) return destinationStat ? 'present' : 'missing'
  // A transcript may continue receiving messages after a workspace relocation.
  // Once the destination exists, never replace it with a copy from a stale
  // project key: timestamps cannot prove which divergent history is complete.
  if (destinationStat) return 'present'
  if (!(await ensureRegularDirectory(projectDirectory))) return 'unsafe'
  const stagingPath = path.join(projectDirectory, `.${runtimeResumeToken}.restore-${randomUUID()}`)
  try {
    await copyFile(source.transcriptPath, stagingPath, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE)
    if (!(await transcriptsMatch(source.transcriptPath, stagingPath))) {
      throw new Error(`Claude transcript staging verification failed: ${source.transcriptPath}`)
    }
    try {
      // A hard-link publish is atomic and cannot overwrite a destination that
      // appears after the checks above. Both files live under the same Claude
      // projects root, so they are on the same volume.
      await link(stagingPath, destinationPath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw error
      const racedDestinationStat = await lstatIfExists(destinationPath)
      if (!racedDestinationStat?.isFile() || racedDestinationStat.isSymbolicLink()) return 'unsafe'
      return 'present'
    }
    return 'copied'
  } finally {
    await unlink(stagingPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}
