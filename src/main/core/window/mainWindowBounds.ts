import type { Rectangle } from 'electron'
import { screen } from 'electron'

import type { WindowOptions } from '@main/core/window/types'
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from '@shared/utils/window'

export function fitMainWindowBounds(
  bounds: Rectangle,
  area: Rectangle,
  minimumWidth = MIN_WINDOW_WIDTH,
  minimumHeight = MIN_WINDOW_HEIGHT
): Rectangle {
  const width = Math.min(area.width, Math.max(minimumWidth, bounds.width))
  const height = Math.min(area.height, Math.max(minimumHeight, bounds.height))
  return {
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
    width,
    height
  }
}

export function resolveMainWindowOptions(config: WindowOptions): void {
  const hasPosition = config.x !== undefined && config.y !== undefined
  const bounds = {
    x: config.x ?? 0,
    y: config.y ?? 0,
    width: config.width ?? 1440,
    height: config.height ?? 900
  }
  const { workArea } = hasPosition ? screen.getDisplayMatching(bounds) : screen.getPrimaryDisplay()
  if (!hasPosition) {
    bounds.width = Math.min(bounds.width, Math.floor(workArea.width * 0.9))
    bounds.height = Math.min(bounds.height, Math.floor(workArea.height * 0.9))
  }
  const placed = fitMainWindowBounds(bounds, workArea)
  if (!hasPosition) {
    placed.x = workArea.x + Math.floor((workArea.width - placed.width) / 2)
    placed.y = workArea.y + Math.floor((workArea.height - placed.height) / 2)
  }
  Object.assign(config, placed, {
    minWidth: Math.min(MIN_WINDOW_WIDTH, workArea.width),
    minHeight: Math.min(MIN_WINDOW_HEIGHT, workArea.height),
    maxWidth: workArea.width,
    maxHeight: workArea.height
  })
}
