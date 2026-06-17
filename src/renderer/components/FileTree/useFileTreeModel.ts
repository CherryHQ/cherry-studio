/**
 * Bridge to `@pierre/trees` model utilities.
 *
 * This is the only renderer file that may import from `@pierre/trees`,
 * and it must import from the package root only. The `/react`, `/ssr`,
 * and `/web-components` entries pull in Preact and are blocked by ESLint.
 *
 * The FileTree renderer still owns the React UI. @pierre/trees is used here
 * only to prepare and validate canonical file-tree paths.
 */
import { type FileTreePreparedInput, prepareFileTreeInput, preparePresortedFileTreeInput } from '@pierre/trees'
import { useMemo } from 'react'

import type { FileTreeNode } from './types'

export interface FileTreeModel {
  nodes: FileTreeNode[]
  paths: readonly string[]
  preparedInput: FileTreePreparedInput
}

export interface FileTreeModelOptions {
  presorted?: boolean
}

function toTreePath(node: FileTreeNode): string {
  if (node.kind === 'folder') {
    return node.path.endsWith('/') ? node.path : `${node.path}/`
  }

  return node.path
}

function collectTreePaths(nodes: FileTreeNode[], result: string[] = []): string[] {
  for (const node of nodes) {
    result.push(toTreePath(node))

    if (node.children?.length) {
      collectTreePaths(node.children, result)
    }
  }

  return result
}

export function buildFileTreeModel(nodes: FileTreeNode[], options: FileTreeModelOptions = {}): FileTreeModel {
  const paths = collectTreePaths(nodes)
  const preparedInput = options.presorted ? preparePresortedFileTreeInput(paths) : prepareFileTreeInput(paths)

  return {
    nodes,
    paths,
    preparedInput
  }
}

export function useFileTreeModel(nodes: FileTreeNode[], options: FileTreeModelOptions = {}): FileTreeModel {
  const presorted = options.presorted === true

  return useMemo(() => buildFileTreeModel(nodes, { presorted }), [nodes, presorted])
}
