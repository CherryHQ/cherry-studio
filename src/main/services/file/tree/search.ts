/**
 * Directory search — ripgrep + fuzzy matching.
 *
 * Only `listDirectory` is public. All ripgrep / scoring internals are private.
 *
 * Two modes share one entry point, distinguished by `options.searchPattern`:
 *   - List mode (`searchPattern === '.'`, the default): enumerate the
 *     directory tree. No result cap by default — set `maxEntries` only when
 *     truncation is desired (e.g. autocomplete dropdowns).
 *   - Search mode (`searchPattern` is a user query): ripgrep glob pre-filter
 *     plus JS-side fuzzy scoring. Caller controls `maxEntries` for the
 *     dropdown size; the fuzzy branch can fall back to greedy substring
 *     matching when the glob misses everything.
 */

import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { loggerService } from '@logger'
import { isMac, isWin } from '@main/core/platform'
import { toAsarUnpackedPath } from '@main/utils'
import type { DirectoryListOptions, FilePath } from '@shared/types/file'

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

function resolveRipgrepBinaryPath(startDir: string = __dirname): string | null {
  const executable = isWin ? 'rg.exe' : 'rg'
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const platform = isMac ? 'darwin' : isWin ? 'win32' : 'linux'
  const tail = path.join(
    'node_modules',
    '@cherrystudio',
    'ripgrep',
    'vendor',
    'ripgrep',
    `${arch}-${platform}`,
    executable
  )

  // Walk up parents until we find the vendored `@cherrystudio/ripgrep`
  // checkout. This is robust to: production bundle (`out/main/…`), source
  // layout (`src/main/services/file/tree/…` under vitest), and any future
  // re-layering. Check the asar-unpacked sibling first: Electron can report
  // files inside app.asar as existing, but native child processes must be
  // spawned from the real filesystem path.
  let dir = startDir
  while (true) {
    const candidate = path.join(dir, tail)
    const unpacked = toAsarUnpackedPath(candidate)
    if (unpacked !== candidate && fs.existsSync(unpacked)) return unpacked
    if (fs.existsSync(candidate)) return candidate

    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  for (const entry of pathEntries) {
    const candidate = path.join(entry, executable)
    if (fs.existsSync(candidate)) return candidate
  }

  return null
}

function getRipgrepBinaryPath(): string | null {
  try {
    return resolveRipgrepBinaryPath()
  } catch (error) {
    logger.error('Failed to locate ripgrep binary:', error as Error)
    return null
  }
}

function executeRipgrep(args: string[]): Promise<{ exitCode: number; output: string }> {
  return new Promise((resolve, reject) => {
    const ripgrepBinaryPath = getRipgrepBinaryPath()

    if (!ripgrepBinaryPath) {
      reject(new Error('Ripgrep binary not available'))
      return
    }

    const child = spawn(ripgrepBinaryPath, ['--no-config', '--ignore-case', ...args], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let output = ''
    let errorOutput = ''

    child.stdout.on('data', (data: Buffer) => {
      output += data.toString()
    })

    child.stderr.on('data', (data: Buffer) => {
      errorOutput += data.toString()
    })

    child.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      // `code === null` happens when the process was killed by a signal
      // (SIGKILL / SIGTERM on OOM, parent crash, etc.). Coercing it to 0
      // would surface as "ripgrep exited successfully with no matches" =
      // an empty directory listing, which is indistinguishable from a real
      // empty result. Reject explicitly so callers can decide.
      if (code === null && signal !== null) {
        reject(new Error(`Ripgrep terminated by signal ${signal}: ${errorOutput || output}`))
        return
      }
      resolve({
        exitCode: code ?? 0,
        output: output || errorOutput
      })
    })

    child.on('error', (error: Error) => {
      reject(error)
    })
  })
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

      if (options.recursive && currentDepth < options.maxDepth) {
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

    const { exitCode, output } = await executeRipgrep(args)

    // Exit 0 = matches; 1 = no matches (still success); >=2 = error
    if (exitCode >= 2) {
      throw new Error(`Ripgrep failed with exit code ${exitCode}: ${output}`)
    }

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

// ─── Fuzzy + greedy scoring ────────────────────────────────────────────────

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

/**
 * Greedy substring match: query is matchable by stitching consecutive
 * substrings of `text` together (each substring as long as possible).
 * Example: "updatercontroller" matches "updateController" via
 * "update" + "r" (from Controller) + "controller".
 */
function isGreedySubstringMatch(text: string, query: string): boolean {
  const textLower = text.toLowerCase()
  const queryLower = query.toLowerCase()

  let queryIndex = 0
  let searchStart = 0

  while (queryIndex < queryLower.length) {
    let bestMatchLen = 0
    let bestMatchPos = -1

    for (let len = queryLower.length - queryIndex; len >= 1; len--) {
      const substr = queryLower.slice(queryIndex, queryIndex + len)
      const foundAt = textLower.indexOf(substr, searchStart)
      if (foundAt !== -1) {
        bestMatchLen = len
        bestMatchPos = foundAt
        break
      }
    }

    if (bestMatchLen === 0) return false

    queryIndex += bestMatchLen
    searchStart = bestMatchPos + bestMatchLen
  }

  return true
}

/**
 * Greedy match score (higher = better). Rewards fewer fragments, tighter
 * span, filename hits; penalizes long paths.
 */
function getGreedyMatchScore(filePath: string, query: string): number {
  const textLower = filePath.toLowerCase()
  const queryLower = query.toLowerCase()
  const fileName = filePath.split('/').pop() ?? ''
  const fileNameLower = fileName.toLowerCase()

  let queryIndex = 0
  let searchStart = 0
  let fragmentCount = 0
  let firstMatchPos = -1
  let lastMatchEnd = 0

  while (queryIndex < queryLower.length) {
    let bestMatchLen = 0
    let bestMatchPos = -1

    for (let len = queryLower.length - queryIndex; len >= 1; len--) {
      const substr = queryLower.slice(queryIndex, queryIndex + len)
      const foundAt = textLower.indexOf(substr, searchStart)
      if (foundAt !== -1) {
        bestMatchLen = len
        bestMatchPos = foundAt
        break
      }
    }

    if (bestMatchLen === 0) return -Infinity

    fragmentCount++
    if (firstMatchPos === -1) firstMatchPos = bestMatchPos
    lastMatchEnd = bestMatchPos + bestMatchLen
    queryIndex += bestMatchLen
    searchStart = lastMatchEnd
  }

  const matchSpan = lastMatchEnd - firstMatchPos
  let score = 0

  score += Math.max(0, 100 - (fragmentCount - 1) * 30)

  const spanRatio = queryLower.length / matchSpan
  score += spanRatio * 50

  if (isGreedySubstringMatch(fileNameLower, queryLower)) {
    score += 80
  }

  score -= Math.log(filePath.length + 1) * PATH_LENGTH_PENALTY_FACTOR

  return score
}

// ─── Main dispatch ─────────────────────────────────────────────────────────

async function listDirectoryWithRipgrep(resolvedPath: string, options: ResolvedOptions): Promise<string[]> {
  // Search mode w/ fuzzy: ripgrep glob pre-filter + JS-side scoring.
  if (options.fuzzy && options.searchPattern && options.searchPattern !== '.') {
    const args = buildRipgrepBaseArgs(options, resolvedPath)

    // Insert the glob pattern just before the path (last positional arg).
    const globPattern = queryToGlobPattern(options.searchPattern)
    args.splice(args.length - 1, 0, '--iglob', globPattern)

    const { exitCode, output } = await executeRipgrep(args)

    if (exitCode >= 2) {
      throw new Error(`Ripgrep failed with exit code ${exitCode}: ${output}`)
    }

    const filteredFiles = output
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => line.replace(/\\/g, '/'))

    if (filteredFiles.length > 0) {
      return filteredFiles
        .filter((file) => isFuzzyMatch(file, options.searchPattern))
        .map((file) => ({ file, score: getFuzzyMatchScore(file, options.searchPattern) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, options.maxEntries)
        .map((item) => item.file)
    }

    // Fallback: no glob hits → greedy substring match across all files.
    logger.debug('Fuzzy glob returned no results, falling back to greedy substring match')
    const fallbackArgs = buildRipgrepBaseArgs(options, resolvedPath)
    const fallbackResult = await executeRipgrep(fallbackArgs)

    if (fallbackResult.exitCode >= 2) {
      return []
    }

    const allFiles = fallbackResult.output
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => line.replace(/\\/g, '/'))

    return allFiles
      .filter((file) => isGreedySubstringMatch(file, options.searchPattern))
      .map((file) => ({ file, score: getGreedyMatchScore(file, options.searchPattern) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, options.maxEntries)
      .map((item) => item.file)
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
export async function listDirectory(dirPath: FilePath | string, options?: DirectoryListOptions): Promise<string[]> {
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

  if (!getRipgrepBinaryPath()) {
    throw new Error('Ripgrep binary not available')
  }

  return listDirectoryWithRipgrep(resolvedPath, mergedOptions)
}
