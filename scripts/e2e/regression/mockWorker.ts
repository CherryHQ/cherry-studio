import { renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { LLMock } from '@copilotkit/aimock'

import { AIMOCK_VERSION } from './mockProvider'
import { getRunPaths } from './paths'
import { readRun } from './state'

async function main() {
  const paths = getRunPaths(process.argv[2])
  const token = process.argv[3]
  const run = readRun(paths.runState)
  const mock = new LLMock({ port: 0, host: '127.0.0.1', strict: true, logLevel: 'silent' })
  mock.loadFixtureFile(fileURLToPath(new URL('./mock-fixtures/chat.json', import.meta.url)))
  await mock.start()
  let stopping: Promise<void> | undefined
  const stop = () =>
    (stopping ??= (async () => {
      const entries = mock.journal.getAll()
      writeFileSync(
        join(paths.logs, 'aimock-summary.json'),
        JSON.stringify({
          version: AIMOCK_VERSION,
          requests: entries.length,
          unmatched: entries.filter((entry) => !entry.response.fixture).length
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
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ pid: process.pid, token }))
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
      platform: run.metadata.platform
    }),
    { mode: 0o600 }
  )
  renameSync(`${record}.tmp`, record)
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`)
  process.exitCode = 1
})
