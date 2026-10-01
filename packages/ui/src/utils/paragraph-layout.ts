import {
  breakParagraph,
  buildItems,
  defaultBreakOptions,
  defaultBuildOptions,
  ItemType,
  layoutLines,
  type Measure,
  type RunMetrics
} from 'justif/core'
import { hyphenateEnUS } from 'justif/hyphenate/en-us'

export interface ParagraphRun {
  text: string
  metrics: RunMetrics
  atomicWidth?: number
}

export interface ParagraphPiece {
  from: number
  to: number
  width: number
  kind: 'text' | 'space' | 'break' | 'hyphen' | 'atomic'
}

export interface ParagraphLayout {
  runs: ParagraphPiece[][]
  lineCount: number
}

// Bound synchronous line breaking before entering the solver, including pathological single paragraphs.
export const MAX_PARAGRAPH_LENGTH = 4000
const UNSUPPORTED_TEXT = /[\u00ad\u0590-\u08ff\u0900-\u109f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/u

export function composeParagraph(
  runs: ParagraphRun[],
  width: number,
  measure: Measure,
  language = ''
): ParagraphLayout | null {
  const text = runs.map((run) => run.text).join('')
  if (width <= 0 || !text.trim() || text.length > MAX_PARAGRAPH_LENGTH || UNSUPPORTED_TEXT.test(text)) return null
  const options = {
    ...defaultBuildOptions,
    hyphenate: /^en(?:-|$)/i.test(language) ? hyphenateEnUS : undefined,
    lastLineMinWidth: 0
  }
  const paragraph = buildItems(
    runs.map((run, index) => ({
      text: run.atomicWidth === undefined ? run.text : '',
      run: index,
      ...(run.atomicWidth === undefined ? {} : { atomic: { widthPx: run.atomicWidth } })
    })),
    runs.map((run) => run.metrics),
    options,
    measure
  )
  const breaks = breakParagraph(paragraph, width, { ...defaultBreakOptions, lastLineMinWidth: 0 })
  const lines = layoutLines(paragraph, breaks, width, options)
  if (lines.some((line) => line.overfull)) return null
  const pieces: ParagraphPiece[][] = runs.map(() => [])
  const offsets = runs.map(() => 0)
  const visible = new Map<number, (typeof lines)[number]>()
  for (const line of lines) for (let i = line.start; i < line.end; i++) visible.set(i, line)
  const ends = new Map(breaks.breakpoints.slice(0, -1).map((item, index) => [item, lines[index]]))
  let valid = true
  paragraph.items.forEach((item, index) => {
    const run = item.run
    const source = runs[run].text
    const group = pieces[run]
    const from = offsets[run]
    if (item.type === ItemType.Box) {
      if (item.atomic) {
        group.push({ kind: 'atomic', from: 0, to: source.length, width: item.width })
        offsets[run] = source.length
      } else {
        const start = source.indexOf(item.text, from)
        if (start < 0 || source.slice(from, start).trim()) {
          valid = false
          return
        }
        if (start > from) group.push({ kind: 'space', from, to: start, width: 0 })
        offsets[run] = start + item.text.length
        group.push({ kind: 'text', from: start, to: offsets[run], width: item.width })
      }
    } else if (item.type === ItemType.Glue && !item.stretchFil) {
      const line = visible.get(index)
      const ratio = line?.glueRatio ?? 0
      const to = item.cjk ? from : from + (source.slice(from).match(/^[\t\r\n ]+/)?.[0].length ?? 0)
      group.push({
        kind: 'space',
        from,
        to,
        width: line ? item.width + ratio * (ratio >= 0 ? item.stretch : item.shrink) : 0
      })
      offsets[run] = to
    }
    const end = ends.get(index)
    if (end) {
      const offset = offsets[run]
      if (end.hyphenated) group.push({ kind: 'hyphen', from: offset, to: offset, width: 0 })
      group.push({ kind: 'break', from: offset, to: offset, width: 0 })
    }
  })
  runs.forEach((run, index) => {
    const from = offsets[index]
    if (run.text.slice(from).trim()) valid = false
    if (from < run.text.length) pieces[index].push({ kind: 'space', from, to: run.text.length, width: 0 })
  })
  return valid ? { runs: pieces, lineCount: lines.length } : null
}

export function createParagraphMeasure() {
  let context: CanvasRenderingContext2D | null = null
  const getContext = () => (context ??= document.createElement('canvas').getContext('2d')!)
  const cache = new Map<string, number>()
  const measure: Measure = {
    width(text, run) {
      const key = `${run.fontKey}\0${text}`
      const cached = cache.get(key)
      if (cached !== undefined) return cached
      const canvas = getContext()
      canvas.font = run.fontKey
      canvas.fontKerning = 'none'
      const width = canvas.measureText(text).width
      cache.set(key, width)
      return width
    },
    charAdvance(text, run) {
      return this.width(text, run)
    }
  }
  return {
    measure,
    clear: () => cache.clear(),
    metrics(element: HTMLElement): RunMetrics | null {
      const style = getComputedStyle(element)
      if (
        style.direction !== 'ltr' ||
        style.writingMode !== 'horizontal-tb' ||
        style.textTransform !== 'none' ||
        parseFloat(style.letterSpacing) ||
        parseFloat(style.wordSpacing)
      )
        return null
      const fontKey = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      const canvas = getContext()
      canvas.font = fontKey
      canvas.fontKerning = 'none'
      const space = canvas.measureText(' ').width
      return {
        fontKey,
        familyKey: style.fontFamily,
        space: { width: space, stretch: space / 2, shrink: space / 3 },
        hyphenWidth: canvas.measureText('‐').width,
        ratioAtMax: 1,
        ratioAtMin: 1
      }
    }
  }
}
