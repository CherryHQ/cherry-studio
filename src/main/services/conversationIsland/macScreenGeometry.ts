import { loggerService } from '@logger'
import { findExecutableInEnv } from '@main/utils/commandResolver'
import { execFile } from 'child_process'
import type { Display, Rectangle } from 'electron'

const logger = loggerService.withContext('ConversationIsland:ScreenGeometry')

const PROBE_TIMEOUT_MS = 1_500
const PROBE_MAX_BUFFER_BYTES = 64 * 1024
const FALLBACK_TOP_OFFSET = 8
const MIN_NOTCH_WIDTH = 40
const MAX_NOTCH_WIDTH = 260
const TOP_EDGE_TOLERANCE = 2
const CENTER_TOLERANCE_RATIO = 0.1
const EXPANDED_WIDTH = 420
const MIN_COMPACT_NOTCH_WIDTH = 280
const COMPACT_NOTCH_SIDE_WIDTH = 80
const EXPANDED_HEADER_HEIGHT = 38
const SINGLE_DETAIL_HEIGHT = 44
const ACTIVITY_LIST_ROW_HEIGHT = 52

export type ConversationIslandPresentation = 'notch' | 'capsule'

export interface ConversationIslandSize {
  width: number
  height: number
}

export const COMPACT_ISLAND_SIZE: ConversationIslandSize = { width: 320, height: 38 }
export const MAX_VISIBLE_EXPANDED_ROWS = 4

const SCREEN_GEOMETRY_JXA = String.raw`
ObjC.import('AppKit')
function rect(value) {
  return {
    x: Number(value.origin.x),
    y: Number(value.origin.y),
    width: Number(value.size.width),
    height: Number(value.size.height)
  }
}
function main() {
  return JSON.stringify($.NSScreen.screens.js.map((screen) => ({
    screenNumber: Number(screen.deviceDescription.objectForKey('NSScreenNumber').js),
    frame: rect(screen.frame),
    safeAreaInsets: {
      top: Number(screen.safeAreaInsets.top),
      left: Number(screen.safeAreaInsets.left),
      bottom: Number(screen.safeAreaInsets.bottom),
      right: Number(screen.safeAreaInsets.right)
    },
    auxiliaryTopLeftArea: rect(screen.auxiliaryTopLeftArea),
    auxiliaryTopRightArea: rect(screen.auxiliaryTopRightArea)
  })))
}
main()
`

interface ScreenInsets {
  top: number
  left: number
  bottom: number
  right: number
}

export interface MacScreenGeometry {
  screenNumber: number
  frame: Rectangle
  safeAreaInsets: ScreenInsets
  auxiliaryTopLeftArea: Rectangle
  auxiliaryTopRightArea: Rectangle
}

export interface ConversationIslandPlacement {
  bounds: Rectangle
  presentation: ConversationIslandPresentation
  notchWidth?: number
}

export function resolveConversationIslandSize(activityCount: number): ConversationIslandSize {
  const contentHeight =
    activityCount === 1
      ? SINGLE_DETAIL_HEIGHT
      : Math.min(MAX_VISIBLE_EXPANDED_ROWS, activityCount) * ACTIVITY_LIST_ROW_HEIGHT
  return { width: EXPANDED_WIDTH, height: EXPANDED_HEADER_HEIGHT + contentHeight }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseRectangle(value: unknown, allowEmpty: boolean): Rectangle | null {
  if (!isRecord(value)) return null

  const x = parseNumber(value.x)
  const y = parseNumber(value.y)
  const width = parseNumber(value.width)
  const height = parseNumber(value.height)
  if (x === null || y === null || width === null || height === null) return null
  if (width < 0 || height < 0 || (!allowEmpty && (width === 0 || height === 0))) return null
  return { x, y, width, height }
}

function parseInsets(value: unknown): ScreenInsets | null {
  if (!isRecord(value)) return null

  const top = parseNumber(value.top)
  const left = parseNumber(value.left)
  const bottom = parseNumber(value.bottom)
  const right = parseNumber(value.right)
  if (top === null || left === null || bottom === null || right === null) return null
  if (top < 0 || left < 0 || bottom < 0 || right < 0) return null
  return { top, left, bottom, right }
}

function parseGeometry(value: unknown): MacScreenGeometry | null {
  if (!isRecord(value)) return null

  const screenNumber = parseNumber(value.screenNumber)
  const frame = parseRectangle(value.frame, false)
  const safeAreaInsets = parseInsets(value.safeAreaInsets)
  const auxiliaryTopLeftArea = parseRectangle(value.auxiliaryTopLeftArea, true)
  const auxiliaryTopRightArea = parseRectangle(value.auxiliaryTopRightArea, true)
  if (
    screenNumber === null ||
    !Number.isInteger(screenNumber) ||
    !frame ||
    !safeAreaInsets ||
    !auxiliaryTopLeftArea ||
    !auxiliaryTopRightArea
  ) {
    return null
  }

  return { screenNumber, frame, safeAreaInsets, auxiliaryTopLeftArea, auxiliaryTopRightArea }
}

export function parseMacScreenGeometry(raw: string): Map<number, MacScreenGeometry> {
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return new Map()

    const geometries = new Map<number, MacScreenGeometry>()
    for (const item of value) {
      const geometry = parseGeometry(item)
      if (geometry) geometries.set(geometry.screenNumber, geometry)
    }
    return geometries
  } catch {
    return new Map()
  }
}

function fallbackPlacement(
  display: Pick<Display, 'bounds'>,
  size: ConversationIslandSize
): ConversationIslandPlacement {
  return {
    bounds: {
      x: Math.round(display.bounds.x + (display.bounds.width - size.width) / 2),
      y: Math.round(display.bounds.y + FALLBACK_TOP_OFFSET),
      width: size.width,
      height: size.height
    },
    presentation: 'capsule'
  }
}

export function resolveConversationIslandBounds(
  display: Pick<Display, 'id' | 'bounds'>,
  geometries: ReadonlyMap<number, MacScreenGeometry>,
  size: ConversationIslandSize
): ConversationIslandPlacement {
  const geometry = geometries.get(display.id)
  if (!geometry || geometry.safeAreaInsets.top <= 0) return fallbackPlacement(display, size)

  const { frame, auxiliaryTopLeftArea: left, auxiliaryTopRightArea: right } = geometry
  const frameTop = frame.y + frame.height
  const leftTop = left.y + left.height
  const rightTop = right.y + right.height
  const gapStart = left.x + left.width
  const gapEnd = right.x
  const gapWidth = gapEnd - gapStart
  const gapCenter = gapStart + gapWidth / 2
  const frameCenter = frame.x + frame.width / 2
  const isAtTop =
    Math.abs(leftTop - frameTop) <= TOP_EDGE_TOLERANCE && Math.abs(rightTop - frameTop) <= TOP_EDGE_TOLERANCE
  const isPlausibleWidth = gapWidth >= MIN_NOTCH_WIDTH && gapWidth <= MAX_NOTCH_WIDTH
  const isCentered = Math.abs(gapCenter - frameCenter) <= frame.width * CENTER_TOLERANCE_RATIO

  if (!isAtTop || !isPlausibleWidth || !isCentered) return fallbackPlacement(display, size)

  const isCompact = size.width === COMPACT_ISLAND_SIZE.width && size.height === COMPACT_ISLAND_SIZE.height
  const width = isCompact
    ? Math.min(EXPANDED_WIDTH, Math.max(MIN_COMPACT_NOTCH_WIDTH, gapWidth + COMPACT_NOTCH_SIDE_WIDTH * 2))
    : size.width

  return {
    bounds: {
      x: Math.round(display.bounds.x + (gapCenter - frame.x) - width / 2),
      y: Math.round(display.bounds.y),
      width,
      height: size.height
    },
    presentation: 'notch',
    notchWidth: gapWidth
  }
}

export async function probeMacScreenGeometry(signal?: AbortSignal): Promise<Map<number, MacScreenGeometry>> {
  try {
    const executable = await findExecutableInEnv('osascript')
    if (!executable || signal?.aborted) return new Map()

    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        executable,
        ['-l', 'JavaScript', '-e', SCREEN_GEOMETRY_JXA],
        {
          encoding: 'utf8',
          maxBuffer: PROBE_MAX_BUFFER_BYTES,
          shell: false,
          signal,
          timeout: PROBE_TIMEOUT_MS
        },
        (error, output, stderr) => {
          if (error) {
            reject(error)
            return
          }
          if (stderr.trim()) {
            reject(new Error(stderr.trim()))
            return
          }
          resolve(output)
        }
      )
    })

    return parseMacScreenGeometry(stdout)
  } catch (error) {
    if (!signal?.aborted) logger.warn('Failed to probe macOS screen geometry', { error })
    return new Map()
  }
}
