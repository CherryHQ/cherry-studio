import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { LLMock } from '@copilotkit/aimock'
import { escapeRegExp } from 'es-toolkit'

import { AIMOCK_VERSION } from './mockProvider'
import { addModelFixtures } from './modelFixtures'
import { getRunPaths } from './paths'

async function main() {
  const paths = getRunPaths(process.argv[2])
  const token = process.argv[3]
  const platform = process.argv[4]
  const mock = new LLMock({ port: 0, host: '127.0.0.1', strict: true, logLevel: 'silent' })
  const catalog = JSON.parse(readFileSync(fileURLToPath(new URL('./mock-fixtures/chat.json', import.meta.url)), 'utf8'))
  for (const fixture of catalog.fixtures) {
    const prompt = escapeRegExp(fixture.match.userMessage)
    const translation = ['CherryStudio Neptune 27182 TRANSLATION_MARKER', 'PDF_TRANSLATION_MARKER_314159'].includes(
      fixture.match.userMessage
    )
    const source =
      fixture.match.userMessage === 'PDF_TRANSLATION_MARKER_314159'
        ? `(?:${prompt}|Cherry regression PDF: ${prompt})`
        : prompt
    const userMessage = translation
      ? new RegExp(String.raw`^(?:${prompt}|[\s\S]*<translate_input>\s*${source}\s*</translate_input>[\s\S]*)$`)
      : new RegExp(`^${prompt}$`)
    mock.addFixture({ match: { userMessage }, response: fixture.response, ...fixture.opts })
  }
  addModelFixtures(mock)
  await mock.start()
  let stopping: Promise<void> | undefined
  const stop = () =>
    (stopping ??= (async () => {
      const entries = mock.journal.getAll()
      const unmatched = entries.filter((entry) => !entry.response.fixture || entry.response.status >= 400)
      writeFileSync(
        join(paths.logs, 'aimock-summary.json'),
        JSON.stringify({
          version: AIMOCK_VERSION,
          requests: entries.length,
          unmatched: unmatched.length,
          unmatchedRequests: unmatched.map(({ timestamp, response }) => ({
            time: new Date(timestamp).toISOString(),
            status: response.status,
            matchedFixture: response.fixture !== null
          }))
        })
      )
      await mock.stop()
    })())
  mock.mount('/__cherry_mock', {
    async handleRequest(req, res) {
      if (req.headers.authorization !== `Bearer ${token}`) {
        res.writeHead(403).end()
        return true
      }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({
          pid: process.pid,
          token,
          unmatched: mock.journal.getAll().filter((entry) => !entry.response.fixture || entry.response.status >= 400)
            .length
        })
      )
      if (req.method === 'POST') void stop().then(() => process.exit(0))
      return true
    }
  })
  process.once('SIGTERM', () => {
    void stop().then(() => process.exit(0))
  })
  process.once('SIGINT', () => {
    void stop().then(() => process.exit(0))
  })
  const record = join(paths.root, 'mock.json')
  writeFileSync(
    `${record}.tmp`,
    JSON.stringify({
      pid: process.pid,
      token,
      port: mock.port,
      version: AIMOCK_VERSION,
      platform
    }),
    { mode: 0o600 }
  )
  renameSync(`${record}.tmp`, record)
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`)
  process.exitCode = 1
})
