import fs from 'node:fs/promises'
import path from 'node:path'

import { knowledgeSupportedFileExts } from '@shared/config/constant'
import type { DirectoryItemData, FileItemData, KnowledgeItem } from '@shared/data/types/knowledge'
import type { NotesTreeNode } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { copyFileIntoKnowledgeBaseAt } from '../storage/pathStorage'

const KNOWLEDGE_SUPPORTED_FILE_EXT_SET = new Set<string>(knowledgeSupportedFileExts)

export type ExpandedDirectoryNode =
  | {
      type: 'directory'
      data: Pick<DirectoryItemData, 'source' | 'path'>
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
  ownerId: string,
  node: NotesTreeNode,
  signal: AbortSignal
): Promise<ExpandedDirectoryNode | null> {
  if (node.type === 'file') {
    if (!KNOWLEDGE_SUPPORTED_FILE_EXT_SET.has(path.extname(node.externalPath).toLowerCase())) {
      return null
    }

    // Namespace each file under the directory owner's item id and keep its
    // subtree path (from `treePath`, already POSIX) so siblings sharing a
    // basename across subdirectories don't collide and the hierarchy survives.
    // The whole tree resolves under the base material root (raw/) via the helper.
    const subtreePath = node.treePath.replace(/^\/+/, '')
    const relativePath = await copyFileIntoKnowledgeBaseAt(baseId, node.externalPath, `${ownerId}/${subtreePath}`)
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
    const expandedChild = await expandDirectoryNode(baseId, ownerId, child, signal)
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
      source: node.externalPath,
      path: node.externalPath
    },
    children
  }
}

export async function expandDirectoryOwnerToTree(
  owner: KnowledgeItem,
  baseId: string,
  signal: AbortSignal
): Promise<ExpandedDirectoryNode[]> {
  if (owner.type !== 'directory') {
    throw new Error(`Knowledge item '${owner.id}' must be type 'directory', received '${owner.type}'`)
  }

  const resolvedPath = path.resolve(owner.data.path)
  const children = await readDirectoryTree(resolvedPath, signal)
  const expandedChildren: ExpandedDirectoryNode[] = []

  for (const child of children) {
    const expandedChild = await expandDirectoryNode(baseId, owner.id, child, signal)
    if (expandedChild) {
      expandedChildren.push(expandedChild)
    }
  }

  return expandedChildren
}
