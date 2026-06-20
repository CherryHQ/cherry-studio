import fs from 'node:fs/promises'
import path from 'node:path'

import { nextFreeKnowledgeRelativePath } from '@main/utils/knowledge'
import type { DirectoryItemData, FileItemData, KnowledgeItem } from '@shared/data/types/knowledge'
import { knowledgeSupportedFileExts } from '@shared/utils/file'
import type { NotesTreeNode } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { copyFileIntoKnowledgeBaseAt } from '../storage/pathStorage'

const KNOWLEDGE_SUPPORTED_FILE_EXT_SET = new Set<string>(knowledgeSupportedFileExts)

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

/**
 * Result of expanding a directory owner: the deduped `raw/` prefix its files were
 * stored under (to pin onto the owner's `relativePath`) plus the child tree.
 */
export interface ExpandedDirectoryTree {
  pathPrefix: string
  children: ExpandedDirectoryNode[]
}

async function readDirectoryTree(
  dirPath: string,
  signal: AbortSignal,
  rootPath: string = dirPath
): Promise<NotesTreeNode[]> {
  signal.throwIfAborted()
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  signal.throwIfAborted()
  const nodes: NotesTreeNode[] = []

  for (const entry of entries) {
    signal.throwIfAborted()

    if (entry.name.startsWith('.')) {
      continue
    }

    const entryPath = path.join(dirPath, entry.name)
    const stats = await fs.stat(entryPath)
    signal.throwIfAborted()
    const relativePath = path.relative(rootPath, entryPath)
    const treePath = `/${relativePath.replace(/\\/g, '/')}`

    if (entry.isDirectory()) {
      nodes.push({
        id: uuidv4(),
        name: entry.name,
        type: 'folder',
        treePath,
        externalPath: entryPath,
        createdAt: stats.birthtime.toISOString(),
        updatedAt: stats.mtime.toISOString(),
        children: await readDirectoryTree(entryPath, signal, rootPath)
      })
      continue
    }

    if (entry.isFile()) {
      nodes.push({
        id: uuidv4(),
        name: entry.name,
        type: 'file',
        treePath,
        externalPath: entryPath,
        createdAt: stats.birthtime.toISOString(),
        updatedAt: stats.mtime.toISOString()
      })
    }
  }

  return nodes
}

async function expandDirectoryNode(
  baseId: string,
  pathPrefix: string,
  node: NotesTreeNode,
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
    const relativePath = await copyFileIntoKnowledgeBaseAt(baseId, node.externalPath, `${pathPrefix}/${subtreePath}`)
    signal.throwIfAborted()

    return {
      type: 'file',
      data: {
        source: node.externalPath,
        relativePath
      }
    }
  }

  if (node.type !== 'folder') {
    return null
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

export async function expandDirectoryOwnerToTree(
  owner: KnowledgeItem,
  baseId: string,
  reservedTopLevelNames: Set<string>,
  signal: AbortSignal
): Promise<ExpandedDirectoryTree> {
  if (owner.type !== 'directory') {
    throw new Error(`Knowledge item '${owner.id}' must be type 'directory', received '${owner.type}'`)
  }

  // The original folder to scan lives in `source` (shared by every item type). `path`
  // was retired in favour of a `relativePath` written back from `pathPrefix` below.
  const resolvedPath = path.resolve(owner.data.source)
  // Store children under the directory's own name (e.g. `raw/docs/...`) instead of
  // the opaque owner UUID, so the on-disk layout mirrors what the user picked. When
  // that top-level name is already taken under raw/, dedupe it with a `_N` suffix —
  // the same strategy file imports use (see reserveImportedFileRelativePath).
  const pathPrefix = nextFreeKnowledgeRelativePath(
    path.basename(resolvedPath),
    (candidate) => !reservedTopLevelNames.has(candidate),
    false // a directory basename is not a filename — keep any trailing ".ext" intact
  )

  const children = await readDirectoryTree(resolvedPath, signal)
  const expandedChildren: ExpandedDirectoryNode[] = []

  for (const child of children) {
    const expandedChild = await expandDirectoryNode(baseId, pathPrefix, child, signal)
    if (expandedChild) {
      expandedChildren.push(expandedChild)
    }
  }

  return { pathPrefix, children: expandedChildren }
}
