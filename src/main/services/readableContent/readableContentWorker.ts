import { parentPort, workerData } from 'node:worker_threads'

import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'

const SAFE_JSDOM_URL = 'http://localhost/'

export type ReadableContentWorkerInput =
  | {
      readonly format: 'markdown'
      readonly inputKind: 'html'
      readonly source: string
    }
  | {
      readonly format: 'preview'
      readonly inputKind: 'html' | 'text'
      readonly maxLength: number
      readonly source: string
    }

export type ReadableContentWorkerMessage =
  | { type: 'result'; title: string; content: string }
  | { type: 'error'; message: string }

function stripMarkdownImagesAndLinks(text: string): string {
  let cursor = 0
  let result = ''

  while (cursor < text.length) {
    const bracketStart = text.indexOf('[', cursor)

    if (bracketStart === -1) {
      result += text.slice(cursor)
      break
    }

    const isImage = bracketStart > cursor && text[bracketStart - 1] === '!'
    const start = isImage ? bracketStart - 1 : bracketStart
    result += text.slice(cursor, start)
    const labelStart = bracketStart + 1
    const labelEnd = text.indexOf(']', labelStart)
    if (labelEnd === -1 || text[labelEnd + 1] !== '(') {
      result += text.slice(start)
      break
    }

    const targetEnd = text.indexOf(')', labelEnd + 2)
    if (targetEnd === -1) {
      result += text.slice(start)
      break
    }

    if (!isImage) {
      result += text.slice(labelStart, labelEnd)
    }
    cursor = targetEnd + 1
  }

  return result
}

function formatPreview(text: string, maxLength: number): string {
  let cleaned = stripMarkdownImagesAndLinks(text)
  cleaned = cleaned.replace(/https?:\/\/\S+/g, '')
  cleaned = cleaned.replace(/[-—–_=+]{3,}/g, ' ')
  cleaned = cleaned.replace(/[￥$€£¥%@#&*^()[\]{}<>~`'"\\|/_.]+/g, '')
  cleaned = cleaned.replace(/\s+/g, ' ').trim()
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned
}

if (!parentPort) {
  throw new Error('Readable content worker requires a parent port')
}

const input = workerData as ReadableContentWorkerInput

try {
  let title = ''
  let content = input.source

  if (input.inputKind === 'html') {
    const dom = new JSDOM(input.source, { url: SAFE_JSDOM_URL })

    try {
      const article = new Readability(dom.window.document).parse()
      title = article?.title || ''
      content = article?.textContent || ''

      if (article && input.format === 'markdown') {
        content = new TurndownService().turndown(article.content || '').trim()
      }
    } finally {
      dom.window.close()
    }
  }

  if (input.format === 'preview') {
    content = formatPreview(content, input.maxLength)
  }

  parentPort.postMessage({ type: 'result', title, content } satisfies ReadableContentWorkerMessage)
} catch (error) {
  parentPort.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error)
  } satisfies ReadableContentWorkerMessage)
}
