import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { JsonStreamReader } from '../JsonStreamReader'

describe('JsonStreamReader', () => {
  let tempDir: string
  let filePath: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-stream-reader-'))
    filePath = path.join(tempDir, 'rows.json')
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('awaits each bounded batch before consuming the next one', async () => {
    fs.writeFileSync(filePath, JSON.stringify(Array.from({ length: 7 }, (_, id) => ({ id }))))
    const batches: number[][] = []
    let activeCallbacks = 0
    let maxActiveCallbacks = 0

    const total = await new JsonStreamReader(filePath).readInBatches<{ id: number }>(3, async (rows) => {
      activeCallbacks += 1
      maxActiveCallbacks = Math.max(maxActiveCallbacks, activeCallbacks)
      await new Promise((resolve) => setTimeout(resolve, 1))
      batches.push(rows.map((row) => row.id))
      activeCallbacks -= 1
    })

    expect(total).toBe(7)
    expect(batches).toEqual([[0, 1, 2], [3, 4, 5], [6]])
    expect(maxActiveCallbacks).toBe(1)
  })

  it('stops parsing when a batch callback fails', async () => {
    fs.writeFileSync(filePath, JSON.stringify(Array.from({ length: 10 }, (_, id) => ({ id }))))
    const callback = vi.fn(async () => {
      throw new Error('insert failed')
    })

    await expect(new JsonStreamReader(filePath).readInBatches(2, callback)).rejects.toThrow('insert failed')
    expect(callback).toHaveBeenCalledOnce()
  })

  it('counts and samples without loading the entire array', async () => {
    fs.writeFileSync(filePath, JSON.stringify(Array.from({ length: 5 }, (_, id) => ({ id }))))
    const reader = new JsonStreamReader(filePath)

    expect(await reader.count()).toBe(5)
    expect(await reader.readSample<{ id: number }>(2)).toEqual([{ id: 0 }, { id: 1 }])
  })
})
