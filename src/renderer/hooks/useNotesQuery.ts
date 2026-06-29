import type { NotesTreeNode } from '@renderer/types/note'
import { useCallback, useMemo } from 'react'
import useSWR, { useSWRConfig } from 'swr'

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

const fileContentKey = (filePath?: string) => (filePath ? `fileContent/${filePath}` : null)

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

/**
 * 文件内容同步的 hook - 失效文件内容缓存以触发重读。
 *
 * Uses the bound `mutate` (not the top-level one) so it always targets the
 * active SWR cache. A key-only `mutate` revalidates the currently mounted
 * `useFileContent(filePath)`, which covers the save / watcher-`change` flows.
 */
export function useFileContentSync() {
  const { mutate } = useSWRConfig()

  const invalidateFileContent = useCallback(
    (filePath: string) => {
      void mutate(fileContentKey(filePath))
    },
    [mutate]
  )

  return {
    invalidateFileContent
  }
}

/**
 * 读取文件内容的 hook - 使用 SWR 管理。
 *
 * The chokidar watcher (+ the save flow) is the source of truth for content
 * changes, so we don't time-poll. SWR re-reads on every switch-to-file (always
 * fresh on open) and on explicit `invalidateFileContent`. Focus/reconnect
 * revalidation is off: focus re-reads would be redundant with the watcher.
 */
export function useFileContent(filePath?: string) {
  return useSWR(fileContentKey(filePath), () => window.api.file.readExternal(filePath!), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    errorRetryCount: 1
  })
}
