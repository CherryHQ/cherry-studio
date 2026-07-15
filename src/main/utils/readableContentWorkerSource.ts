export const readableContentWorkerSource = `
const { parentPort, workerData } = require('node:worker_threads')

try {
  const { JSDOM } = require(workerData.jsdomModulePath)
  const { Readability } = require(workerData.readabilityModulePath)
  const TurndownModule = require(workerData.turndownModulePath)
  const TurndownService = TurndownModule.default || TurndownModule
  const dom = new JSDOM(workerData.html, { url: workerData.baseUrl })

  try {
    const article = new Readability(dom.window.document).parse()
    let content = ''

    if (article) {
      content = workerData.format === 'markdown'
        ? new TurndownService().turndown(article.content || '').trim()
        : article.textContent || ''
    }

    parentPort.postMessage({
      type: 'result',
      title: article?.title || '',
      content
    })
  } finally {
    dom.window.close()
  }
} catch (error) {
  parentPort.postMessage({
    type: 'error',
    message: error instanceof Error ? error.message : String(error)
  })
}
`
