import { createSelector } from '@reduxjs/toolkit'
import { RootState, useAppDispatch, useAppSelector } from '@renderer/store'
import { setTagsOrder, updateTagCollapse } from '@renderer/store/assistants'
import { flatMap, groupBy, uniq } from 'lodash'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useAssistants } from './useAssistant'

// 基础选择器
const selectAssistantsState = (state: RootState) => state.assistants
// 记忆化 tagsOrder 选择器（自动处理默认值）--- 这是一个选择器，用于从 store 中获取 tagsOrder 的值。因为之前的tagsOrder是后面新加的，不这样做会报错，所以这里需要处理一下默认值
const selectTagsOrder = createSelector([selectAssistantsState], (assistants) => assistants.tagsOrder ?? [])

const selectCollapsedTags = createSelector([selectAssistantsState], (assistants) => assistants.collapsedTags ?? {})

// 定义useTags的返回类型，包含所有标签和获取特定标签的助手函数
// 为了不增加新的概念，标签直接作为助手的属性，所以这里的标签是指助手的标签属性
// 但是为了方便管理，增加了一个获取特定标签的助手函数
export const useTags = () => {
  const { assistants } = useAssistants()
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const savedTagsOrder = useAppSelector(selectTagsOrder)
  const collapsedTags = useAppSelector(selectCollapsedTags)

  // 计算所有标签
  const allTags = useMemo(() => {
    const tags = uniq(flatMap(assistants, (assistant) => assistant.tags || []))
    if (savedTagsOrder.length > 0) {
      return [
        ...savedTagsOrder.filter((tag) => tags.includes(tag)),
        ...tags.filter((tag) => !savedTagsOrder.includes(tag))
      ]
    }
    return tags
  }, [assistants, savedTagsOrder])

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

    // 根据savedTagsOrder对标签组进行排序
    if (savedTagsOrder.length > 0) {
      const untagged = grouped.length > 0 && grouped[0].tag === t('assistants.tags.untagged') ? grouped.shift() : null
      grouped.sort((a, b) => {
        const indexA = savedTagsOrder.indexOf(a.tag)
        const indexB = savedTagsOrder.indexOf(b.tag)
        if (indexA === -1 && indexB === -1) return 0
        if (indexA === -1) return 1
        if (indexB === -1) return -1

        return indexA - indexB
      })
      if (untagged) {
        grouped.unshift(untagged)
      }
    }

    return grouped
  }, [assistants, t, savedTagsOrder])

  const updateTagsOrder = useCallback(
    (newOrder: string[]) => {
      dispatch(setTagsOrder(newOrder))
    },
    [dispatch]
  )

  const toggleTagCollapse = useCallback(
    (tag: string) => {
      dispatch(updateTagCollapse(tag))
    },
    [dispatch]
  )

  return {
    allTags,
    getAssistantsByTag,
    getGroupedAssistants,
    updateTagsOrder,
    collapsedTags,
    toggleTagCollapse
  }
}
