import { describe, expect, it } from 'vitest'

import { DeepSeekImporter } from '../DeepSeekImporter'
import { archiveFixture, conversation } from './fixtures'

describe('DeepSeek importer normalization', () => {
  it('maps source roles, status, graph, timestamps and model into the import contract', async () => {
    const source = conversation()
    source.messages[1].status = 'TIMEOUT'
    source.messages = [source.messages[2], source.messages[1], source.messages[0]]
    const archive = await new DeepSeekImporter().open(await archiveFixture([], 3, source))
    try {
      expect(archive.sourceIds).toEqual(['sample'])
      expect(await archive.preview()).toEqual({ messages: 3, missingFiles: [] })
      const result = await archive.load('sample', {
        signal: new AbortController().signal,
        files: {},
        saveFile: () => {
          throw new Error('Text-only history must not create managed files')
        }
      })
      expect(result).toMatchObject({
        name: 'A synthetic branch',
        activeSourceId: '2',
        createdAt: Date.parse('2026-01-01T00:00:00Z'),
        updatedAt: Date.parse('2026-01-02T00:00:00Z')
      })
      const user = result.messages.find((node) => node.sourceId === '1')!
      expect(result.messages[0]).toBe(user)
      expect(user).toMatchObject({
        parentSourceId: null,
        role: 'user',
        status: 'success',
        createdAt: Date.parse('2026-01-01T00:00:00Z'),
        data: { parts: [{ type: 'text', text: 'Remember the word mango' }] }
      })
      expect(result.messages.find((node) => node.sourceId === '2')).toMatchObject({
        parentSourceId: '1',
        role: 'assistant',
        status: 'error',
        model: { id: 'imported-history', name: 'DeepSeek', provider: 'deepseek' },
        data: { importedHistory: { source: 'deepseek', messageId: '2', status: 'TIMEOUT' } }
      })
      expect(result.messages.find((node) => node.sourceId === '3')?.parentSourceId).toBe('1')
    } finally {
      await archive.close()
    }
  })

  it('keeps missing-file metadata and warnings without creating a managed file', async () => {
    const source = conversation()
    source.title = ''
    source.messages[0].fragments.push({
      type: 'FILE',
      files: [{ id: 'missing', file_name: 'missing.png', file_size: 3, is_image: true, export_path: null }]
    })
    const archive = await new DeepSeekImporter().open(await archiveFixture([], 3, source))
    try {
      expect(await archive.preview()).toEqual({ messages: 3, missingFiles: ['missing.png'] })
      const result = await archive.load('sample', {
        signal: new AbortController().signal,
        files: {},
        saveFile: () => {
          throw new Error('An unavailable attachment must not create a managed file')
        }
      })
      expect(result.name).toBe('DeepSeek')
      expect(result.messages[0].data.importedHistory?.missingFiles).toEqual([
        { id: 'missing', name: 'missing.png', size: 3, isImage: true }
      ])
    } finally {
      await archive.close()
    }
  })
})
