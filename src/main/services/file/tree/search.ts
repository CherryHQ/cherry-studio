/**
 * Directory search — ripgrep + fuzzy matching.
 *
 * `listDirectory` and `listDirectoryEntries` are public. All ripgrep /
 * scoring internals are private.
 *
 * Two modes share one entry point, distinguished by `options.searchPattern`:
 *   - List mode (`searchPattern === '.'`, the default): enumerate the
 *     directory tree. No result cap by default — set `maxEntries` only when
 *     truncation is desired (e.g. autocomplete dropdowns).
 *   - Search mode (`searchPattern` is a user query): ripgrep glob pre-filter
 *     plus JS-side fuzzy scoring. Caller controls `maxEntries` for the
 *     dropdown size; the fuzzy branch can scan all files before JS-side
 *     fuzzy matching when the glob misses everything.
 */

import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { loggerService } from '@logger'
import { getBinaryExecutionEnv } from '@main/utils/binaryEnv'
import { getBinaryPath } from '@main/utils/binaryResolver'
import type { AbsoluteFilePath, DirectoryEntry, DirectoryListOptions } from '@shared/types/file'

import { defaultRipgrepGlobArgs } from './gitignore'

const logger = loggerService.withContext('Utils:File:Search')

// `fuzzy` is an internal-only knob today (no shared-type field, no real
// caller toggles it). Kept in the resolved-options shape so existing branches
// stay literal-faithful to the legacy `FileStorage` implementation.
interface DirectoryListOptionsInternal extends DirectoryListOptions {
  fuzzy?: boolean
}

type ResolvedOptions = Required<DirectoryListOptionsInternal>

const DEFAULT_DIRECTORY_LIST_OPTIONS: ResolvedOptions = {
  recursive: true,
  maxDepth: 10,
  includeHidden: false,
  includeFiles: true,
  includeDirectories: true,
  // Was `20` in the legacy FileStorage impl — that turned list-mode calls
  // (ArtifactPane workspace tree) into silently-truncated 20-entry stubs.
  // Truncation is a search-mode concern; callers that want a cap pass
  // `maxEntries` explicitly.
  maxEntries: Number.MAX_SAFE_INTEGER,
  searchPattern: '.',
  fuzzy: true
}

// ─── Scoring constants ─────────────────────────────────────────────────────

const SCORE_SEGMENT_MATCH = 60
const SCORE_FILENAME_CONTAINS = 80
const SCORE_FILENAME_STARTS = 100
const SCORE_CONSECUTIVE_CHAR = 15
const SCORE_WORD_BOUNDARY = 20
const PATH_LENGTH_PENALTY_FACTOR = 4

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  '.idea',
  '.vscode',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '.cache'
])

// `defaultRipgrepGlobArgs()` is the single source of these patterns; both
// chokidar's `ignored` predicate and the post-scan filter consume the same
// defaults via `loadGitignorePredicate`. See `gitignore.ts` for the
// "single source of truth, three consumers" rationale.

// ─── Ripgrep binary + execution ────────────────────────────────────────────

// Ripgrep is a BinaryManager-managed tool: bundled into `cherry.bin` at boot
// and overridable by a mise-installed copy. `getBinaryPath('rg')` resolves
// that single source of truth (mise shim → cherry.bin); a bare `rg` fallback
// fails the existsSync check below, surfacing as "binary not available".
async function resolveRipgrepBinary(): Promise<string | null> {
  const binaryPath = await getBinaryPath('rg')
  return fs.existsSync(binaryPath) ? binaryPath : null
}

interface RipgrepResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function executeRipgrep(args: string[]): Promise<RipgrepResult> {
  const ripgrepBinaryPath = await resolveRipgrepBinary()
  if (!ripgrepBinaryPath) {
    throw new Error('Ripgrep binary not available')
  }

  return new Promise((resolve, reject) => {
    const child = spawn(ripgrepBinaryPath, ['--no-config', '--ignore-case', ...args], {
      env: { ...process.env, ...getBinaryExecutionEnv() },
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      // `code === null` happens when the process was killed by a signal
      // (SIGKILL / SIGTERM on OOM, parent crash, etc.). Coercing it to 0
      // would surface as "ripgrep exited successfully with no matches" =
      // an empty directory listing, which is indistinguishable from a real
      // empty result. Reject explicitly so callers can decide.
      if (code === null && signal !== null) {
        reject(new Error(`Ripgrep terminated by signal ${signal}: ${stderr || stdout}`))
        return
      }
      resolve({
        exitCode: code ?? 0,
        stdout,
        stderr
      })
    })

    child.on('error', (error: Error) => {
      reject(error)
    })
  })
}

function getUsableRipgrepOutput(result: RipgrepResult): string {
  if (result.exitCode < 2) return result.stdout

  const stderr = result.stderr.trim()
  if (!result.stdout.trim()) {
    throw new Error(`Ripgrep failed with exit code ${result.exitCode}: ${stderr || 'No output available'}`)
  }

  logger.warn('Ripgrep reported traversal errors; keeping available results', {
    exitCode: result.exitCode,
    stderr
  })

  return result.stdout
}

function buildRipgrepBaseArgs(options: ResolvedOptions, resolvedPath: string): string[] {
  const args: string[] = ['--files']

  if (options.includeHidden) {
    // ripgrep skips dotfiles by default; opt-in to surface them.
    args.push('--hidden')
  } else {
    args.push('--glob', '!.*')
  }

  args.push(...defaultRipgrepGlobArgs())

  if (!options.recursive) {
    args.push('--max-depth', '1')
  } else if (options.maxDepth > 0) {
    args.push('--max-depth', options.maxDepth.toString())
  }

  args.push(resolvedPath)

  return args
}

// ─── Directory walk ────────────────────────────────────────────────────────

async function searchDirectories(
  resolvedPath: string,
  options: ResolvedOptions,
  currentDepth: number = 0
): Promise<string[]> {
  if (!options.includeDirectories) return []
  if (!options.recursive && currentDepth > 0) return []
  if (options.maxDepth > 0 && currentDepth >= options.maxDepth) return []

  const directories: string[] = []

  try {
    const entries = await fs.promises.readdir(resolvedPath, { withFileTypes: true })
    const searchPatternLower = options.searchPattern.toLowerCase()

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (!options.includeHidden && entry.name.startsWith('.')) continue
      if (EXCLUDED_DIRS.has(entry.name)) continue

      const fullPath = path.join(resolvedPath, entry.name).replace(/\\/g, '/')

      if (options.searchPattern === '.' || entry.name.toLowerCase().includes(searchPatternLower)) {
        directories.push(fullPath)
      }

      if (options.recursive && (options.maxDepth <= 0 || currentDepth < options.maxDepth)) {
        const subDirs = await searchDirectories(fullPath, options, currentDepth + 1)
        directories.push(...subDirs)
      }
    }
  } catch (error) {
    logger.warn(`Failed to search directories in: ${resolvedPath}`, error as Error)
  }

  return directories
}

async function searchByFilename(resolvedPath: string, options: ResolvedOptions): Promise<string[]> {
  const files: string[] = []
  const directories: string[] = []

  if (options.includeFiles) {
    const args: string[] = ['--files']

    if (options.includeHidden) {
      args.push('--hidden')
    } else {
      args.push('--glob', '!.*')
    }

    // ripgrep filters by filename (case-insensitive)
    if (options.searchPattern && options.searchPattern !== '.') {
      args.push('--iglob', `*${options.searchPattern}*`)
    }

    args.push(...defaultRipgrepGlobArgs())

    if (!options.recursive) {
      args.push('--max-depth', '1')
    } else if (options.maxDepth > 0) {
      args.push('--max-depth', options.maxDepth.toString())
    }

    args.push(resolvedPath)

    const output = getUsableRipgrepOutput(await executeRipgrep(args))

    files.push(
      ...output
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => line.replace(/\\/g, '/'))
    )
  }

  if (options.includeDirectories) {
    directories.push(...(await searchDirectories(resolvedPath, options)))
  }

  // Directories first (alphabetical), then files (alphabetical).
  const sortedDirectories = directories.sort((a, b) => path.basename(a).localeCompare(path.basename(b)))
  const sortedFiles = files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)))

  return [...sortedDirectories, ...sortedFiles].slice(0, options.maxEntries)
}

// ─── Fuzzy scoring ─────────────────────────────────────────────────────────

/**
 * Fuzzy match: every char in `query` appears in `text` in order (case-insensitive).
 * Example: "updater" matches "packages/update/src/node/updateController.ts".
 */
function isFuzzyMatch(text: string, query: string): boolean {
  const textLower = text.toLowerCase()
  const queryLower = query.toLowerCase()

  let i = 0
  let j = 0
  while (i < textLower.length && j < queryLower.length) {
    if (textLower[i] === queryLower[j]) j++
    i++
  }
  return j === queryLower.length
}

/**
 * Fuzzy match score (higher = better). Weighs segment matches, filename
 * prefix/contains, consecutive runs, word boundaries, with a log penalty
 * on path length so deeper paths don't dominate.
 */
function getFuzzyMatchScore(filePath: string, query: string): number {
  const pathLower = filePath.toLowerCase()
  const queryLower = query.toLowerCase()
  const fileName = filePath.split('/').pop() ?? ''
  const fileNameLower = fileName.toLowerCase()

  let score = 0

  const pathSegments = pathLower.split(/[/\\]/)
  let segmentMatchCount = 0
  for (const segment of pathSegments) {
    if (isFuzzyMatch(segment, queryLower)) segmentMatchCount++
  }
  score += segmentMatchCount * SCORE_SEGMENT_MATCH

  if (fileNameLower.startsWith(queryLower)) {
    score += SCORE_FILENAME_STARTS
  } else if (fileNameLower.includes(queryLower)) {
    score += SCORE_FILENAME_CONTAINS
  }

  let i = 0
  let j = 0
  let consecutiveCount = 0
  let maxConsecutive = 0
  while (i < pathLower.length && j < queryLower.length) {
    if (pathLower[i] === queryLower[j]) {
      consecutiveCount++
      maxConsecutive = Math.max(maxConsecutive, consecutiveCount)
      j++
    } else {
      consecutiveCount = 0
    }
    i++
  }
  score += maxConsecutive * SCORE_CONSECUTIVE_CHAR

  // Word-boundary bonus — only credit once to avoid inflating repeated patterns.
  const boundaryPrefix = queryLower.slice(0, Math.min(3, queryLower.length))
  const words = pathLower.split(/[/\\._-]/)
  for (const word of words) {
    if (word.startsWith(boundaryPrefix)) {
      score += SCORE_WORD_BOUNDARY
      break
    }
  }

  score -= Math.log(filePath.length + 1) * PATH_LENGTH_PENALTY_FACTOR

  return score
}

function queryToGlobPattern(query: string): string {
  // Escape special glob chars (including ! for negation), then interleave with *.
  const escaped = query.replace(/[[\]{}()*+?.,\\^$|#!]/g, '\\$&')
  return '*' + escaped.split('').join('*') + '*'
}

interface ScoredSearchEntry {
  path: string
  isDirectory: boolean
  score: number
}

function parseRipgrepPaths(output: string): string[] {
  return output
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => line.replace(/\\/g, '/'))
}

function scoreFuzzyPaths(
  paths: readonly string[],
  resolvedPath: string,
  query: string,
  isDirectory: boolean
): ScoredSearchEntry[] {
  return paths
    .map((entryPath) => ({ entryPath, relativePath: path.relative(resolvedPath, entryPath).replace(/\\/g, '/') }))
    .filter(({ relativePath }) => isFuzzyMatch(relativePath, query))
    .map(({ entryPath, relativePath }) => ({
      path: entryPath,
      isDirectory,
      score: getFuzzyMatchScore(relativePath, query)
    }))
}

function compareScoredSearchEntries(a: ScoredSearchEntry, b: ScoredSearchEntry): number {
  if (a.score !== b.score) return b.score - a.score
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
  return a.path.localeCompare(b.path)
}

async function searchFuzzyFiles(resolvedPath: string, options: ResolvedOptions): Promise<ScoredSearchEntry[]> {
  if (!options.includeFiles) return []
  const args = buildRipgrepBaseArgs(options, resolvedPath)
  const globPattern = queryToGlobPattern(options.searchPattern)
  args.splice(args.length - 1, 0, '--iglob', globPattern)
  const firstOutput = getUsableRipgrepOutput(await executeRipgrep(args))
  const firstCandidates = scoreFuzzyPaths(parseRipgrepPaths(firstOutput), resolvedPath, options.searchPattern, false)
  if (firstCandidates.length > 0) return firstCandidates
  logger.debug('Fuzzy glob returned no results, scanning all files before JS fuzzy matching')
  const fallbackOutput = getUsableRipgrepOutput(await executeRipgrep(buildRipgrepBaseArgs(options, resolvedPath)))
  return scoreFuzzyPaths(parseRipgrepPaths(fallbackOutput), resolvedPath, options.searchPattern, false)
}

async function searchFuzzyDirectories(resolvedPath: string, options: ResolvedOptions): Promise<ScoredSearchEntry[]> {
  if (!options.includeDirectories) return []
  const directories = await searchDirectories(resolvedPath, { ...options, searchPattern: '.' })
  return scoreFuzzyPaths(directories, resolvedPath, options.searchPattern, true)
}

// ─── Main dispatch ─────────────────────────────────────────────────────────

async function listDirectoryWithRipgrep(resolvedPath: string, options: ResolvedOptions): Promise<string[]> {
  // Search mode w/ fuzzy: collect files and directories, then score globally.
  if (options.fuzzy && options.searchPattern && options.searchPattern !== '.') {
    const [files, directories] = await Promise.all([
      searchFuzzyFiles(resolvedPath, options),
      searchFuzzyDirectories(resolvedPath, options)
    ])
    return [...files, ...directories]
      .sort(compareScoredSearchEntries)
      .slice(0, options.maxEntries)
      .map((entry) => entry.path)
  }

  // List mode (searchPattern === '.') or non-fuzzy search: filename glob path.
  logger.debug('Searching by filename pattern', { pattern: options.searchPattern, path: resolvedPath })
  const filenameResults = await searchByFilename(resolvedPath, options)
  logger.debug('Found matches by filename', { count: filenameResults.length })
  return filenameResults.slice(0, options.maxEntries)
}

/**
 * List contents of a directory, with optional fuzzy / glob search.
 *
 * Returns a flat array of forward-slash-normalized paths. In list mode the
 * default maxEntries is `Number.MAX_SAFE_INTEGER` — no truncation. In search
 * mode the caller decides the cap via `options.maxEntries`.
 */
export async function listDirectory(
  dirPath: AbsoluteFilePath | string,
  options?: DirectoryListOptions
): Promise<string[]> {
  const mergedOptions: ResolvedOptions = {
    ...DEFAULT_DIRECTORY_LIST_OPTIONS,
    ...options
  }

  const resolvedPath = path.resolve(dirPath)

  const stat = await fs.promises.stat(resolvedPath).catch((error) => {
    logger.error(`Failed to access directory: ${resolvedPath}`, error as Error)
    throw error
  })

  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolvedPath}`)
  }

  if (mergedOptions.includeFiles && !(await resolveRipgrepBinary())) {
    throw new Error('Ripgrep binary not available')
  }

  return listDirectoryWithRipgrep(resolvedPath, mergedOptions)
}

/**
 * Like {@link listDirectory}, but classifies each entry as file vs directory in
 * the same round trip. Lets renderer callers (e.g. the artifact file tree's
 * lazy expansion) avoid a follow-up `isDirectory` IPC per entry — the `stat`s
 * happen here, batched on the main side, instead of N renderer→main calls.
 */
export async function listDirectoryEntries(
  dirPath: AbsoluteFilePath | string,
  options?: DirectoryListOptions
): Promise<DirectoryEntry[]> {
  const paths = await listDirectory(dirPath, options)
  const entries = await Promise.all(
    paths.map(async (entryPath) => {
      try {
        const stat = await fs.promises.stat(entryPath)
        return { path: entryPath as AbsoluteFilePath, isDirectory: stat.isDirectory() }
      } catch {
        // Entry vanished between listing and stat — drop it (matches the
        // renderer's old per-entry isDirectory failure handling).
        return null
      }
    })
  )
  return entries.filter((entry): entry is DirectoryEntry => entry !== null)
}
