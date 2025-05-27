import { Assistant } from '@renderer/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAssistants } from './useAssistant'

// 定义useTags的返回类型，包含所有标签和获取特定标签的助手函数
// 为了不增加新的概念，标签直接作为助手的属性，所以这里的标签是指助手的标签属性
// 但是为了方便管理，增加了一个获取特定标签的助手函数

export const useTags = () => {
  const { assistants } = useAssistants()
  const [allTags, setAllTags] = useState<string[]>([])
  const { t } = useTranslation()

  // 计算所有标签
  const calculateTags = useCallback(() => {
    const tags = new Set<string>()
    assistants.forEach((assistant) => {
      assistant.tags?.forEach((tag) => tags.add(tag))
    })
    return Array.from(tags)
  }, [assistants])

  // 当assistants变化时重新计算标签
  useEffect(() => {
    setAllTags(calculateTags())
  }, [assistants, calculateTags])

  const getAssistantsByTag = useCallback(
    (tag: string) => {
      return assistants.filter((assistant) => assistant.tags?.includes(tag))
    },
    [assistants]
  )

  const addTag = useCallback((tag: string) => {
    setAllTags((prev) => [...prev, tag])
  }, [])

  const getGroupedAssistants = useMemo(() => {
    const grouped: { tag: string; assistants: Assistant[] }[] = []

    allTags.forEach((tag) => {
      const taggedAssistants = assistants.filter((a) => a.tags?.includes(tag))
      if (taggedAssistants.length > 0) {
        grouped.push({
          tag,
          assistants: taggedAssistants.sort((a, b) => a.name.localeCompare(b.name))
        })
      }
    })

    grouped.sort((a, b) => a.tag.localeCompare(b.tag))

    const untagged = assistants.filter((a) => !a.tags?.length)
    if (untagged.length > 0) {
      grouped.unshift({
        tag: t('assistants.tags.untagged'),
        assistants: untagged
      })
    }
    return grouped
  }, [allTags, assistants, t])

  return {
    allTags,
    getAssistantsByTag,
    getGroupedAssistants,
    addTag
  }
}
