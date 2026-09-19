import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { foldKnowledgeRelativePath, nextFreeKnowledgeRelativePath } from '@main/utils/knowledge'
import type { DirectoryItemData, FileItemData, KnowledgeItem } from '@shared/data/types/knowledge'
import { knowledgeSupportedFileExts, sanitizeFilename } from '@shared/utils/file'

import { assertSafeKnowledgeRelativePath, copyFileIntoKnowledgeBaseAt } from '../../pathStorage'

const logger = loggerService.withContext('Knowledge:DirectorySource')
const KNOWLEDGE_SUPPORTED_FILE_EXT_SET = new Set<string>(knowledgeSupportedFileExts)

/** A scanned filesystem entry under a directory owner — only the fields this module reads. */
interface DirectoryEntryNode {
  type: 'file' | 'folder'
  /** Absolute path of the entry on disk. */
  externalPath: string
  /**
   * The entry's own name as `readdir` reported it — one segment, never a path, so the stored
   * path can be assembled segment by segment while descending (sanitize + claim each level).
   */
  name: string
  children?: DirectoryEntryNode[]
}

export type ExpandedDirectoryNode =
  | {
      type: 'directory'
      data: Pick<DirectoryItemData, 'source'>
      children: ExpandedDirectoryNode[]
    }
  | {
      type: 'file'
      data: Pick<FileItemData, 'source' | 'relativePath'>
    }

async function readDirectoryTree(dirPath: string, signal: AbortSignal): Promise<DirectoryEntryNode[]> {
  signal.throwIfAborted()
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  signal.throwIfAborted()
  const nodes: DirectoryEntryNode[] = []

  for (const entry of entries) {
    signal.throwIfAborted()

    if (entry.name.startsWith('.')) {
      continue
    }

    const entryPath = path.join(dirPath, entry.name)

    if (entry.isDirectory()) {
      nodes.push({
        type: 'folder',
        name: entry.name,
        externalPath: entryPath,
        children: await readDirectoryTree(entryPath, signal)
      })
      continue
    }

    if (entry.isFile()) {
      nodes.push({
        type: 'file',
        name: entry.name,
        externalPath: entryPath
      })
    }
  }

  return nodes
}

/**
 * `name` made portable, recording the rename — it is also the name the item will be listed
 * under, so this log is the only place that explains why it is not what the user picked.
 */
function sanitizeSegment(name: string): string {
  const sanitized = sanitizeFilename(name)
  if (sanitized !== name) {
    logger.info('Renamed knowledge material to a portable name', { original: name, stored: sanitized })
  }
  return sanitized
}

/**
 * The first variant of `desiredPath` no sibling has taken, folded so a slot that only a
 * case-sensitive filesystem keeps apart counts as taken.
 *
 * Files and directories share one namespace here because they share one on disk: whichever
 * of a folder `a<b.md` and a file `a>b.md` lands second would abort the whole import.
 */
function freeSlot(desiredPath: string, isFile: boolean, claimedPaths: Set<string>): string {
  // A folder named `report.v2` dedupes to `report.v2_1`, not `report_1.v2`.
  return nextFreeKnowledgeRelativePath(
    desiredPath,
    (candidate) => !claimedPaths.has(foldKnowledgeRelativePath(candidate)),
    isFile
  )
}

function claimSlot(desiredPath: string, isFile: boolean, claimedPaths: Set<string>): string {
  const claimed = freeSlot(desiredPath, isFile, claimedPaths)
  claimedPaths.add(foldKnowledgeRelativePath(claimed))
  return claimed
}

async function expandDirectoryNode(
  baseId: string,
  pathPrefix: string,
  node: DirectoryEntryNode,
  signal: AbortSignal,
  onFileCopied: () => void,
  claimedPaths: Set<string>
): Promise<ExpandedDirectoryNode | null> {
  if (node.type === 'file') {
    if (!KNOWLEDGE_SUPPORTED_FILE_EXT_SET.has(path.extname(node.externalPath).toLowerCase())) {
      return null
    }

    // Sanitized per segment (here, one segment per recursion level) rather than over the
    // assembled path, which would turn every `/` into `_`.
    const materialPath = claimSlot(`${pathPrefix}/${sanitizeSegment(node.name)}`, true, claimedPaths)
    // The join is a new path even though both halves were guarded on their own — assert it
    // here, which is also what brands it for `copyFileIntoKnowledgeBaseAt`.
    assertSafeKnowledgeRelativePath(materialPath)
    // Thread the abort signal so a hung single-file copy can be interrupted, and allow
    // overwrite so a retry after a mid-scan abort re-copies over its own leftover files
    // instead of failing on the pre-existing dest (see prepareRoot retry idempotency).
    const relativePath = await copyFileIntoKnowledgeBaseAt(baseId, node.externalPath, materialPath, {
      signal,
      overwrite: true
    })
    signal.throwIfAborted()
    onFileCopied()

    return {
      type: 'file',
      data: {
        source: node.externalPath,
        relativePath
      }
    }
  }

  // Claimed only after descending, so a folder holding nothing indexable does not consume a
  // name a later sibling could have had. Named first because children build on it.
  const dirPath = freeSlot(`${pathPrefix}/${sanitizeSegment(node.name)}`, false, claimedPaths)
  const children: ExpandedDirectoryNode[] = []

  for (const child of node.children ?? []) {
    const expandedChild = await expandDirectoryNode(baseId, dirPath, child, signal, onFileCopied, claimedPaths)
    if (expandedChild) {
      children.push(expandedChild)
    }
  }

  if (children.length === 0) {
    return null
  }
  claimedPaths.add(foldKnowledgeRelativePath(dirPath))

  return {
    type: 'directory',
    data: {
      source: node.externalPath
    },
    children
  }
}

/**
 * The deduped top-level `raw/` prefix a directory owner's files will be stored under —
 * its own name (e.g. `raw/docs/...`) instead of the opaque owner UUID, so the on-disk
 * layout mirrors what the user picked. When that name is already taken under raw/,
 * dedupe it with a `_N` suffix (the same strategy file imports use, see
 * reserveImportedFileRelativePath). No filesystem access (it only reads the owner row, and
 * logs if the name had to change), so the caller can pin it onto the container's
 * `relativePath` BEFORE any byte is copied, making a mid-expansion crash recoverable (the
 * retry reclaims `raw/<pathPrefix>` from the pinned row).
 */
export function chooseDirectoryPathPrefix(owner: KnowledgeItem, reservedTopLevelNames: Set<string>): string {
  if (owner.type !== 'directory') {
    throw new Error(`Knowledge item '${owner.id}' must be type 'directory', received '${owner.type}'`)
  }

  // The original folder to scan lives in `source` (shared by every item type). `path`
  // was retired in favour of a `relativePath` written back from `pathPrefix`.
  const resolvedPath = path.resolve(owner.data.source)
  const rootName = path.parse(resolvedPath).root.replace(/[:\\/]+/g, '')
  // Sanitized for the same reason the leaves are — the prefix is the first segment of
  // every child's stored path, so one unportable folder name taints the whole subtree.
  const sourceName = sanitizeSegment(path.basename(resolvedPath)) || rootName || 'root'
  const pathPrefix = nextFreeKnowledgeRelativePath(
    sourceName,
    // `reservedTopLevelNames` holds folded keys — `docs` and `Docs` are one namespace on a
    // case-insensitive host, so claiming the second would bury the first on restore.
    (candidate) => !reservedTopLevelNames.has(foldKnowledgeRelativePath(candidate)),
    false // a directory basename is not a filename — keep any trailing ".ext" intact
  )
  assertSafeKnowledgeRelativePath(pathPrefix)
  return pathPrefix
}

/**
 * Scan a directory owner's on-disk tree and durably copy every supported file into
 * `raw/<pathPrefix>/...`. The prefix is chosen and pinned by the caller
 * (`chooseDirectoryPathPrefix`) before this runs, so a mid-expansion crash leaves the
 * container row already pointing at `pathPrefix`; the next attempt's
 * `deletePreviousLeafExpansion` reclaims the whole `raw/<pathPrefix>` shell. This
 * function therefore does not clean up on failure — the retry-level reclaimer does,
 * and it also survives a hard kill this local cleanup could not.
 */
export async function expandDirectoryOwnerToTree(
  owner: KnowledgeItem,
  baseId: string,
  pathPrefix: string,
  signal: AbortSignal,
  onCopyProgress: (percent: number) => void
): Promise<ExpandedDirectoryNode[]> {
  if (owner.type !== 'directory') {
    throw new Error(`Knowledge item '${owner.id}' must be type 'directory', received '${owner.type}'`)
  }

  const resolvedPath = path.resolve(owner.data.source)
  const children = await readDirectoryTree(resolvedPath, signal)
  const expandedChildren: ExpandedDirectoryNode[] = []
  const totalFiles = countSupportedFiles(children)
  let copiedFiles = 0
  if (totalFiles > 0) {
    onCopyProgress(0)
  }
  const onFileCopied = () => {
    copiedFiles += 1
    onCopyProgress(Math.round((copiedFiles / totalFiles) * 100))
  }
  // Scoped to this expansion: everything it writes lives under the caller-claimed
  // `pathPrefix`, and a retry reclaims that whole prefix before rescanning.
  const claimedPaths = new Set<string>()

  for (const child of children) {
    const expandedChild = await expandDirectoryNode(baseId, pathPrefix, child, signal, onFileCopied, claimedPaths)
    if (expandedChild) {
      expandedChildren.push(expandedChild)
    }
  }

  return expandedChildren
}

function countSupportedFiles(nodes: DirectoryEntryNode[]): number {
  let count = 0
  for (const node of nodes) {
    if (node.type === 'file') {
      if (KNOWLEDGE_SUPPORTED_FILE_EXT_SET.has(path.extname(node.externalPath).toLowerCase())) {
        count += 1
      }
    } else {
      count += countSupportedFiles(node.children ?? [])
    }
  }
  return count
}
