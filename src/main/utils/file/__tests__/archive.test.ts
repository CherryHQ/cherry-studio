import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import type { AbsoluteFilePath } from '@shared/types/file'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeAtomicZip } from '../archive'

describe('writeAtomicZip', () => {
  let workDir: string

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), 'atomic-zip-'))
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  it('streams a large fixed-length entry without leaving atomic temporary files', async () => {
    const chunkBytes = 1024 * 1024
    const chunkCount = 64
    const expectedBytes = chunkBytes * chunkCount
    const destination = path.join(workDir, 'large.zip') as AbsoluteFilePath

    await writeAtomicZip(destination, [
      {
        name: 'large.bin',
        expectedBytes,
        createReadStream: () =>
          Readable.from(
            (function* () {
              for (let index = 0; index < chunkCount; index += 1) yield Buffer.alloc(chunkBytes, index)
            })(),
            { objectMode: false }
          )
      }
    ])

    const zip = new StreamZip.async({ file: destination })
    try {
      const entries = await zip.entries()
      expect(entries['large.bin'].size).toBe(expectedBytes)
    } finally {
      await zip.close()
    }
    expect((await readdir(workDir)).filter((name) => name.includes('.tmp-'))).toEqual([])
  }, 20_000)

  it('opens stream entries one at a time', async () => {
    const destination = path.join(workDir, 'sequential.zip') as AbsoluteFilePath
    let activeStreams = 0
    let maxActiveStreams = 0
    const entry = (name: string) => ({
      name,
      expectedBytes: 1,
      createReadStream: () => {
        activeStreams += 1
        maxActiveStreams = Math.max(maxActiveStreams, activeStreams)
        return Readable.from([Buffer.from(name)]).once('end', () => {
          activeStreams -= 1
        })
      }
    })

    await writeAtomicZip(destination, [entry('a'), entry('b'), entry('c')])

    expect(maxActiveStreams).toBe(1)
    expect(activeStreams).toBe(0)
  })
})
