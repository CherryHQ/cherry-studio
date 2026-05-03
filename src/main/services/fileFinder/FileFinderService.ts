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
const EMPTY_RESULT: FinderSearchResult = {
  items: [],
  totalMatched: 0,
  totalFiles: 0,
  totalDirs: 0
}

export const search = async (args: FinderSearchArgs): Promise<FinderSearchResult> => {
  const { basePath } = args
  if (!basePath) return EMPTY_RESULT

  const query = args.query?.trim() || '.'
  const pageSize = clamp(args.pageSize ?? DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE)
  const pageIndex = Math.max(0, args.pageIndex ?? 0)

  try {
    const finder = await getFinder(basePath)
    const result = finder.mixedSearch(query, {
      pageIndex,
      pageSize,
      currentFile: args.currentFile
    })
    if (!result.ok) {
      logger.warn('mixedSearch failed', { basePath, query, error: result.error })
      return EMPTY_RESULT
    }

    const { items: rawItems, scores, totalMatched, totalFiles, totalDirs } = result.value
    const items: FinderItem[] = rawItems.map((entry, i) => {
      const score = scores[i]?.total
      if (entry.type === 'file') {
        return {
          type: 'file',
          relativePath: entry.item.relativePath,
          name: entry.item.fileName,
          score,
          gitStatus: entry.item.gitStatus
        }
      }
      return {
        type: 'directory',
        relativePath: entry.item.relativePath,
        name: entry.item.dirName,
        score
      }
    })

    return { items, totalMatched, totalFiles, totalDirs }
  } catch (err) {
    logger.warn('search failed', { basePath, query, error: String(err) })
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
