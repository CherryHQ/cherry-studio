import type { NavigatorDragData } from './types'

export const getNavigatorDragData = (entity: { data?: unknown } | null) =>
  (entity?.data ?? null) as NavigatorDragData | null
