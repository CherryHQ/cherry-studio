import fs from 'node:fs/promises'
import path from 'node:path'

import { getFileType } from '@main/utils/file'
import type { FileMetadata } from '@shared/data/types/file'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import type { NotesTreeNode } from '@types'
import { v4 as uuidv4 } from 'uuid'

export type ExpandedDirectoryNode =
  | {
      type: 'directory'
      data: {
        source: string
        path: string
      }
      children: ExpandedDirectoryNode[]
    }
  | {
      type: 'file'
      data: {
        source: string
        file: FileMetadata
      }
    }

/**
 * Recursively reads a directory tree and converts it into note-tree nodes.
 */
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

/**
 * Builds file metadata for an external file path so it can be stored as a
 * knowledge file item.
 */
async function createExternalFileMetadata(filePath: string, signal: AbortSignal): Promise<FileMetadata> {
  const stats = await fs.stat(filePath)
  signal.throwIfAborted()
  const originName = path.basename(filePath)
  const ext = path.extname(originName)

  return {
    id: uuidv4(),
    origin_name: originName,
    name: originName,
    path: filePath,
    created_at: stats.birthtime.toISOString(),
    size: stats.size,
    ext,
    type: getFileType(ext),
    count: 1
  }
}

async function expandDirectoryNode(node: NotesTreeNode, signal: AbortSignal): Promise<ExpandedDirectoryNode | null> {
  if (node.type === 'file') {
    return {
      type: 'file',
      data: {
        source: node.externalPath,
        file: await createExternalFileMetadata(node.externalPath, signal)
      }
    }
  }

  if (node.type !== 'folder') {
    return null
  }

  const children: ExpandedDirectoryNode[] = []

  for (const child of node.children ?? []) {
    const expandedChild = await expandDirectoryNode(child, signal)
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

/**
 * Expands a directory owner item into a tree of child knowledge item inputs.
 */
export async function expandDirectoryOwnerToTree(
  owner: KnowledgeItem,
  signal: AbortSignal
): Promise<ExpandedDirectoryNode[]> {
  if (owner.type !== 'directory') {
    throw new Error(`Knowledge item '${owner.id}' must be type 'directory', received '${owner.type}'`)
  }

  const resolvedPath = path.resolve(owner.data.path)
  const children = await readDirectoryTree(resolvedPath, signal)
  const expandedChildren: ExpandedDirectoryNode[] = []

  for (const child of children) {
    const expandedChild = await expandDirectoryNode(child, signal)
    if (expandedChild) {
      expandedChildren.push(expandedChild)
    }
  }

  return expandedChildren
}
