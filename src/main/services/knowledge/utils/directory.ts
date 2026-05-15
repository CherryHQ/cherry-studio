import fs from 'node:fs/promises'
import path from 'node:path'

import type { FileEntryId } from '@shared/data/types/file'
import { isUnsupportedKnowledgeFileExt, type KnowledgeItem } from '@shared/data/types/knowledge'

import { ensureKnowledgeExternalFileEntry } from './file'

type DirectoryScanNode =
  | {
      type: 'directory'
      path: string
      children: DirectoryScanNode[]
    }
  | {
      type: 'file'
      path: string
    }

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
        fileEntryId: FileEntryId
      }
    }

async function readDirectoryTree(dirPath: string, signal: AbortSignal): Promise<DirectoryScanNode[]> {
  signal.throwIfAborted()
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  signal.throwIfAborted()
  const nodes: DirectoryScanNode[] = []

  for (const entry of entries) {
    signal.throwIfAborted()

    if (entry.name.startsWith('.')) {
      continue
    }

    const entryPath = path.join(dirPath, entry.name)
    signal.throwIfAborted()

    if (entry.isDirectory()) {
      nodes.push({
        type: 'directory',
        path: entryPath,
        children: await readDirectoryTree(entryPath, signal)
      })
      continue
    }

    if (entry.isFile()) {
      nodes.push({
        type: 'file',
        path: entryPath
      })
    }
  }

  return nodes
}

async function expandDirectoryNode(
  node: DirectoryScanNode,
  signal: AbortSignal
): Promise<ExpandedDirectoryNode | null> {
  if (node.type === 'file') {
    if (isUnsupportedKnowledgeFileExt(path.extname(node.path))) {
      return null
    }

    const entry = await ensureKnowledgeExternalFileEntry(node.path)
    signal.throwIfAborted()

    return {
      type: 'file',
      data: {
        source: node.path,
        fileEntryId: entry.id
      }
    }
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
      source: node.path,
      path: node.path
    },
    children
  }
}

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
