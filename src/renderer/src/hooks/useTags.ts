import { flatMap, groupBy, uniq } from 'lodash'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useAssistants } from './useAssistant'

// 定义useTags的返回类型，包含所有标签和获取特定标签的助手函数
// 为了不增加新的概念，标签直接作为助手的属性，所以这里的标签是指助手的标签属性
// 但是为了方便管理，增加了一个获取特定标签的助手函数

export const useTags = () => {
  const { assistants } = useAssistants()
  const { t } = useTranslation()

  // 计算所有标签
  const allTags = useMemo(() => {
    return uniq(flatMap(assistants, (assistant) => assistant.tags || []))
  }, [assistants])

  const getAssistantsByTag = useCallback(
    (tag: string) => assistants.filter((assistant) => assistant.tags?.includes(tag)),
    [assistants]
  )

  const getGroupedAssistants = useMemo(() => {
    // 按标签分组，处理多标签的情况
    const assistantsByTags = flatMap(assistants, (assistant) => {
      const tags = assistant.tags?.length ? assistant.tags : [t('assistants.tags.untagged')]
      return tags.map((tag) => ({ tag, assistant }))
    })

    // 按标签分组并构建结果
    const grouped = Object.entries(groupBy(assistantsByTags, 'tag')).map(([tag, group]) => ({
      tag,
      assistants: group.map((g) => g.assistant)
    }))

    // 将未标记的组移到最前面
    const untaggedIndex = grouped.findIndex((g) => g.tag === t('assistants.tags.untagged'))
    if (untaggedIndex > -1) {
      const [untagged] = grouped.splice(untaggedIndex, 1)
      grouped.unshift(untagged)
    }

    return grouped
  }, [assistants, t])

  return {
    allTags,
    getAssistantsByTag,
    getGroupedAssistants
  }
}
