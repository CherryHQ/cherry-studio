import { useMemo } from 'react'

import { findNodeByPath } from '@renderer/services/NotesTreeService'
import type { NotesTreeNode } from '@renderer/types/note'

/**
 * 获取当前活动节点（基于当前笔记树和活动文件路径）
 */
export function useActiveNode(notesTree: NotesTreeNode[], activeFilePath?: string) {
  const activeNode = useMemo(() => {
    if (!notesTree || !activeFilePath) return null
    return findNodeByPath(notesTree, activeFilePath)
  }, [notesTree, activeFilePath])

  return {
    activeNode,
    hasActiveFile: !!activeFilePath
  }
}
