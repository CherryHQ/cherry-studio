import { sortedLastIndex } from 'es-toolkit/compat'
import { useEffect, useState } from 'react'

import { loggerService } from '@logger'

const logger = loggerService.withContext('CodeViewer')
const MAX_FOLDABLE_JSON_CHARS = 100_000

export function jsonIndentColumns(line: string): number {
  let columns = 0
  for (const char of line) {
    if (char === ' ') columns++
    else if (char === '\t') columns += 2 - (columns % 2)
    else break
  }
  return columns
}

export function useJsonCodeFolds(value: string, language: string, lines: string[]) {
  const [parsed, setParsed] = useState<{
    value: string
    ranges: Map<number, number>
    indent: number
  } | null>(null)
  const isJson = /^\.?json$/i.test(language)

  useEffect(() => {
    if (!isJson || lines.length < 3 || value.length > MAX_FOLDABLE_JSON_CHARS) return

    let cancelled = false
    const timeout = setTimeout(() => {
      void import('@codemirror/lang-json')
        .then(({ jsonLanguage }) => {
          if (cancelled) return
          const offsets = [0]
          let indent = Infinity
          for (const line of lines) {
            offsets.push(offsets[offsets.length - 1] + line.length + 1)
            const columns = jsonIndentColumns(line)
            if (columns) indent = Math.min(indent, columns)
          }
          const ranges = new Map<number, number>()
          jsonLanguage.parser.parse(value).iterate({
            enter(node) {
              if (node.name !== 'Object' && node.name !== 'Array') return
              const closer = node.name === 'Object' ? '}' : ']'
              if (node.node.lastChild?.name !== closer) return
              const start = sortedLastIndex(offsets, node.from) - 1
              const end = sortedLastIndex(offsets, node.to - 1) - 1
              if (end > start + 1 && !ranges.has(start)) ranges.set(start, end)
            }
          })
          setParsed({ value, ranges, indent: Number.isFinite(indent) ? indent : 2 })
        })
        .catch((error) => logger.error('Failed to load JSON folding', error))
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [isJson, lines, value])

  return isJson && parsed?.value === value && parsed.ranges.size > 0 ? parsed : null
}
