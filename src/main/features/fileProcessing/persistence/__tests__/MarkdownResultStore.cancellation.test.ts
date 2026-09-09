import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import { createDeferred } from '@shared/utils/async'
import AdmZip from 'adm-zip'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { markdownResultStore } from '../MarkdownResultStore'

vi.mock('node:fs/promises', async (importOriginal) => {
  const original = await importOriginal<typeof fs>()
  return { ...original, rename: vi.fn(original.rename) }
})

let tempRoot: string
let outputPath: AbsoluteFilePath
let downloadDir: string

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'markdown-cancellation-'))
  outputPath = AbsoluteFilePathSchema.parse(path.join(tempRoot, 'output.md'))
  downloadDir = path.join(tempRoot, 'downloads')
  vi.mocked(application.getPath).mockReturnValue(downloadDir)
  await fs.writeFile(outputPath, '# original')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(tempRoot, { recursive: true, force: true })
})

describe('MarkdownResultStore cancellation at the write boundary', () => {
  it('leaves an existing target untouched for an already-cancelled inline result', async () => {
    const reason = new Error('cancelled before persistence')

    await expect(
      markdownResultStore.persistResultToPath({
        jobId: 'cancelled-inline',
        path: outputPath,
        result: { kind: 'markdown', markdownContent: '# replacement' },
        signal: AbortSignal.abort(reason)
      })
    ).rejects.toBe(reason)

    await expect(fs.readFile(outputPath, 'utf8')).resolves.toBe('# original')
    await expect(fs.readdir(tempRoot)).resolves.toEqual(['output.md'])
  })

  it('finishes ZIP cleanup but never overwrites the target when cancelled during extraction', async () => {
    const controller = new AbortController()
    const reason = new DOMException('extraction deadline', 'TimeoutError')
    const extracting = createDeferred<void>()
    const releaseExtraction = createDeferred<void>()
    const entryData = StreamZip.async.prototype.entryData
    vi.spyOn(StreamZip.async.prototype, 'entryData').mockImplementationOnce(async function (
      this: InstanceType<typeof StreamZip.async>,
      entry
    ) {
      extracting.resolve()
      await releaseExtraction.promise
      return entryData.call(this, entry)
    })
    const zip = new AdmZip()
    zip.addFile('result/output.md', Buffer.from('# replacement'))
    const rejected = expect(
      markdownResultStore.persistResultToPath({
        jobId: 'cancelled-extraction',
        path: outputPath,
        result: { kind: 'response-zip', response: new Response(new Uint8Array(zip.toBuffer())) },
        signal: controller.signal
      })
    ).rejects.toBe(reason)

    await extracting.promise
    controller.abort(reason)
    releaseExtraction.resolve()
    await rejected

    await expect(fs.readFile(outputPath, 'utf8')).resolves.toBe('# original')
    await expect(fs.readdir(downloadDir)).resolves.toEqual([])
  })

  it('reports a successful atomic write when cancellation arrives during commit', async () => {
    const controller = new AbortController()
    const { rename } = await vi.importActual<typeof fs>('node:fs/promises')
    vi.mocked(fs.rename).mockImplementationOnce(async (source, destination) => {
      await rename(source, destination)
      controller.abort(new Error('cancelled after rename'))
    })

    await expect(
      markdownResultStore.persistResultToPath({
        jobId: 'committed-result',
        path: outputPath,
        result: { kind: 'markdown', markdownContent: '# committed' },
        signal: controller.signal
      })
    ).resolves.toBe(outputPath)

    expect(controller.signal.aborted).toBe(true)
    await expect(fs.readFile(outputPath, 'utf8')).resolves.toBe('# committed')
    await expect(fs.readdir(tempRoot)).resolves.toEqual(['output.md'])
  })
})
