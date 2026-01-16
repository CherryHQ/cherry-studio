import dayjs from 'dayjs'

const DEFAULT_FORMAT = 'MM-DD HH:mm'

export const formatKnowledgeItemTime = (
  item: { createdAt: string; updatedAt: string },
  format: string = DEFAULT_FORMAT
) => {
  const createdAt = Date.parse(item.createdAt)
  const updatedAt = Date.parse(item.updatedAt)
  const timestamp = updatedAt > createdAt ? updatedAt : createdAt
  return dayjs(timestamp).format(format)
}

export const formatKnowledgeTimestamp = (timestamp: number, format: string = DEFAULT_FORMAT) => {
  return dayjs(timestamp).format(format)
}
