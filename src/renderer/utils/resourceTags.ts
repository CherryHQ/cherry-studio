export const DEFAULT_TAG_COLOR = '#6b7280'
export const TAG_COLOR_PALETTE = ['#8b5cf6', '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4']

export function getRandomTagColor(): string {
  if (TAG_COLOR_PALETTE.length === 0) return DEFAULT_TAG_COLOR
  const idx = Math.floor(Math.random() * TAG_COLOR_PALETTE.length)
  return TAG_COLOR_PALETTE[idx]
}
