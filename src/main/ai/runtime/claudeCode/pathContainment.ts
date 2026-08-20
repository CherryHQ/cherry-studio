/**
 * Workspace path containment for Claude Code file tools.
 *
 * Resolves a tool-requested path against the session workspace and answers whether it stays inside
 * the allowed roots (workspace + agent data directory). Symlinks are canonicalized so an outside
 * target cannot look lexically inside; for not-yet-existing targets the nearest existing ancestor is
 * canonicalized and the missing suffix re-appended. Ambiguity (`~`, resolution failure) counts as
 * outside so the caller requires approval.
 */

import * as fs from 'node:fs'
import path from 'node:path'

import { isMac, isWin } from '@main/core/platform'
import { isPathInside } from '@main/utils/file'

const SQLITE_FILE_PATTERN = /\.(?:db|sqlite)(?:-(?:journal|shm|wal))?$/i

function appendPathWithoutNormalization(basePath: string, segments: readonly string[]): string {
  if (segments.length === 0) return basePath
  const separator = basePath.endsWith(path.sep) ? '' : path.sep
  return `${basePath}${separator}${segments.join(path.sep)}`
}

function resolveFromCwdWithoutNormalization(cwd: string, requestedPath: string): string {
  return path.isAbsolute(requestedPath)
    ? requestedPath
    : appendPathWithoutNormalization(path.resolve(cwd), [requestedPath])
}

async function resolveRealOrNearestExistingPath(targetPath: string): Promise<string> {
  let currentPath = targetPath
  let missingSegments: string[] = []

  while (true) {
    try {
      const realCurrentPath = await fs.promises.realpath(currentPath)
      return path.normalize(appendPathWithoutNormalization(realCurrentPath, missingSegments))
    } catch {
      const linkTarget = await fs.promises
        .lstat(currentPath)
        .then((stats) => (stats.isSymbolicLink() ? fs.promises.readlink(currentPath) : undefined))
        .catch(() => undefined)
      if (linkTarget !== undefined) {
        const absoluteLinkTarget = path.isAbsolute(linkTarget)
          ? linkTarget
          : appendPathWithoutNormalization(path.dirname(currentPath), [linkTarget])
        currentPath = appendPathWithoutNormalization(absoluteLinkTarget, missingSegments)
        missingSegments = []
        continue
      }

      const parentPath = path.dirname(currentPath)
      if (parentPath === currentPath) {
        return path.normalize(appendPathWithoutNormalization(currentPath, missingSegments))
      }
      missingSegments.unshift(path.basename(currentPath))
      currentPath = parentPath
    }
  }
}

export async function isPathWithinAllowedRoots(
  cwd: string,
  agentDataPath: string,
  requestedPath: string
): Promise<boolean> {
  if (requestedPath === '~' || requestedPath.startsWith('~/') || requestedPath.startsWith('~\\')) {
    return false
  }

  const absoluteTarget = resolveFromCwdWithoutNormalization(cwd, requestedPath)
  const [resolvedWorkspace, resolvedAgentDataPath, resolvedTarget] = await Promise.all([
    resolveRealOrNearestExistingPath(path.resolve(cwd)),
    resolveRealOrNearestExistingPath(path.resolve(agentDataPath)),
    resolveRealOrNearestExistingPath(absoluteTarget)
  ])
  return (
    resolvedTarget === resolvedWorkspace ||
    isPathInside(resolvedTarget, resolvedWorkspace) ||
    resolvedTarget === resolvedAgentDataPath ||
    isPathInside(resolvedTarget, resolvedAgentDataPath)
  )
}

function normalizeShellPathText(value: string): string {
  const normalized = value.replace(/\\([\\\s"'`$;&|<>])/g, '$1').replaceAll('\\', '/')
  return isMac || isWin ? normalized.toLowerCase() : normalized
}

interface ShellToken {
  value: string
  isOperator: boolean
}

function tokenizeShellCommand(command: string): ShellToken[] {
  const tokens: ShellToken[] = []
  let current = ''
  let quote: '"' | "'" | undefined

  const pushCurrent = () => {
    if (current) tokens.push({ value: current, isOperator: false })
    current = ''
  }

  for (let index = 0; index < command.length; index++) {
    const character = command[index]
    if (character === '\\' && quote !== "'") {
      const next = command[index + 1]
      if (next && /[\\\s"'`$;&|<>]/.test(next)) {
        current += next
        index++
      } else {
        current += character
      }
    } else if (quote) {
      if (character === quote) quote = undefined
      else current += character
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (/\s/.test(character)) {
      pushCurrent()
      if (character === '\n') tokens.push({ value: character, isOperator: true })
    } else if (/[;&|<>]/.test(character)) {
      pushCurrent()
      const doubled = (character === '&' || character === '|') && command[index + 1] === character
      tokens.push({ value: doubled ? character.repeat(2) : character, isOperator: true })
      if (doubled) index++
    } else {
      current += character
    }
  }
  pushCurrent()
  return tokens
}

function expandHomePath(requestedPath: string, homePath: string): string {
  return requestedPath.replace(/^(?:\$\{home\}|\$home|~)(?=[/\\]|$)/i, () => homePath)
}

function expandShellHomePath(requestedPath: string, homePath: string): string {
  return expandHomePath(normalizeShellPathText(requestedPath), normalizeShellPathText(path.resolve(homePath)))
}

function pathFromShellWord(word: string): string | undefined {
  const normalizedWord = normalizeShellPathText(word).replace(/[,)}\]]+$/, '')
  const pathText = normalizedWord.slice(normalizedWord.lastIndexOf('=') + 1).replace(/^file:/i, '')
  const pathWithoutQuery = pathText.replace(/[?#].*$/, '')
  return pathWithoutQuery || undefined
}

interface SqlitePathRoots {
  workspace: string
  userData: string
  databaseFile: string
}

function normalizeResolvedPath(resolvedPath: string): string {
  return isMac || isWin ? resolvedPath.toLowerCase() : resolvedPath
}

async function resolveSqlitePathRoots(
  workspacePath: string,
  userDataPath: string,
  databaseFile: string
): Promise<SqlitePathRoots> {
  const [workspace, userData, resolvedDatabaseFile] = await Promise.all([
    resolveRealOrNearestExistingPath(path.resolve(workspacePath)),
    resolveRealOrNearestExistingPath(path.resolve(userDataPath)),
    resolveRealOrNearestExistingPath(path.resolve(databaseFile))
  ])
  return {
    workspace: normalizeResolvedPath(workspace),
    userData: normalizeResolvedPath(userData),
    databaseFile: normalizeResolvedPath(resolvedDatabaseFile)
  }
}

async function isUserDataSqlitePathWithinRoots(
  requestedPath: string,
  resolutionCwd: string,
  homePath: string,
  roots: SqlitePathRoots
): Promise<boolean> {
  const expandedPath = expandHomePath(requestedPath, homePath)
  const absoluteTarget = resolveFromCwdWithoutNormalization(resolutionCwd, expandedPath)
  const target = normalizeResolvedPath(await resolveRealOrNearestExistingPath(absoluteTarget))

  if (target === roots.databaseFile) return true
  if (!SQLITE_FILE_PATTERN.test(path.basename(target))) return false

  const isInsideUserData = target === roots.userData || isPathInside(target, roots.userData)
  const isInsideWorkspace = target === roots.workspace || isPathInside(target, roots.workspace)
  return isInsideUserData && !isInsideWorkspace
}

export async function commandReferencesUserDataSqlite(
  command: string,
  cwd: string,
  userDataPath: string,
  databaseFile: string,
  homePath: string
): Promise<boolean> {
  let shellCwd = cwd
  let words: string[] = []
  const tokens = tokenizeShellCommand(command)
  const roots = await resolveSqlitePathRoots(cwd, userDataPath, databaseFile)

  for (let index = 0; index <= tokens.length; index++) {
    const token = tokens[index]
    if (token && !token.isOperator) {
      words.push(token.value)
      continue
    }
    for (const word of words) {
      const requestedPath = pathFromShellWord(word)
      if (requestedPath && (await isUserDataSqlitePathWithinRoots(requestedPath, shellCwd, homePath, roots))) {
        return true
      }
    }

    const operator = token?.value
    if ((operator === '&&' || operator === ';' || operator === '\n') && words[0] === 'cd') {
      const requestedDirectory = words[1] ?? homePath
      const expandedDirectory = expandShellHomePath(requestedDirectory, homePath)
      shellCwd = path.isAbsolute(expandedDirectory)
        ? path.resolve(expandedDirectory)
        : path.resolve(shellCwd, expandedDirectory)
    }
    words = []
  }
  return false
}

export async function isUserDataSqlitePath(
  requestedPath: string,
  cwd: string,
  userDataPath: string,
  databaseFile: string,
  homePath: string
): Promise<boolean> {
  const roots = await resolveSqlitePathRoots(cwd, userDataPath, databaseFile)
  return isUserDataSqlitePathWithinRoots(requestedPath, cwd, homePath, roots)
}
