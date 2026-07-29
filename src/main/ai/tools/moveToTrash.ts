import type { BigIntStats } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { validatePath } from '@main/ai/mcp/servers/filesystem'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { shell } from 'electron'
import * as z from 'zod'

import { assertWorkspacePathUnchanged, isErrno, relativeWorkspacePath } from './assistantFileSafety'

const logger = loggerService.withContext('MoveToTrash')

export const MOVE_TO_TRASH_TOOL_NAME = 'move_to_trash'
export const MOVE_TO_TRASH_DESCRIPTION =
  'Move one existing file or directory from the current session workspace to the operating-system trash or recycle bin. ' +
  'Never permanently deletes data, never accepts the workspace root or protected system/user-data paths, and requires user approval.'

export const moveToTrashInputSchema = z.object({
  path: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .describe(
      'Existing file or directory inside the session workspace. State this exact path to the user and obtain confirmation before calling.'
    )
})

export type MoveToTrashInput = z.infer<typeof moveToTrashInputSchema>

interface TrashProtectionContext {
  platform?: NodeJS.Platform
  homeDirectory?: string
  downloadsDirectory?: string
  protectedDirectories?: readonly string[]
  environment?: Readonly<Record<string, string | undefined>>
}

function normalizeComparable(filePath: string, platform: NodeJS.Platform): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const normalized = pathApi.resolve(filePath)
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

function isSameOrWithin(targetPath: string, rootPath: string, platform: NodeJS.Platform): boolean {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const target = normalizeComparable(targetPath, platform)
  const root = normalizeComparable(rootPath, platform)
  if (target === root) return true
  const relative = pathApi.relative(root, target)
  return relative !== '' && !relative.startsWith('..') && !pathApi.isAbsolute(relative)
}

function isDirectChild(targetPath: string, rootPath: string, depth: number, platform: NodeJS.Platform): boolean {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const relative = pathApi.relative(normalizeComparable(rootPath, platform), normalizeComparable(targetPath, platform))
  if (!relative || relative.startsWith('..') || pathApi.isAbsolute(relative)) return false
  return relative.split(pathApi.sep).filter(Boolean).length === depth
}

export function getProtectedTrashTargetReason(
  targetPath: string,
  workspacePath: string,
  context: TrashProtectionContext = {}
): string | undefined {
  const platform = context.platform ?? process.platform
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const target = normalizeComparable(targetPath, platform)
  const workspace = normalizeComparable(workspacePath, platform)

  if (target === workspace) return 'the session workspace root'

  const filesystemRoot = normalizeComparable(pathApi.parse(target).root, platform)
  if (target === filesystemRoot) return 'a filesystem, drive, or volume root'

  const home = context.homeDirectory ? normalizeComparable(context.homeDirectory, platform) : undefined
  if (home && target === home) return 'the user profile or home directory'

  const topLevelUserDirectories = home
    ? ['Desktop', 'Documents', 'Downloads', 'Music', 'Movies', 'Pictures', 'Videos', 'Backups'].map((directory) =>
        pathApi.join(home, directory)
      )
    : []
  if (context.downloadsDirectory) topLevelUserDirectories.push(context.downloadsDirectory)
  if (topLevelUserDirectories.some((directory) => target === normalizeComparable(directory, platform))) {
    return 'a top-level user data directory'
  }

  const sensitiveUserDirectories = home
    ? [
        '.ssh',
        '.gnupg',
        '.aws',
        '.azure',
        '.kube',
        '.docker',
        ...(platform === 'win32' ? ['AppData'] : ['.config', '.local/share']),
        ...(platform === 'darwin' ? ['Library'] : [])
      ].map((directory) => pathApi.join(home, directory))
    : []
  if (
    [...sensitiveUserDirectories, ...(context.protectedDirectories ?? [])].some((directory) =>
      isSameOrWithin(target, directory, platform)
    )
  ) {
    return 'a credential, configuration, or application-data directory'
  }

  const versionControlDirectories = ['.git', '.hg', '.svn'].map((directory) => pathApi.join(workspace, directory))
  if (versionControlDirectories.some((directory) => isSameOrWithin(target, directory, platform))) {
    return 'version-control metadata'
  }

  if (platform === 'win32') {
    const environment = context.environment ?? process.env
    const conventionalRoots = [
      pathApi.join(filesystemRoot, 'Windows'),
      pathApi.join(filesystemRoot, 'Program Files'),
      pathApi.join(filesystemRoot, 'Program Files (x86)'),
      pathApi.join(filesystemRoot, 'ProgramData')
    ]
    const environmentRoots = [
      environment.SystemRoot,
      environment.WINDIR,
      environment.ProgramFiles,
      environment['ProgramFiles(x86)'],
      environment.ProgramData
    ].filter((directory): directory is string => Boolean(directory))

    if ([...conventionalRoots, ...environmentRoots].some((directory) => isSameOrWithin(target, directory, platform))) {
      return 'an operating-system or installed-program directory'
    }
  } else {
    const systemDirectories = [
      '/Applications',
      '/System',
      '/Library',
      '/usr',
      '/bin',
      '/sbin',
      '/etc',
      '/opt',
      '/boot',
      '/dev',
      '/proc',
      '/sys',
      '/root',
      '/var/lib',
      '/var/db',
      '/private/etc',
      '/private/var/db'
    ]
    if (systemDirectories.some((directory) => isSameOrWithin(target, directory, platform))) {
      return 'an operating-system directory'
    }

    const isMountedVolumeRoot =
      (platform === 'darwin' && isDirectChild(target, '/Volumes', 1, platform)) ||
      (platform === 'linux' &&
        (isDirectChild(target, '/mnt', 1, platform) ||
          isDirectChild(target, '/media', 2, platform) ||
          isDirectChild(target, '/run/media', 2, platform)))
    if (isMountedVolumeRoot) return 'a mounted volume root'
  }

  return undefined
}

function sameFileIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

export async function moveWorkspaceItemToTrash(
  workspacePath: string,
  input: MoveToTrashInput,
  signal: AbortSignal
): Promise<{ path: string; type: 'file' | 'directory'; destination: 'trash' }> {
  signal.throwIfAborted()
  const validatedInput = moveToTrashInputSchema.parse(input)
  const resolvedWorkspacePath = AbsoluteFilePathSchema.parse(await validatePath('.', workspacePath))
  const lexicalTargetPath = AbsoluteFilePathSchema.parse(
    path.isAbsolute(validatedInput.path)
      ? path.resolve(validatedInput.path)
      : path.resolve(resolvedWorkspacePath, validatedInput.path)
  )
  const resolvedTargetPath = AbsoluteFilePathSchema.parse(
    await validatePath(validatedInput.path, resolvedWorkspacePath)
  )

  const protectionContext: TrashProtectionContext = {
    homeDirectory: application.getPath('sys.home'),
    downloadsDirectory: application.getPath('sys.downloads'),
    protectedDirectories: [application.getPath('cherry.home'), application.getPath('app.userdata')]
  }
  const protectedReason = getProtectedTrashTargetReason(resolvedTargetPath, resolvedWorkspacePath, protectionContext)
  if (protectedReason) {
    throw new Error(`Refusing to move protected path to trash (${protectedReason}): ${validatedInput.path}`)
  }

  let initialStat: BigIntStats
  try {
    initialStat = await lstat(lexicalTargetPath, { bigint: true })
  } catch (error) {
    if (isErrno(error, 'ENOENT')) throw new Error(`Path not found: ${validatedInput.path}`)
    throw error
  }
  if (initialStat.isSymbolicLink()) {
    throw new Error(`Refusing to move a symbolic link to trash: ${validatedInput.path}`)
  }
  if (!initialStat.isFile() && !initialStat.isDirectory()) {
    throw new Error(`Path is not a regular file or directory: ${validatedInput.path}`)
  }

  const currentRealPath = AbsoluteFilePathSchema.parse(await realpath(lexicalTargetPath))
  if (
    normalizeComparable(currentRealPath, process.platform) !== normalizeComparable(resolvedTargetPath, process.platform)
  ) {
    throw new Error(`Path changed while preparing to move it to trash: ${validatedInput.path}`)
  }

  await assertWorkspacePathUnchanged(
    validatedInput.path,
    resolvedTargetPath,
    resolvedWorkspacePath,
    'Path changed while preparing to move it to trash'
  )
  const finalStat = await lstat(lexicalTargetPath, { bigint: true })
  if (!sameFileIdentity(initialStat, finalStat)) {
    throw new Error(`Path changed while preparing to move it to trash: ${validatedInput.path}`)
  }

  signal.throwIfAborted()
  const relativePath = relativeWorkspacePath(resolvedWorkspacePath, resolvedTargetPath)
  await shell.trashItem(lexicalTargetPath)

  const type = initialStat.isDirectory() ? 'directory' : 'file'
  logger.info('Moved workspace item to operating-system trash', { path: relativePath, type })
  return { path: relativePath, type, destination: 'trash' }
}
