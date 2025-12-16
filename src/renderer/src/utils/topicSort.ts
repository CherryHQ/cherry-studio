import type { Topic } from '@renderer/types'

const toTimestampMs = (value: unknown): number | null => {
  if (typeof value === 'number') {
    const ms = value > 1e12 ? value : value * 1000
    return Number.isFinite(ms) ? ms : null
  }

  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

const getTopicCreatedTimestampMs = (topic: Pick<Topic, 'createdAt' | 'updatedAt'>): number => {
  return toTimestampMs(topic.createdAt) ?? toTimestampMs(topic.updatedAt) ?? 0
}

/**
 * 话题排序：先按置顶，其次按创建时间（倒序：新建在前）。
 */
export const sortTopicsByPinnedAndCreatedAt = (topics: readonly Topic[]): Topic[] => {
  return [...topics].sort((a, b) => {
    const pinnedDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))
    if (pinnedDiff !== 0) return pinnedDiff

    const timeDiff = getTopicCreatedTimestampMs(b) - getTopicCreatedTimestampMs(a)
    if (timeDiff !== 0) return timeDiff

    const nameDiff = (a.name ?? '').localeCompare(b.name ?? '', 'zh-CN')
    if (nameDiff !== 0) return nameDiff

    return a.id.localeCompare(b.id)
  })
}
