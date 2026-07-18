import fs from 'node:fs/promises'
import path from 'node:path'

import { nextFreeKnowledgeRelativePath } from '@main/utils/knowledge'
import type { DirectoryItemData, FileItemData, KnowledgeItem } from '@shared/data/types/knowledge'
import { knowledgeSupportedFileExts } from '@shared/utils/file'

import { copyFileIntoKnowledgeBaseAt } from '../../pathStorage'

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
  signal: AbortSignal
): Promise<ExpandedDirectoryNode | null> {
  if (node.type === 'file') {
    if (!KNOWLEDGE_SUPPORTED_FILE_EXT_SET.has(path.extname(node.externalPath).toLowerCase())) {
      return null
    }

    // Namespace each file under the owner directory's (deduped) basename and keep
    // its subtree path (from `treePath`, already POSIX) so siblings sharing a
    // basename across subdirectories don't collide and the hierarchy survives.
    // The whole tree resolves under the base material root (raw/) via the helper.
    const subtreePath = node.treePath.replace(/^\/+/, '')
    // Thread the abort signal so a hung single-file copy can be interrupted, and allow
    // overwrite so a retry after a mid-scan abort re-copies over its own leftover files
    // instead of failing on the pre-existing dest (see prepareRoot retry idempotency).
    const relativePath = await copyFileIntoKnowledgeBaseAt(baseId, node.externalPath, `${pathPrefix}/${subtreePath}`, {
      signal,
      overwrite: true
    })
    signal.throwIfAborted()

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
    const expandedChild = await expandDirectoryNode(baseId, pathPrefix, child, signal)
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
  return nextFreeKnowledgeRelativePath(
    path.basename(resolvedPath),
    (candidate) => !reservedTopLevelNames.has(candidate),
    false // a directory basename is not a filename — keep any trailing ".ext" intact
  )
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
  signal: AbortSignal
): Promise<ExpandedDirectoryNode[]> {
  if (owner.type !== 'directory') {
    throw new Error(`Knowledge item '${owner.id}' must be type 'directory', received '${owner.type}'`)
  }

  const resolvedPath = path.resolve(owner.data.source)
  const children = await readDirectoryTree(resolvedPath, signal)
  const expandedChildren: ExpandedDirectoryNode[] = []

  for (const child of children) {
    const expandedChild = await expandDirectoryNode(baseId, pathPrefix, child, signal)
    if (expandedChild) {
      expandedChildren.push(expandedChild)
    }
  }

  return expandedChildren
}
