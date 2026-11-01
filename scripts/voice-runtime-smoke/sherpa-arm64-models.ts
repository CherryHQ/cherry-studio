import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { getModelBundle } from '../../src/main/ai/localModel/catalog/catalog'

async function main() {
  for (const id of ['kokoro-multi-lang-v1.1', 'funasr-nano-int8'] as const) {
    for (const file of getModelBundle(id).files) {
      const source = file.sources?.find((source) => source.source === 'huggingface')
      assert(source?.repo && source.revision && source.remoteFile)
      const output = join('.native-models', id, file.relPath)
      const existing = await readFile(output).catch(() => undefined)
      if (existing && createHash('sha256').update(existing).digest('hex') === file.sha256) continue
      const response = await fetch(
        `https://huggingface.co/${source.repo}/resolve/${source.revision}/${source.remoteFile}`
      )
      assert(response.ok, `${file.relPath}: HTTP ${response.status}`)
      const bytes = Buffer.from(await response.arrayBuffer())
      assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.relPath)
      await mkdir(dirname(output), { recursive: true })
      await writeFile(output, bytes)
      process.stdout.write(`${id}/${file.relPath}: verified\n`)
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`)
  process.exitCode = 1
})
