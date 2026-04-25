import { useMultiplePreferences } from '@data/hooks/usePreference'
import type { Topic } from '@renderer/types'
import { groupBy, uniq } from 'lodash'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface TopicFolderGroup {
  folder: string
  topics: Topic[]
}

export const useTopicFolders = (assistantId: string, pinnedTopics: Topic[]) => {
  const { t } = useTranslation()
  const [foldersState, setFoldersState] = useMultiplePreferences({
    foldersOrder: 'topic.folders.order',
    collapsedFolders: 'topic.folders.collapsed'
  })

  const topicFoldersOrder = foldersState.foldersOrder
  const collapsedFolders = foldersState.collapsedFolders

  const allFolders = useMemo(() => {
    const folders = uniq(pinnedTopics.map((topic) => topic.folder).filter((f): f is string => !!f))
    const savedOrder = topicFoldersOrder[assistantId] || []
    if (savedOrder.length > 0) {
      return [
        ...savedOrder.filter((folder) => folders.includes(folder)),
        ...folders.filter((folder) => !savedOrder.includes(folder))
      ]
    }
    return folders
  }, [pinnedTopics, assistantId, topicFoldersOrder])

  const getGroupedPinnedTopics = useMemo((): TopicFolderGroup[] => {
    const grouped = Object.entries(groupBy(pinnedTopics, 'folder')).map(([folder, topics]) => ({
      folder: folder === 'undefined' || !folder ? t('chat.topics.folder.uncategorized') : folder,
      topics
    }))

    const uncategorizedIndex = grouped.findIndex((g) => g.folder === t('chat.topics.folder.uncategorized'))
    if (uncategorizedIndex > -1) {
      const [uncategorized] = grouped.splice(uncategorizedIndex, 1)
      grouped.unshift(uncategorized)
    }

    if (allFolders.length > 0) {
      const uncategorized = grouped.find((g) => g.folder === t('chat.topics.folder.uncategorized'))
      const sortedFolders = grouped.filter((g) => g.folder !== t('chat.topics.folder.uncategorized'))

      sortedFolders.sort((a, b) => {
        const indexA = allFolders.indexOf(a.folder)
        const indexB = allFolders.indexOf(b.folder)
        if (indexA === -1 && indexB === -1) return 0
        if (indexA === -1) return 1
        if (indexB === -1) return -1
        return indexA - indexB
      })

      if (uncategorized) {
        sortedFolders.unshift(uncategorized)
      }
      return sortedFolders
    }

    return grouped
  }, [pinnedTopics, allFolders, t])

  const isCollapsed = useCallback(
    (folder: string) => {
      return (collapsedFolders[assistantId] || []).includes(folder)
    },
    [assistantId, collapsedFolders]
  )

  const toggleFolderCollapse = useCallback(
    async (folder: string) => {
      const current = collapsedFolders[assistantId] || []
      let newCollapsed: string[]
      if (current.includes(folder)) {
        newCollapsed = current.filter((f) => f !== folder)
      } else {
        newCollapsed = [...current, folder]
      }
      await setFoldersState({
        foldersOrder: { ...topicFoldersOrder, [assistantId]: allFolders },
        collapsedFolders: { ...collapsedFolders, [assistantId]: newCollapsed }
      })
    },
    [assistantId, collapsedFolders, topicFoldersOrder, allFolders, setFoldersState]
  )

  const createFolder = useCallback(
    async (name: string) => {
      const currentOrder = topicFoldersOrder[assistantId] || []
      await setFoldersState({
        foldersOrder: { ...topicFoldersOrder, [assistantId]: [...currentOrder, name] }
      })
    },
    [assistantId, topicFoldersOrder, setFoldersState]
  )

  const renameFolder = useCallback(
    async (oldName: string, newName: string) => {
      const currentOrder = topicFoldersOrder[assistantId] || []
      const newOrder = currentOrder.map((f) => (f === oldName ? newName : f))
      await setFoldersState({
        foldersOrder: { ...topicFoldersOrder, [assistantId]: newOrder }
      })
    },
    [assistantId, topicFoldersOrder, setFoldersState]
  )

  const deleteFolder = useCallback(
    async (name: string) => {
      const currentOrder = topicFoldersOrder[assistantId] || []
      const newOrder = currentOrder.filter((f) => f !== name)
      const currentCollapsed = collapsedFolders[assistantId] || []
      const newCollapsed = currentCollapsed.filter((f) => f !== name)
      await setFoldersState({
        foldersOrder: { ...topicFoldersOrder, [assistantId]: newOrder },
        collapsedFolders: { ...collapsedFolders, [assistantId]: newCollapsed }
      })
    },
    [assistantId, topicFoldersOrder, collapsedFolders, setFoldersState]
  )

  return {
    allFolders,
    getGroupedPinnedTopics,
    isCollapsed,
    toggleFolderCollapse,
    createFolder,
    renameFolder,
    deleteFolder
  }
}
