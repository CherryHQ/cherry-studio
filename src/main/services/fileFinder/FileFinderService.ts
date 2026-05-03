/**
 * Renderer-facing wrapper around `@ff-labs/fff-node`.
 *
 * Owns the IPC surface for fuzzy file/directory search. The underlying
 * `getFinder` pool lives in `./finderPool` and is shared with the AI's
 * `fs__find` / `fs__grep` tools — this module only adds renderer-shape
 * payloads on top.
 *
 * Exports take the args object directly; `ipc.ts` strips `_event` at
 * the handler site.
 */

import { loggerService } from '@logger'

import { getFinder } from './finderPool'

const logger = loggerService.withContext('FileFinderService')

/** A single hit: a file or a directory under `basePath`. */
export interface FinderItem {
  type: 'file' | 'directory'
  /** Path relative to `basePath`, forward-slash separators. */
  relativePath: string
  /** Last segment — file name with extension, or directory name. */
  name: string
  /** fff combined score; absent on browse (empty-query) calls. */
  score?: number
  /**
   * Git working-tree status (`clean` / `modified` / `untracked` / …).
   * Only set on files; directories aren't tracked individually by fff.
   */
  gitStatus?: string
}

export interface FinderSearchArgs {
  /** Absolute path to the project root fff should index. */
  basePath: string
  /** Fuzzy query. Empty / `.` returns top-frecency entries. */
  query?: string
  /**
   * Bias scoring toward results near this file (e.g. the user's
   * currently open editor file). Distance penalty in fff's scoring.
   */
  currentFile?: string
  /** Default 0. */
  pageIndex?: number
  /** Default 50, hard-capped at 500. */
  pageSize?: number
}

export interface FinderSearchResult {
  items: FinderItem[]
  totalMatched: number
  totalFiles: number
  totalDirs: number
}

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 500
const DIR_SLOT_RATIO = 0.2
const MIN_DIR_SLOTS = 5
const EMPTY_RESULT: FinderSearchResult = {
  items: [],
  totalMatched: 0,
  totalFiles: 0,
  totalDirs: 0
}

function splitPathQuery(query: string): { prefix: string; term: string } {
  const stripped = query.replace(/^\/+/, '')
  const lastSlash = stripped.lastIndexOf('/')
  if (lastSlash === -1) return { prefix: '', term: stripped }
  return { prefix: stripped.slice(0, lastSlash + 1), term: stripped.slice(lastSlash + 1) }
}

/**
 * Match `prefix` as a path *segment* — at the start of the path or
 * after any `/`. Smart-case: case-insensitive when the prefix is all
 * lowercase (mirrors fff's `smartCase` default).
 *
 * Strict `startsWith` is wrong here: a user typing `@anthropic/src` is
 * looking for any `anthropic/src` segment, but the real directory is
 * `packages/anthropic/src`, which doesn't start with `anthropic/`.
 * `startsWith` would silently drop it. Path-segment containment
 * matches what users in other pickers (VS Code / Cursor) expect.
 */
function smartCaseSegmentMatch(relativePath: string, prefix: string): boolean {
  if (!prefix) return true
  const [haystack, needle] =
    prefix.toLowerCase() === prefix ? [relativePath.toLowerCase(), prefix] : [relativePath, prefix]
  return haystack.startsWith(needle) || haystack.includes('/' + needle)
}

export const search = async (args: FinderSearchArgs): Promise<FinderSearchResult> => {
  const { basePath } = args
  if (!basePath) return EMPTY_RESULT

  const rawQuery = args.query?.trim() || '.'
  const pageSize = clamp(args.pageSize ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
  const pageIndex = Math.max(0, args.pageIndex ?? 0)
  const dirSlots = Math.min(pageSize, Math.max(MIN_DIR_SLOTS, Math.floor(pageSize * DIR_SLOT_RATIO)))
  const fileSlots = pageSize - dirSlots

  const { prefix, term } = splitPathQuery(rawQuery)
  const fffQuery = term || prefix || '.'
  const fetchMultiplier = prefix ? 20 : 1

  try {
    const finder = await getFinder(basePath)
    const [dirRes, fileRes] = await Promise.all([
      Promise.resolve(
        finder.directorySearch(fffQuery, {
          pageIndex,
          pageSize: dirSlots * fetchMultiplier,
          currentFile: args.currentFile
        })
      ),
      Promise.resolve(
        finder.fileSearch(fffQuery, {
          pageIndex,
          pageSize: fileSlots * fetchMultiplier,
          currentFile: args.currentFile
        })
      )
    ])

    if (!dirRes.ok && !fileRes.ok) {
      logger.warn('search failed', {
        basePath,
        rawQuery,
        dirErr: dirRes.ok ? null : dirRes.error,
        fileErr: fileRes.ok ? null : fileRes.error
      })
      return EMPTY_RESULT
    }

    const passesPrefix = (relativePath: string) => smartCaseSegmentMatch(relativePath, prefix)

    const dirs: FinderItem[] = dirRes.ok
      ? dirRes.value.items
          .map((d, i) => ({
            type: 'directory' as const,
            relativePath: d.relativePath,
            name: d.dirName,
            score: dirRes.value.scores[i]?.total
          }))
          .filter((d) => passesPrefix(d.relativePath))
          .slice(0, dirSlots)
      : []
    const files: FinderItem[] = fileRes.ok
      ? fileRes.value.items
          .map((f, i) => ({
            type: 'file' as const,
            relativePath: f.relativePath,
            name: f.fileName,
            score: fileRes.value.scores[i]?.total,
            gitStatus: f.gitStatus
          }))
          .filter((f) => passesPrefix(f.relativePath))
          .slice(0, fileSlots)
      : []

    return {
      items: [...dirs, ...files],
      totalMatched: dirs.length + files.length,
      totalFiles: fileRes.ok ? fileRes.value.totalFiles : 0,
      totalDirs: dirRes.ok ? dirRes.value.totalDirs : 0
    }
  } catch (err) {
    logger.warn('search threw', { basePath, rawQuery, error: String(err) })
    return EMPTY_RESULT
  }
}

export interface FinderTrackArgs {
  basePath: string
  query: string
  selectedFilePath: string
}

/**
 * Tell fff that `selectedFilePath` was picked for `query`. Improves
 * future ranking via fff's frecency learner. Best-effort.
 */
export const trackSelection = async (args: FinderTrackArgs): Promise<void> => {
  try {
    const finder = await getFinder(args.basePath)
    const result = finder.trackQuery(args.query, args.selectedFilePath)
    if (!result.ok) {
      logger.debug('trackQuery non-ok', { error: result.error })
    }
  } catch (err) {
    logger.debug('trackSelection threw', { error: String(err) })
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
