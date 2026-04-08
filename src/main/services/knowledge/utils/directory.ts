import fs from 'node:fs/promises'
import path from 'node:path'

import { getFileType } from '@main/utils/file'
import type { CreateKnowledgeItemsDto } from '@shared/data/api/schemas/knowledges'
import type { FileMetadata } from '@shared/data/types/file'
import type { NotesTreeNode } from '@types'
import { v4 as uuidv4 } from 'uuid'

type CreateKnowledgeItemInput = CreateKnowledgeItemsDto['items'][number]

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

async function flattenDirectoryNode(node: NotesTreeNode, parentRef: string): Promise<CreateKnowledgeItemInput[]> {
  if (node.type === 'file') {
    return [
      {
        groupRef: parentRef,
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
      groupRef: parentRef,
      type: 'directory',
      data: {
        name: node.name,
        path: node.externalPath
      }
    }
  ]

  for (const child of node.children ?? []) {
    items.push(...(await flattenDirectoryNode(child, ref)))
  }

  return items
}

export async function expandDirectoryToCreateItems(directoryPath: string): Promise<CreateKnowledgeItemsDto['items']> {
  const resolvedPath = path.resolve(directoryPath)
  const rootName = path.basename(resolvedPath) || resolvedPath
  const children = await readDirectoryTree(resolvedPath)

  const items: CreateKnowledgeItemsDto['items'] = [
    {
      ref: 'root',
      type: 'directory',
      data: {
        name: rootName,
        path: resolvedPath
      }
    }
  ]

  for (const child of children) {
    items.push(...(await flattenDirectoryNode(child, 'root')))
  }

  return items
}
