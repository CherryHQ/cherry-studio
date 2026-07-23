import type { EmojiData } from './emojiData'

const EMOJI_VERSION_TESTS = [
  { emoji: '🫪', version: 17 },
  { emoji: '🫩', version: 16 },
  { emoji: '🫨', version: 15.1 },
  { emoji: '🫠', version: 14 },
  { emoji: '🥲', version: 13.1 },
  { emoji: '🥻', version: 12.1 },
  { emoji: '🥰', version: 11 },
  { emoji: '🤩', version: 5 },
  { emoji: '👱‍♀️', version: 4 },
  { emoji: '🤣', version: 3 },
  { emoji: '👁️‍🗨️', version: 2 },
  { emoji: '😀', version: 1 },
  { emoji: '😐️', version: 0.7 },
  { emoji: '😃', version: 0.6 }
] as const

const BASELINE_EMOJI = '😀'
const ZWJ_CODE_POINT = '200d'
const ZWJ_UNSUPPORTED_WIDTH_RATIO = 1.8
const EMOJI_FONT_FAMILY =
  '"Twemoji Mozilla","Apple Color Emoji","Segoe UI Emoji","Segoe UI Symbol",' +
  '"Noto Color Emoji","EmojiOne Color","Android Emoji",sans-serif'

let emojiSupportLevelPromise: Promise<number> | undefined
const unsupportedZwjEmojiIdsPromises = new Map<string, Promise<string[]>>()

const getTextFeature = (text: string, color: string): Uint8ClampedArray | undefined => {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1

  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return undefined

  context.textBaseline = 'top'
  context.font = `100px ${EMOJI_FONT_FAMILY}`
  context.fillStyle = color
  context.scale(0.01, 0.01)
  context.fillText(text, 0, 0)

  return context.getImageData(0, 0, 1, 1).data
}

const hasMatchingColorEmojiFeatures = (left: Uint8ClampedArray, right: Uint8ClampedArray): boolean => {
  const leftFeature = [...left].join(',')
  const rightFeature = [...right].join(',')

  return leftFeature === rightFeature && !leftFeature.startsWith('0,0,0,')
}

const isColorEmojiSupported = (emoji: string): boolean => {
  const blackFeature = getTextFeature(emoji, '#000')
  const whiteFeature = getTextFeature(emoji, '#fff')

  return Boolean(blackFeature && whiteFeature && hasMatchingColorEmojiFeatures(blackFeature, whiteFeature))
}

const determineEmojiSupportLevel = (): number => {
  try {
    for (const { emoji, version } of EMOJI_VERSION_TESTS) {
      if (isColorEmojiSupported(emoji)) return version
    }
  } catch {
    // Anti-fingerprinting protections can block canvas reads. In that case,
    // prefer showing native emoji over hiding supported glyphs.
  }

  return EMOJI_VERSION_TESTS[0].version
}

const runWhenIdle = (callback: () => void) => {
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(callback)
    return
  }

  window.setTimeout(callback, 0)
}

export const detectEmojiSupportLevel = (): Promise<number> => {
  if (!emojiSupportLevelPromise) {
    emojiSupportLevelPromise = new Promise((resolve) => {
      runWhenIdle(() => resolve(determineEmojiSupportLevel()))
    })
  }

  return emojiSupportLevelPromise
}

const unifiedToNativeEmoji = (unified: string): string =>
  unified
    .split('-')
    .map((codePoint) => String.fromCodePoint(Number.parseInt(codePoint, 16)))
    .join('')

const getZwjEmojiIds = (emojiData: EmojiData): string[] => {
  const ids = Object.values(emojiData.emojis)
    .flat()
    .map((emoji) => emoji.u)
    .filter((unified) => unified.includes(ZWJ_CODE_POINT))

  return [...new Set(ids)]
}

const createMeasurementNode = (): HTMLSpanElement | undefined => {
  if (!document.body) return undefined

  const node = document.createElement('span')
  node.style.position = 'absolute'
  node.style.left = '-9999px'
  node.style.top = '0'
  node.style.visibility = 'hidden'
  node.style.whiteSpace = 'nowrap'
  node.style.fontFamily = EMOJI_FONT_FAMILY
  node.style.fontSize = '32px'
  node.style.lineHeight = '1'
  document.body.append(node)

  return node
}

const calculateTextWidth = (measurementNode: HTMLSpanElement, text: string): number | undefined => {
  measurementNode.textContent = text
  const textNode = measurementNode.firstChild
  if (!textNode) return undefined

  const range = document.createRange()
  range.selectNode(textNode)
  const width = range.getBoundingClientRect().width
  range.detach?.()

  return width
}

const determineUnsupportedZwjEmojiIds = (emojiIds: string[]): string[] => {
  try {
    const measurementNode = createMeasurementNode()
    if (!measurementNode) return []

    try {
      const baselineWidth = calculateTextWidth(measurementNode, BASELINE_EMOJI)
      if (!baselineWidth) return []

      return emojiIds.filter((emojiId) => {
        const emojiWidth = calculateTextWidth(measurementNode, unifiedToNativeEmoji(emojiId))
        return Boolean(emojiWidth && emojiWidth / ZWJ_UNSUPPORTED_WIDTH_RATIO >= baselineWidth)
      })
    } finally {
      measurementNode.remove()
    }
  } catch {
    return []
  }
}

export const detectUnsupportedZwjEmojiIds = (emojiData: EmojiData): Promise<string[]> => {
  const emojiIds = getZwjEmojiIds(emojiData)
  const cacheKey = emojiIds.join('|')
  const cached = unsupportedZwjEmojiIdsPromises.get(cacheKey)
  if (cached) return cached

  const promise = new Promise<string[]>((resolve) => {
    runWhenIdle(() => resolve(determineUnsupportedZwjEmojiIds(emojiIds)))
  })

  unsupportedZwjEmojiIdsPromises.set(cacheKey, promise)
  return promise
}

export const resetEmojiSupportLevelCacheForTesting = () => {
  emojiSupportLevelPromise = undefined
  unsupportedZwjEmojiIdsPromises.clear()
}
