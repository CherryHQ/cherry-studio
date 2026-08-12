import fs from 'node:fs/promises'
import path from 'node:path'

import { foldKnowledgeRelativePath, nextFreeKnowledgeRelativePath } from '@main/utils/knowledge'
import type { DirectoryItemData, FileItemData, KnowledgeItem } from '@shared/data/types/knowledge'
import { knowledgeSupportedFileExts, sanitizeFilename } from '@shared/utils/file'

import { assertSafeKnowledgeRelativePath, copyFileIntoKnowledgeBaseAt } from '../../pathStorage'

const KNOWLEDGE_SUPPORTED_FILE_EXT_SET = new Set<string>(knowledgeSupportedFileExts)

/** A scanned filesystem entry under a directory owner — only the fields this module reads. */
interface DirectoryEntryNode {
  type: 'file' | 'folder'
  /** Absolute path of the entry on disk. */
  externalPath: string
  /** POSIX path of the entry relative to the scanned root, prefixed with `/`. */
  treePath: string
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

async function readDirectoryTree(
  dirPath: string,
  signal: AbortSignal,
  rootPath: string = dirPath
): Promise<DirectoryEntryNode[]> {
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
    const relativePath = path.relative(rootPath, entryPath)
    const treePath = `/${relativePath.replace(/\\/g, '/')}`

    if (entry.isDirectory()) {
      nodes.push({
        type: 'folder',
        treePath,
        externalPath: entryPath,
        children: await readDirectoryTree(entryPath, signal, rootPath)
      })
      continue
    }

    if (entry.isFile()) {
      nodes.push({
        type: 'file',
        treePath,
        externalPath: entryPath
      })
    }
  }

  return nodes
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

    // Namespace each file under the owner directory's (deduped) basename and keep
    // its subtree path (from `treePath`, already POSIX) so siblings sharing a
    // basename across subdirectories don't collide and the hierarchy survives.
    // The whole tree resolves under the base material root (raw/) via the helper.
    // Sanitized per segment, not over the whole path: the separators are structure the
    // scan produced, while each segment is a real on-disk name that may have no Windows
    // spelling (see getKnowledgeSourceRelativePath for what that costs a backup).
    const subtreePath = node.treePath
      .replace(/^\/+/, '')
      .split('/')
      .map((segment) => sanitizeFilename(segment))
      .join('/')
    // Two scanned files can want one slot even though the scan found them under distinct
    // names: sanitizing maps `a<b.md` and `a>b.md` onto `a_b.md`, and a case-sensitive
    // source directory can hold both `a.md` and `A.md`, which are one file wherever the
    // backup is restored. The copy below overwrites, so an unclaimed collision loses a
    // file silently.
    const materialPath = nextFreeKnowledgeRelativePath(
      `${pathPrefix}/${subtreePath}`,
      (candidate) => !claimedPaths.has(foldKnowledgeRelativePath(candidate))
    )
    claimedPaths.add(foldKnowledgeRelativePath(materialPath))
    // Both halves were guarded on their own (`pathPrefix` in expandDirectory,
    // `treePath` by the tree layer), but the join is a new path — assert it here,
    // which is also what brands it for `copyFileIntoKnowledgeBaseAt`.
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

  const children: ExpandedDirectoryNode[] = []

  for (const child of node.children ?? []) {
    const expandedChild = await expandDirectoryNode(baseId, pathPrefix, child, signal, onFileCopied, claimedPaths)
    if (expandedChild) {
      children.push(expandedChild)
    }
  }

  if (children.length === 0) {
    return null
  }

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
 * reserveImportedFileRelativePath). Pure — no I/O — so the caller can pin it onto the
 * container's `relativePath` BEFORE any byte is copied, making a mid-expansion crash
 * recoverable (the retry reclaims `raw/<pathPrefix>` from the pinned row).
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
  const sourceName = sanitizeFilename(path.basename(resolvedPath)) || rootName || 'root'
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
  // Scoped to this expansion: everything it writes lives under `pathPrefix`, which the
  // caller already claimed against the rest of the base, and a retry reclaims the whole
  // prefix before rescanning — so there is nothing outside to collide with.
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
