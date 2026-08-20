import type { McpResource } from '@shared/types/mcp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getResource = vi.fn()

vi.mock('@application', () => ({
  application: {
    get: (name: string) => {
      if (name === 'McpRuntimeService') return { getResource }
      throw new Error(`unexpected service: ${name}`)
    }
  }
}))

import { readMcpResourcePreview } from '../resourcePreview'

function contents(...items: Partial<McpResource>[]) {
  return { contents: items.map((item) => ({ serverId: 's1', serverName: 'S1', name: '', ...item })) }
}

describe('readMcpResourcePreview', () => {
  beforeEach(() => {
    getResource.mockReset()
  })

  it('caps the text it hands back but reports the full length', async () => {
    getResource.mockResolvedValue(contents({ uri: 'x://a', text: 'abcdefghij', mimeType: 'text/plain' }))

    const preview = await readMcpResourcePreview({ serverId: 's1', uri: 'x://a', maxChars: 4 })

    // The renderer decides inline-vs-reference from totalChars without the rest crossing IPC.
    expect(preview).toEqual({ text: 'abcd', totalChars: 10, mimeType: 'text/plain', isBinary: false })
  })

  it('reports binary content instead of inventing text for it', async () => {
    getResource.mockResolvedValue(contents({ uri: 'x://bin', blob: 'AAAA', mimeType: 'image/png' }))

    const preview = await readMcpResourcePreview({ serverId: 's1', uri: 'x://bin', maxChars: 4000 })

    expect(preview).toEqual({ text: '', totalChars: 0, mimeType: 'image/png', isBinary: true })
  })

  it('joins multi-part text content', async () => {
    getResource.mockResolvedValue(contents({ uri: 'x://a', text: 'one' }, { uri: 'x://a', text: 'two' }))

    const preview = await readMcpResourcePreview({ serverId: 's1', uri: 'x://a', maxChars: 4000 })

    expect(preview.text).toBe('one\ntwo')
    expect(preview.isBinary).toBe(false)
  })
})
