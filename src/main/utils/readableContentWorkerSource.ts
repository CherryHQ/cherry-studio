export const readableContentWorkerSource = `
const { parentPort, workerData } = require('node:worker_threads')

function stripMarkdownImagesAndLinks(text) {
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

function formatPreview(text, maxLength) {
  let cleaned = stripMarkdownImagesAndLinks(text)
  cleaned = cleaned.replace(/https?:\\/\\/\\S+/g, '')
  cleaned = cleaned.replace(/[-—–_=+]{3,}/g, ' ')
  cleaned = cleaned.replace(/[￥$€£¥%@#&*^()[\\]{}<>~\u0060'"\\\\|/_.]+/g, '')
  cleaned = cleaned.replace(/\\s+/g, ' ').trim()
  return cleaned.length > maxLength ? cleaned.slice(0, maxLength) + '...' : cleaned
}

try {
  let title = ''
  let content = workerData.source

  if (workerData.inputKind === 'html') {
    const { JSDOM } = require(workerData.jsdomModulePath)
    const { Readability } = require(workerData.readabilityModulePath)
    const dom = new JSDOM(workerData.source, { url: workerData.baseUrl })

    try {
      const article = new Readability(dom.window.document).parse()
      title = article?.title || ''
      content = article?.textContent || ''

      if (article && workerData.format === 'markdown') {
        const TurndownModule = require(workerData.turndownModulePath)
        const TurndownService = TurndownModule.default || TurndownModule
        content = new TurndownService().turndown(article.content || '').trim()
      }
    } finally {
      dom.window.close()
    }
  }

  if (workerData.format === 'preview') {
    content = formatPreview(content, workerData.maxLength)
  }

  parentPort.postMessage({ type: 'result', title, content })
} catch (error) {
  parentPort.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error)
  })
}
`
