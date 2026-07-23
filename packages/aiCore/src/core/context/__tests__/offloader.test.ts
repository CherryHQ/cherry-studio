import { describe, expect, it, vi } from 'vitest'

import { Offloader, type VFSStorageAdapter } from '../offloader'

/** In-memory adapter with spied write/exists (no getPhysicalPath). */
function makeMemoryAdapter() {
  const store = new Map<string, string>()
  return {
    store,
    write: vi.fn((filename: string, content: string) => {
      store.set(filename, content)
    }),
    read: vi.fn((filename: string) => store.get(filename) ?? null),
    exists: vi.fn((filename: string) => store.has(filename))
  }
}

/** Fully-async in-memory adapter with spied write/exists. */
function makeAsyncMemoryAdapter() {
  const store = new Map<string, string>()
  return {
    store,
    write: vi.fn(async (filename: string, content: string) => {
      store.set(filename, content)
    }),
    read: vi.fn(async (filename: string) => store.get(filename) ?? null),
    exists: vi.fn(async (filename: string) => store.has(filename))
  }
}

describe('Offloader', () => {
  const makeOffloader = (threshold = 50) => {
    const adapter = makeMemoryAdapter()
    return { adapter, offloader: new Offloader({ threshold, adapter }) }
  }

  it('does not offload small content', async () => {
    const { offloader } = makeOffloader()
    const smallText = 'Hello world!'
    const result = await offloader.offloadAsync(smallText)

    expect(result.isOffloaded).toBe(false)
    expect(result.content).toBe(smallText)
    expect(result.uri).toBeUndefined()
  })

  it('offloads large content and preserves tail by default', async () => {
    const { offloader, adapter } = makeOffloader()
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1} of the long log file that goes on and on.`)
    const largeText = lines.join('\n')

    const result = await offloader.offloadAsync(largeText)

    expect(result.isOffloaded).toBe(true)
    expect(result.uri).toMatch(/^context:\/\/vfs\/vfs_.*\.txt$/)

    // Original content persisted through the adapter
    const filename = result.uri?.replace('context://vfs/', '') ?? ''
    expect(adapter.store.get(filename)).toBe(largeText)

    // Default tailChars=2000, so last lines are included
    expect(result.content).toContain('Line 50')
    expect(result.content).toContain('output truncated')
    // Marker is wrapped in <persisted-output> so the LLM clearly
    // distinguishes injected metadata from surrounding head/tail.
    expect(result.content).toContain('<persisted-output>')
    expect(result.content).toContain('</persisted-output>')
    // Tail-only case: explicit "preceding content omitted, last N shown below" descriptor
    expect(result.content).toMatch(/preceding content omitted, last \d+ chars shown below/)
    // No getPhysicalPath on the adapter → URI-only handle
    expect(result.content).toContain('Full output:')
    expect(result.content).toContain('context://vfs/')
  })

  it('falls back to URI-only marker when adapter does not expose getPhysicalPath', async () => {
    // Adapter implements only the required methods — no getPhysicalPath
    const memDb = new Map<string, string>()
    const minimalAdapter: VFSStorageAdapter = {
      write(filename, content) {
        memDb.set(filename, content)
      },
      read(filename) {
        return memDb.get(filename) ?? null
      }
    }
    const local = new Offloader({ adapter: minimalAdapter, threshold: 50 })
    const longText = 'x'.repeat(500)

    const result = await local.offloadAsync(longText, { tailChars: 10, headChars: 10 })

    expect(result.isOffloaded).toBe(true)
    expect(result.content).toContain('Full output:')
    expect(result.content).toContain('context://vfs/')
    expect(result.content).not.toContain('Full output saved to:')
    expect(result.content).not.toContain('URI (alternative):')
  })

  it('includes the physical path as primary handle when adapter exposes getPhysicalPath', async () => {
    const memDb = new Map<string, string>()
    const adapter: VFSStorageAdapter = {
      write(filename, content) {
        memDb.set(filename, content)
      },
      read(filename) {
        return memDb.get(filename) ?? null
      },
      getPhysicalPath(filename) {
        return `/mem/store/${filename}`
      }
    }
    const local = new Offloader({ adapter, threshold: 50 })
    const longText = 'z'.repeat(500)

    const result = await local.offloadAsync(longText, { tailChars: 10, headChars: 10 })

    expect(result.isOffloaded).toBe(true)
    expect(result.content).toContain('Full output saved to: /mem/store/vfs_')
    expect(result.content).toContain('URI (alternative):')
  })

  it('awaits async getPhysicalPath in offloadAsync and includes the resolved path', async () => {
    const memDb = new Map<string, string>()
    const asyncAdapter: VFSStorageAdapter = {
      async write(filename, content) {
        memDb.set(filename, content)
      },
      async read(filename) {
        return memDb.get(filename) ?? null
      },
      async getPhysicalPath(filename) {
        return `/virtual/store/${filename}`
      }
    }
    const local = new Offloader({ adapter: asyncAdapter, threshold: 50 })
    const longText = 'y'.repeat(500)

    const result = await local.offloadAsync(longText, { tailChars: 10, headChars: 10 })

    expect(result.isOffloaded).toBe(true)
    expect(result.content).toContain('Full output saved to: /virtual/store/vfs_')
    expect(result.content).toContain('URI (alternative):')
  })

  it('offloads with tailChars: 0 and headChars: 0 (no content preserved)', async () => {
    const { offloader } = makeOffloader()
    const largeText = 'A'.repeat(100)

    const result = await offloader.offloadAsync(largeText, { tailChars: 0, headChars: 0 })

    expect(result.isOffloaded).toBe(true)
    expect(result.content).toContain('output truncated')
    expect(result.content).toContain('100 chars')
    // Case 4 (no head, no tail): explicit "preview omitted" descriptor
    expect(result.content).toContain('preview omitted')
    expect(result.content).not.toContain('AAAA')
  })

  it('preserves head content when headChars is set', async () => {
    const { offloader } = makeOffloader()
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`)
    const largeText = lines.join('\n')

    const result = await offloader.offloadAsync(largeText, { headChars: 30, tailChars: 0 })

    expect(result.isOffloaded).toBe(true)
    expect(result.content).toContain('Line 1')
    expect(result.content).toContain('output truncated')
    // Head-only case: explicit "first N shown above, rest omitted" descriptor
    expect(result.content).toMatch(/first \d+ chars shown above, rest omitted/)
    expect(result.content).not.toContain('Line 50')
  })

  it('preserves both head and tail content', async () => {
    const { offloader } = makeOffloader()
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i + 1}`)
    const largeText = lines.join('\n')

    const result = await offloader.offloadAsync(largeText, { headChars: 30, tailChars: 30 })

    expect(result.isOffloaded).toBe(true)
    expect(result.content).toContain('Line 1')
    expect(result.content).toContain('Line 50')
    expect(result.content).toContain('output truncated')
    // Head + tail case: explicit "first N above, last M below" descriptor
    expect(result.content).toMatch(/first \d+ chars shown above, last \d+ chars shown below/)
  })

  it('does not offload when headChars + tailChars cover entire content', async () => {
    const { offloader } = makeOffloader()
    const text = 'A'.repeat(80) // over threshold (50) but headChars + tailChars covers it

    const result = await offloader.offloadAsync(text, { headChars: 40, tailChars: 40 })

    expect(result.isOffloaded).toBe(false)
    expect(result.content).toBe(text)
  })

  it('snaps to line boundaries', async () => {
    const { offloader } = makeOffloader()
    // Each line is "Line XX" = 7 chars + newline = 8 chars
    const lines = Array.from({ length: 20 }, (_, i) => `Line ${String(i + 1).padStart(2, '0')}`)
    const largeText = lines.join('\n')

    // Request headChars=10 — should snap to nearest line boundary
    const result = await offloader.offloadAsync(largeText, { headChars: 10, tailChars: 10 })

    expect(result.isOffloaded).toBe(true)
    // Head should contain complete lines only
    const headPart = result.content.split('<persisted-output>')[0]
    // Should not have a partial line
    expect(headPart.trim()).toMatch(/Line \d+$/m)
  })

  it('includes totalLines and totalChars in truncation notice', async () => {
    const { offloader } = makeOffloader()
    const lines = Array.from({ length: 10 }, (_, i) => `Line ${i + 1}`)
    const largeText = lines.join('\n')

    const result = await offloader.offloadAsync(largeText, { tailChars: 10, headChars: 0 })

    expect(result.isOffloaded).toBe(true)
    expect(result.content).toContain('10 lines')
    expect(result.content).toContain(`${largeText.length} chars`)
  })

  it('respects custom threshold per-call', async () => {
    const { offloader } = makeOffloader()
    const text = 'A'.repeat(80)

    // Instance threshold is 50, but per-call threshold is 100 → should not offload
    const result = await offloader.offloadAsync(text, { threshold: 100 })
    expect(result.isOffloaded).toBe(false)

    // Per-call threshold 60 → should offload
    const result2 = await offloader.offloadAsync(text, { threshold: 60, tailChars: 0, headChars: 0 })
    expect(result2.isOffloaded).toBe(true)
  })
})

describe('Offloader — content-addressed filenames', () => {
  const BIG = `${'x'.repeat(100)}\n${'y'.repeat(100)}`

  it('filename is vfs_<16-hex>.txt derived from content only', async () => {
    const adapter = makeMemoryAdapter()
    const o = new Offloader({ threshold: 10, adapter })
    const r = await o.offloadAsync(BIG, { tailChars: 20 })
    expect(r.isOffloaded).toBe(true)
    const filename = r.uri?.replace('context://vfs/', '')
    expect(filename).toMatch(/^vfs_[a-f0-9]{16}\.txt$/)
  })

  it('same content → same filename and identical marker across instances', async () => {
    const adapter = makeMemoryAdapter()
    const a = new Offloader({ threshold: 10, adapter })
    const b = new Offloader({ threshold: 10, adapter })
    const r1 = await a.offloadAsync(BIG, { tailChars: 20 })
    const r2 = await b.offloadAsync(BIG, { tailChars: 20 })
    expect(r1.uri).toBe(r2.uri)
    expect(r1.content).toBe(r2.content) // marker is byte-stable → provider prefix cache holds
  })

  it('different content → different filename', async () => {
    const adapter = makeMemoryAdapter()
    const o = new Offloader({ threshold: 10, adapter })
    const r1 = await o.offloadAsync(BIG, { tailChars: 20 })
    const r2 = await o.offloadAsync(`${BIG}!`, { tailChars: 20 })
    expect(r1.uri).not.toBe(r2.uri)
  })

  it('re-offloading identical content on the same instance skips the adapter write', async () => {
    const adapter = makeMemoryAdapter()
    const o = new Offloader({ threshold: 10, adapter })
    await o.offloadAsync(BIG, { tailChars: 20 })
    await o.offloadAsync(BIG, { tailChars: 20 })
    expect(adapter.write).toHaveBeenCalledTimes(1)
  })

  it('a fresh instance skips the write when adapter.exists reports the file', async () => {
    const adapter = makeMemoryAdapter()
    await new Offloader({ threshold: 10, adapter }).offloadAsync(BIG, { tailChars: 20 })
    await new Offloader({ threshold: 10, adapter }).offloadAsync(BIG, { tailChars: 20 })
    expect(adapter.write).toHaveBeenCalledTimes(1)
    expect(adapter.exists).toHaveBeenCalled()
  })

  it('async adapter: re-offloading identical content skips the write via exists()', async () => {
    const adapter = makeAsyncMemoryAdapter()
    const o = new Offloader({ threshold: 10, adapter })
    await o.offloadAsync(BIG, { tailChars: 20 })
    await o.offloadAsync(BIG, { tailChars: 20 })
    expect(adapter.write).toHaveBeenCalledTimes(1)
  })

  it('async adapter: a fresh instance skips the write when adapter.exists reports the file', async () => {
    const adapter = makeAsyncMemoryAdapter()
    await new Offloader({ threshold: 10, adapter }).offloadAsync(BIG, { tailChars: 20 })
    await new Offloader({ threshold: 10, adapter }).offloadAsync(BIG, { tailChars: 20 })
    expect(adapter.write).toHaveBeenCalledTimes(1)
    expect(adapter.exists).toHaveBeenCalled()
  })

  it('writes when the adapter has no exists() (overwrite is harmless, same content)', async () => {
    const store = new Map<string, string>()
    const write = vi.fn((filename: string, content: string) => {
      store.set(filename, content)
    })
    const adapter: VFSStorageAdapter = { write, read: (f) => store.get(f) ?? null }
    const o = new Offloader({ threshold: 10, adapter })
    const r1 = await o.offloadAsync(BIG, { tailChars: 20 })
    const r2 = await o.offloadAsync(BIG, { tailChars: 20 })
    expect(write).toHaveBeenCalledTimes(2)
    expect(r1.uri).toBe(r2.uri)
  })
})
