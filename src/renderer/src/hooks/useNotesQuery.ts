import { useAppSelector } from '@renderer/store'
import { selectActiveFilePath } from '@renderer/store/note'
import { NotesTreeNode } from '@renderer/types/note'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

// 查找节点的工具函数
export const findNodeByPath = (tree: NotesTreeNode[], targetPath: string): NotesTreeNode | null => {
  for (const node of tree) {
    if (node.externalPath === targetPath) {
      return node
    }
    if (node.children) {
      const found = findNodeByPath(node.children, targetPath)
      if (found) return found
    }
  }
  return null
}

/**
 * 获取当前活动节点（基于useLiveQuery的树数据）
 */
export function useActiveNode(notesTree: NotesTreeNode[]) {
  const activeFilePath = useAppSelector(selectActiveFilePath)

  const activeNode = useMemo(() => {
    if (!notesTree || !activeFilePath) return null
    return findNodeByPath(notesTree, activeFilePath)
  }, [notesTree, activeFilePath])

  return {
    activeNode,
    hasActiveFile: !!activeFilePath
  }
}

/**
 * 文件内容同步的 hook - 用于手动失效文件内容缓存
 */
export function useFileContentSync() {
  const queryClient = useQueryClient()

  const invalidateFileContent = useCallback(
    (filePath: string) => {
      queryClient.invalidateQueries({
        queryKey: ['fileContent', filePath],
        exact: true
      })
    },
    [queryClient]
  )

  const refetchFileContent = useCallback(
    async (filePath: string) => {
      await queryClient.refetchQueries({
        queryKey: ['fileContent', filePath],
        exact: true
      })
    },
    [queryClient]
  )

  return {
    invalidateFileContent,
    refetchFileContent
  }
}

/**
 * 读取文件内容的 hook - 使用React Query管理
 */
export function useFileContent(filePath?: string) {
  return useQuery({
    queryKey: ['fileContent', filePath],
    queryFn: async () => {
      if (!filePath) return ''
      return await window.api.file.readExternal(filePath)
    },
    enabled: !!filePath,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
    retry: 1
  })
}
