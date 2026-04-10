import fs from 'node:fs/promises'
import path from 'node:path'

import { getFileType } from '@main/utils/file'
import type { CreateKnowledgeItemsDto } from '@shared/data/api/schemas/knowledges'
import type { FileMetadata } from '@shared/data/types/file'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import type { NotesTreeNode } from '@types'
import { v4 as uuidv4 } from 'uuid'

type CreateKnowledgeItemInput = CreateKnowledgeItemsDto['items'][number]

/**
 * Recursively reads a directory tree and converts it into note-tree nodes.
 */
async function readDirectoryTree(dirPath: string, rootPath: string = dirPath): Promise<NotesTreeNode[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const nodes: NotesTreeNode[] = []

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue
    }

    const entryPath = path.join(dirPath, entry.name)
    const stats = await fs.stat(entryPath)
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
        children: await readDirectoryTree(entryPath, rootPath)
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
async function createExternalFileMetadata(filePath: string): Promise<FileMetadata> {
  const stats = await fs.stat(filePath)
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

type GroupingTarget = { groupId: string } | { groupRef: string }

/**
 * Flattens a directory node into create-item inputs while preserving the
 * parent-child grouping relationship.
 */
async function flattenDirectoryNode(node: NotesTreeNode, parent: GroupingTarget): Promise<CreateKnowledgeItemInput[]> {
  if (node.type === 'file') {
    return [
      {
        ...parent,
        type: 'file',
        data: {
          file: await createExternalFileMetadata(node.externalPath)
        }
      }
    ]
  }

  if (node.type !== 'folder') {
    return []
  }

  const ref = node.treePath === '/' ? 'root' : `dir:${node.treePath}`
  const items: CreateKnowledgeItemInput[] = [
    {
      ref,
      ...parent,
      type: 'directory',
      data: {
        name: node.name,
        path: node.externalPath
      }
    }
  ]

  for (const child of node.children ?? []) {
    items.push(...(await flattenDirectoryNode(child, { groupRef: ref })))
  }

  return items
}

/**
 * Expands a directory owner item into a batch of child knowledge items that
 * mirror the directory structure on disk.
 */
export async function expandDirectoryOwnerToCreateItems(
  owner: KnowledgeItem
): Promise<CreateKnowledgeItemsDto['items']> {
  if (owner.type !== 'directory') {
    throw new Error(`Knowledge item '${owner.id}' must be type 'directory', received '${owner.type}'`)
  }

  const resolvedPath = path.resolve(owner.data.path)
  const children = await readDirectoryTree(resolvedPath)
  const items: CreateKnowledgeItemsDto['items'] = []

  for (const child of children) {
    items.push(...(await flattenDirectoryNode(child, { groupId: owner.id })))
  }

  return items
}
