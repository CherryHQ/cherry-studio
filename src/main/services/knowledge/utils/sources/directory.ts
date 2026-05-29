import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import type { FileEntryId } from '@shared/data/types/file'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { type FilePath, FilePathSchema } from '@shared/file/types'
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
        fileEntryId: FileEntryId
      }
    }

/**
 * Local node shape for directory-knowledge ingest. Mirrors the subset of
 * `NotesTreeNode` that `readDirectoryTree` builds, but brands `externalPath`
 * as `FilePath`: the path is canonicalized at the producer below, so the
 * `ensureExternalEntry` consumer trusts the brand instead of re-casting a
 * possibly-NFD raw path. (`NotesTreeNode` itself stays an untyped renderer
 * DTO — branding it is a cross-platform Notes-subsystem refactor tracked
 * separately.)
 */
interface DirectoryScanNode {
  id: string
  name: string
  type: 'folder' | 'file'
  treePath: string
  externalPath: FilePath
  createdAt: string
  updatedAt: string
  children?: DirectoryScanNode[]
}

async function readDirectoryTree(
  dirPath: string,
  signal: AbortSignal,
  rootPath: string = dirPath
): Promise<DirectoryScanNode[]> {
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
    const stats = await fs.stat(entryPath)
    signal.throwIfAborted()
    const relativePath = path.relative(rootPath, entryPath)
    const treePath = `/${relativePath.replace(/\\/g, '/')}`
    // Canonicalize at the producer: entry.name from fs.readdir is raw (NFD on
    // macOS APFS), so parsing here gives every node a canonical FilePath that
    // the ensureExternalEntry consumer can trust without re-casting.
    const externalPath = FilePathSchema.parse(entryPath)

    if (entry.isDirectory()) {
      nodes.push({
        id: uuidv4(),
        name: entry.name,
        type: 'folder',
        treePath,
        externalPath,
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
        externalPath,
        createdAt: stats.birthtime.toISOString(),
        updatedAt: stats.mtime.toISOString()
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
    const fileManager = application.get('FileManager')
    const entry = await fileManager.ensureExternalEntry({ externalPath: node.externalPath })
    signal.throwIfAborted()

    return {
      type: 'file',
      data: {
        source: node.externalPath,
        fileEntryId: entry.id
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
