import type { MemoryCandidate } from '@shared/types/memory'

// Stored annotations follow the language of the evidence, independently of the app locale.
const sourceLanguageFormats = {
  zh: {
    year: (value: number) => `${value}年`,
    stated: (text: string, date: string) => `${text}（表述日期：${date}）`
  },
  en: {
    year: String,
    stated: (text: string, date: string) => `${text} (stated: ${date})`
  }
}

export function memoryDate(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/** Anchor the statement, never invent an event date for an imprecise expression. */
export function anchorMemoryTime(
  candidate: MemoryCandidate,
  messages: readonly { id: string; createdAt: number }[],
  timeZone: string
): string {
  const relative =
    /明年|今年|去年|上个月|下个月|今天|明天|昨天|最近|目前|\b(next|last|this) (year|month)|\b(today|tomorrow|yesterday|recently|currently)\b/i
  if (!candidate.time.trim() && !relative.test(candidate.text)) return candidate.text
  const dates = [
    ...new Set(
      candidate.evidence.map((evidence) =>
        memoryDate(messages.find((message) => message.id === evidence.messageId)!.createdAt, timeZone)
      )
    )
  ]
  let text = candidate.text
  const relativeTerms = new Set(
    [...text.matchAll(new RegExp(relative.source, 'gi'))].map((match) => match[0].toLowerCase())
  )
  if (
    dates.length === 1 &&
    relativeTerms.size === 1 &&
    /^(明年|今年|去年|上个月|下个月|今天|明天|昨天|(next|last|this) (year|month)|today|tomorrow|yesterday)$/i.test(
      candidate.time.trim()
    ) &&
    !/\b\d{4}\b/.test(text)
  ) {
    const [year, month] = dates[0].split('-').map(Number)
    const monthAt = (offset: number) => new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7)
    const dayAt = (offset: number) =>
      new Date(Date.parse(`${dates[0]}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10)
    const replacements: Array<[RegExp, string]> = [
      [/明年/g, sourceLanguageFormats.zh.year(year + 1)],
      [/今年/g, sourceLanguageFormats.zh.year(year)],
      [/去年/g, sourceLanguageFormats.zh.year(year - 1)],
      [/上个月/g, monthAt(-1)],
      [/下个月/g, monthAt(1)],
      [/今天/g, dates[0]],
      [/明天/g, dayAt(1)],
      [/昨天/g, dayAt(-1)],
      [/\bnext year\b/gi, sourceLanguageFormats.en.year(year + 1)],
      [/\bthis year\b/gi, sourceLanguageFormats.en.year(year)],
      [/\blast year\b/gi, sourceLanguageFormats.en.year(year - 1)],
      [/\bnext month\b/gi, monthAt(1)],
      [/\blast month\b/gi, monthAt(-1)],
      [/\btoday\b/gi, dates[0]],
      [/\btomorrow\b/gi, dayAt(1)],
      [/\byesterday\b/gi, dayAt(-1)]
    ]
    for (const [pattern, value] of replacements) text = text.replace(pattern, value)
  }
  const language = /\p{Script=Han}/u.test(text) ? 'zh' : 'en'
  return sourceLanguageFormats[language].stated(text, dates.join(', '))
}
