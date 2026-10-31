import type { BrowserWindowConstructorOptions, Rectangle } from 'electron'

export function clampWindowBounds(rect: Rectangle, area: Rectangle): Rectangle {
  const width = Math.min(rect.width, area.width)
  const height = Math.min(rect.height, area.height)
  const x = Math.min(Math.max(rect.x, area.x), area.x + area.width - width)
  const y = Math.min(Math.max(rect.y, area.y), area.y + area.height - height)
  return { x, y, width, height }
}

export function fitWindowOptionsToWorkArea(
  config: Pick<BrowserWindowConstructorOptions, 'x' | 'y' | 'width' | 'height' | 'minWidth' | 'minHeight'>,
  area: Rectangle
): void {
  const { width, height, minWidth, minHeight } = config
  if (minWidth !== undefined) config.minWidth = Math.min(minWidth, area.width)
  if (minHeight !== undefined) config.minHeight = Math.min(minHeight, area.height)
  if (width !== undefined) config.width = Math.min(Math.max(width, config.minWidth ?? width), area.width)
  if (height !== undefined) config.height = Math.min(Math.max(height, config.minHeight ?? height), area.height)

  if (config.width === undefined || config.height === undefined) return
  if (config.x !== undefined && config.y !== undefined) {
    Object.assign(
      config,
      clampWindowBounds({ x: config.x, y: config.y, width: config.width, height: config.height }, area)
    )
  } else if (
    config.width !== width ||
    config.height !== height ||
    config.minWidth !== minWidth ||
    config.minHeight !== minHeight
  ) {
    config.x = area.x + Math.round((area.width - config.width) / 2)
    config.y = area.y + Math.round((area.height - config.height) / 2)
  }
}
