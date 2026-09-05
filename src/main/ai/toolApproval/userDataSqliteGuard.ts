import { lstat, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { application } from '@application'
import type { AgentType } from '@shared/data/api/schemas/agents'

const SQLITE_FILE_PATTERN = /\.(?:db|sqlite)(?:-(?:journal|shm|wal))?$/i
const DATABASE_SIDECARS = ['-wal', '-shm', '-journal'] as const
const BUNDLED_INTERPRETER_PATTERN = /^(?:python(?:\d+(?:\.\d+)*)?|node|bun)(?:\.exe)?$/i
const PI_UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g

interface ToolBinding {
  readonly pathFields: Readonly<Record<string, string>>
  readonly shellFields: Readonly<Record<string, string>>
  readonly normalizeStructuredPath?: (value: string) => string
}

const TOOL_BINDINGS = {
  'claude-code': {
    pathFields: {
      Write: 'file_path',
      Edit: 'file_path',
      MultiEdit: 'file_path',
      NotebookEdit: 'notebook_path'
    },
    shellFields: { Bash: 'command' }
  },
  pi: {
    pathFields: { write: 'path', edit: 'path' },
    shellFields: { bash: 'command' },
    normalizeStructuredPath: normalizePiNativePathInput
  },
  dsh: {
    pathFields: { write: 'file_path', edit: 'file_path' },
    shellFields: { bash: 'command', pwsh: 'command' }
  }
} satisfies Record<AgentType, ToolBinding>

export const USER_DATA_SQLITE_GUARD_REASON =
  'Direct writes to SQLite files inside Cherry Studio user data are blocked. Use Cherry Studio APIs instead.'

export interface UserDataSqliteGuardDecision {
  ruleId: 'user-data-sqlite-write'
  reason: string
}

export interface UserDataSqliteGuardInput {
  runtime: AgentType
  toolName: string
  args: unknown
  cwd: string
  workspacePath: string
  signal?: AbortSignal
}

interface GuardRoots {
  userData: string
  databaseFiles: readonly string[]
  databaseIdentities: readonly FileIdentity[]
  workspace: string
  workspaceIsUserDataChild: boolean
}

interface FileIdentity {
  device: bigint
  inode: bigint
}

type PathClassification = 'protected' | 'safe' | 'invalid'

/** Match Pi's file-tool preprocessing before policy or containment checks. */
export function normalizePiNativePathInput(value: string): string {
  const normalized = value.replace(PI_UNICODE_SPACES, ' ')
  return normalized.startsWith('@') ? normalized.slice(1) : normalized
}

export async function evaluateUserDataSqliteGuard(
  input: UserDataSqliteGuardInput
): Promise<UserDataSqliteGuardDecision | undefined> {
  const binding: ToolBinding = TOOL_BINDINGS[input.runtime]
  const pathField = binding.pathFields[input.toolName]
  const shellField = binding.shellFields[input.toolName]
  if (!pathField && !shellField) return undefined

  const args = isRecord(input.args) ? input.args : undefined
  const rawValue = args?.[pathField ?? shellField]
  if (typeof rawValue !== 'string' || !rawValue.trim()) return undefined
  if (input.signal?.aborted) return undefined

  if (pathField) {
    const [roots, cwd] = await Promise.all([
      resolveGuardRoots(input.workspacePath, input.signal),
      canonicalizeExistingDirectory(path.resolve(input.cwd), input.signal)
    ])
    if (!roots || !cwd) return deny()
    const structuredPath = binding.normalizeStructuredPath?.(rawValue) ?? rawValue
    const classification = await classifyPath(structuredPath, cwd, roots, input.signal)
    return classification === 'safe' ? undefined : deny()
  }

  const shellTokens = parseShellTokens(rawValue)
  const interpreterSegments = new Set(
    shellTokens
      .filter(({ commandStart, value }) => commandStart && isBundledInterpreter(value))
      .map(({ segment }) => segment)
  )
  const candidates = [
    ...shellTokens.flatMap(({ value }) => shellPathCandidates(value)),
    ...shellTokens
      .filter(({ segment }) => interpreterSegments.has(segment))
      .flatMap(({ value }) => extractQuotedLiterals(value))
  ]
  const [roots, cwd] = await Promise.all([
    resolveGuardRoots(input.workspacePath, input.signal),
    canonicalizeExistingDirectory(path.resolve(input.cwd), input.signal)
  ])
  if (!roots || !cwd) return candidates.some(looksLikeSqliteLiteral) ? deny() : undefined

  for (const candidate of candidates) {
    const classification = await classifyPath(candidate, cwd, roots, input.signal)
    if (classification === 'protected') return deny()
    if (classification === 'invalid' && looksLikeSqliteLiteral(candidate)) return deny()
  }
  return undefined
}

function deny(): UserDataSqliteGuardDecision {
  return { ruleId: 'user-data-sqlite-write', reason: USER_DATA_SQLITE_GUARD_REASON }
}

async function resolveGuardRoots(workspacePath: string, signal?: AbortSignal): Promise<GuardRoots | undefined> {
  const userDataPath = application.getPath('app.userdata')
  const databaseFile = application.getPath('app.database.file')
  const [userData, database, workspace] = await Promise.all([
    canonicalizeExistingDirectory(path.resolve(userDataPath), signal),
    canonicalizePath(path.resolve(databaseFile), signal),
    canonicalizeExistingDirectory(path.resolve(workspacePath), signal)
  ])
  if (!userData || !database || !workspace) return undefined

  const databaseFiles = [database, ...DATABASE_SIDECARS.map((suffix) => `${database}${suffix}`)]
  const [databaseIdentity, ...sidecarIdentities] = await Promise.all(
    databaseFiles.map((databasePath) => getFileIdentity(databasePath, signal))
  )
  if (!databaseIdentity) return undefined

  return {
    userData,
    databaseFiles,
    databaseIdentities: [databaseIdentity, ...sidecarIdentities.filter(isFileIdentity)],
    workspace,
    workspaceIsUserDataChild: !pathsEqual(workspace, userData) && isSameOrInsidePath(workspace, userData)
  }
}

async function classifyPath(
  rawPath: string,
  cwd: string,
  roots: GuardRoots,
  signal?: AbortSignal
): Promise<PathClassification> {
  const requestedPath = resolveLiteralPath(rawPath, cwd)
  if (!requestedPath) return 'invalid'
  const target = await canonicalizePath(requestedPath, signal)
  if (!target) return 'invalid'

  if (roots.databaseFiles.some((databaseFile) => pathsEqual(target, databaseFile))) return 'protected'
  const targetIdentity = await getFileIdentity(target, signal)
  if (targetIdentity && roots.databaseIdentities.some((identity) => sameFileIdentity(targetIdentity, identity))) {
    return 'protected'
  }
  if (!SQLITE_FILE_PATTERN.test(path.basename(target))) return 'safe'
  if (!isSameOrInsidePath(target, roots.userData)) return 'safe'
  if (roots.workspaceIsUserDataChild && isSameOrInsidePath(target, roots.workspace)) return 'safe'
  return 'protected'
}

function resolveLiteralPath(rawPath: string, cwd: string): string | undefined {
  let value = rawPath
  if (/^file:/i.test(value)) {
    const uri = value.replace(/[?#].*$/, '')
    try {
      value =
        uri.startsWith('file://') || uri.startsWith('file:/') ? fileURLToPath(uri) : decodeURIComponent(uri.slice(5))
    } catch {
      return undefined
    }
  }

  const homePath = application.getPath('sys.home')
  if (value === '~') value = homePath
  else if (value.startsWith('~/') || value.startsWith('~\\'))
    value = appendWithoutNormalization(homePath, value.slice(2))
  else if (value === '$HOME' || value === '${HOME}') value = homePath
  else if (value.startsWith('$HOME/') || value.startsWith('$HOME\\')) {
    value = appendWithoutNormalization(homePath, value.slice(6))
  } else if (value.startsWith('${HOME}/') || value.startsWith('${HOME}\\')) {
    value = appendWithoutNormalization(homePath, value.slice(8))
  }

  return path.isAbsolute(value) ? value : appendWithoutNormalization(path.resolve(cwd), value)
}

async function canonicalizePath(targetPath: string, signal?: AbortSignal): Promise<string | undefined> {
  if (signal?.aborted) return undefined
  try {
    const resolved = await realpath(targetPath)
    return signal?.aborted ? undefined : path.normalize(resolved)
  } catch (error) {
    if (signal?.aborted || (error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
    if (await pathExistsOrIsAmbiguous(targetPath)) return undefined
  }

  let parent = path.dirname(targetPath)
  while (true) {
    if (signal?.aborted) return undefined
    try {
      const canonicalParent = await realpath(parent)
      if (signal?.aborted) return undefined
      return path.normalize(path.resolve(canonicalParent, path.relative(parent, targetPath)))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined
      if (await pathExistsOrIsAmbiguous(parent)) return undefined
      const next = path.dirname(parent)
      if (next === parent) return undefined
      parent = next
    }
  }
}

async function canonicalizeExistingDirectory(targetPath: string, signal?: AbortSignal): Promise<string | undefined> {
  if (signal?.aborted) return undefined
  try {
    const [resolved, targetStat] = await Promise.all([realpath(targetPath), stat(targetPath)])
    if (signal?.aborted || !targetStat.isDirectory()) return undefined
    return path.normalize(resolved)
  } catch {
    return undefined
  }
}

async function getFileIdentity(targetPath: string, signal?: AbortSignal): Promise<FileIdentity | undefined> {
  if (signal?.aborted) return undefined
  try {
    const targetStat = await stat(targetPath, { bigint: true })
    if (signal?.aborted) return undefined
    return { device: targetStat.dev, inode: targetStat.ino }
  } catch {
    return undefined
  }
}

function isFileIdentity(identity: FileIdentity | undefined): identity is FileIdentity {
  return identity !== undefined
}

function sameFileIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode
}

async function pathExistsOrIsAmbiguous(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ENOENT'
  }
}

function appendWithoutNormalization(basePath: string, suffix: string): string {
  if (!suffix) return basePath
  return `${basePath}${basePath.endsWith(path.sep) ? '' : path.sep}${suffix}`
}

function pathsEqual(left: string, right: string): boolean {
  return normalizeForComparison(left, process.platform) === normalizeForComparison(right, process.platform)
}

export function isSameOrInsidePath(target: string, root: string, platform = process.platform): boolean {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  const normalizedTarget = normalizeForComparison(target, platform)
  const normalizedRoot = normalizeForComparison(root, platform)
  const relative = pathApi.relative(normalizedRoot, normalizedTarget)
  return (
    relative === '' || (relative !== '..' && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative))
  )
}

function normalizeForComparison(value: string, platform: NodeJS.Platform): string {
  const normalized = platform === 'win32' ? path.win32.normalize(value) : path.posix.normalize(value)
  return platform === 'darwin' || platform === 'win32' ? normalized.toLowerCase() : normalized
}

interface ShellToken {
  value: string
  commandStart: boolean
  segment: number
}

export function tokenizeShellCommand(command: string): string[] {
  return parseShellTokens(command).map(({ value }) => value)
}

function parseShellTokens(command: string): ShellToken[] {
  const tokens: ShellToken[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let commandStart = true
  let segment = 0
  const pushCurrent = () => {
    if (current) {
      tokens.push({ value: current, commandStart, segment })
      if (!isPosixAssignment(current)) commandStart = false
    }
    current = ''
  }

  for (let index = 0; index < command.length; index++) {
    const character = command[index]
    if (character === '\\' && quote !== "'") {
      const next = command[index + 1]
      if (next === '\\' && (!current || current.endsWith('='))) {
        current += '\\\\'
        index++
      } else if (next && /[\\\s"'`$;&|<>]/.test(next)) {
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
    } else if (/\s|[;&|<>]/.test(character)) {
      pushCurrent()
      if (character === '\n' || /[;&|]/.test(character)) {
        commandStart = true
        segment++
      }
    } else {
      current += character
    }
  }
  pushCurrent()
  return tokens
}

function isPosixAssignment(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(value)
}

function isBundledInterpreter(value: string): boolean {
  return [path.posix.basename(value), path.win32.basename(value)].some((name) => BUNDLED_INTERPRETER_PATTERN.test(name))
}

function extractQuotedLiterals(value: string): string[] {
  const literals: string[] = []
  for (let index = 0; index < value.length; index++) {
    const quote = value[index]
    if (quote !== "'" && quote !== '"' && quote !== '`') continue

    let literal = ''
    for (index++; index < value.length; index++) {
      const character = value[index]
      if (character === quote) {
        if (literal) literals.push(literal)
        break
      }
      if (character === '\\' && (value[index + 1] === quote || value[index + 1] === '\\')) {
        literal += value[++index]
      } else {
        literal += character
      }
    }
  }
  return literals
}

function shellPathCandidates(word: string): string[] {
  const candidates = [word]
  const assignmentIndex = word.indexOf('=')
  if (assignmentIndex >= 0) candidates.push(word.slice(assignmentIndex + 1))
  return [...new Set(candidates.filter(Boolean))]
}

function looksLikeSqliteLiteral(value: string): boolean {
  const uriPath = /^file:/i.test(value) ? value.slice(5).replace(/[?#].*$/, '') : value
  return SQLITE_FILE_PATTERN.test(path.basename(uriPath))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
