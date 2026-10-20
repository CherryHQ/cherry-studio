import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { preferenceService } from '@data/PreferenceService'
import type { MessageExportView } from '@renderer/types/messageExport'

import { useMessageExportActions } from '../useMessageExportActions'

const { createPage, appendBlocks } = vi.hoisted(() => ({ createPage: vi.fn(), appendBlocks: vi.fn() }))
vi.mock('@notionhq/client', () => ({
  Client: class {
    pages = { create: createPage }
  }
}))
vi.mock('notion-helper', () => ({ appendBlocks }))

const first: MessageExportView = {
  id: 'first',
  role: 'user',
  topicId: 'topic',
  createdAt: '2026-01-01',
  status: 'success',
  parts: [{ type: 'text', text: 'Question' }]
}
const second: MessageExportView = {
  ...first,
  id: 'second',
  role: 'assistant',
  parts: [
    { type: 'reasoning', text: 'Private reasoning' },
    { type: 'text', text: 'Answer' }
  ]
}
const save = vi.fn()
const write = vi.fn()
const ipcRequest = vi.fn()
const showObsidian = vi.fn()
const fetchMock = vi.fn()
const renderExports = (topicName?: string) =>
  renderHook(() =>
    useMessageExportActions({
      topicName,
      exportToObsidian: showObsidian
    })
  ).result

beforeEach(async () => {
  vi.clearAllMocks()
  save.mockResolvedValue('/tmp/export.md')
  showObsidian.mockResolvedValue(true)
  ipcRequest.mockResolvedValue({ ok: true, data: true })
  createPage.mockResolvedValue({ id: 'page' })
  appendBlocks.mockResolvedValue({ apiResponses: [] })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      file: { save, write },
      ipcApi: { request: ipcRequest, on: vi.fn() }
    }
  })
  vi.stubGlobal('fetch', fetchMock)
  await preferenceService.set('data.export.markdown.use_topic_naming_for_message_title', false)
  await preferenceService.set('data.export.markdown.path', '')
})

afterEach(() => vi.unstubAllGlobals())

describe('message export actions', () => {
  it('keeps single-message filenames and content while naming a selection after its topic', async () => {
    const result = renderExports('  Topic name  ')
    await act(async () => {
      await result.current.exportMessageAsMarkdown?.(first)
    })
    expect(save.mock.calls[0][0]).toBe('Question.md')
    expect(save.mock.calls[0][1]).toContain('Question')
    expect(save.mock.calls[0][1]).not.toContain('\n---\n')

    await act(async () => {
      expect(await result.current.exportMessages([first, second], 'markdown')).toBe(true)
    })
    const [filename, markdown] = save.mock.calls[1]
    expect(filename).toBe('Topic name.md')
    expect(markdown).toMatch(/Question[\s\S]*\n---\n[\s\S]*Answer/)
    expect(markdown).not.toContain('Private reasoning')
  })

  it('includes reasoning only when requested and falls back to the first message for unnamed topics', async () => {
    const result = renderExports('   ')
    await act(async () => {
      await result.current.exportMessages([first, second], 'markdown-reason')
    })
    expect(save.mock.calls[0][0]).toBe('Question.md')
    expect(save.mock.calls[0][1]).toContain('Private reasoning')
    expect(save.mock.calls[0][1]).toContain('Answer')
  })

  it('writes to the configured directory without opening the save dialog', async () => {
    await preferenceService.set('data.export.markdown.path', '/exports')
    const result = renderExports('Topic')
    await act(async () => {
      expect(await result.current.exportMessages([first], 'markdown')).toBe(true)
    })
    expect(save).not.toHaveBeenCalled()
    expect(write).toHaveBeenCalledWith(
      expect.stringMatching(/^\/exports\/Topic \d{4}-.*\.md$/),
      expect.stringContaining('Question')
    )
  })

  it('returns false on save cancellation or failure and permits a later retry', async () => {
    const result = renderExports('Topic')
    save.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('disk full'))
    await act(async () => {
      expect(await result.current.exportMessages([first], 'markdown')).toBe(false)
      expect(await result.current.exportMessages([first], 'markdown')).toBe(false)
      expect(await result.current.exportMessages([first], 'markdown')).toBe(true)
    })
    expect(save).toHaveBeenCalledTimes(3)
  })

  it('prevents a second Markdown export while the first is preparing its file', async () => {
    const result = renderExports('Topic')
    let resolvePath!: (path: string) => void
    vi.mocked(preferenceService.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePath = resolve
        })
    )
    const pending = result.current.exportMessages([first], 'markdown')
    await vi.waitFor(() => expect(resolvePath).toBeDefined())
    expect(await result.current.exportMessages([second], 'markdown')).toBe(false)
    resolvePath('')
    expect(await pending).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][1]).toContain('Question')
    expect(save.mock.calls[0][1]).not.toContain('Answer')
  })

  it('releases the export lock when reading preferences fails', async () => {
    const result = renderExports('Topic')
    vi.mocked(preferenceService.get).mockRejectedValueOnce(new Error('preference unavailable'))
    expect(await result.current.exportMessages([first], 'markdown')).toBe(false)
    expect(await result.current.exportMessages([first], 'markdown')).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('exports Word content in order with a safe filename and preserves the save result', async () => {
    const result = renderExports('Report/Q1')
    await act(async () => {
      expect(await result.current.exportMessages([first, second], 'word')).toBe(true)
    })
    expect(ipcRequest).toHaveBeenCalledWith('export.word.from_markdown', {
      fileName: 'Report_Q1',
      markdown: expect.stringMatching(/Question[\s\S]*Answer/)
    })
    ipcRequest.mockResolvedValueOnce({ ok: true, data: false })
    await act(async () => {
      expect(await result.current.exportMessages([first], 'word')).toBe(false)
    })
  })

  it('uses the supplied Obsidian interaction for both entry points and returns cancellation', async () => {
    const result = renderExports('Folder\\Topic')
    await act(async () => {
      await result.current.exportToObsidian?.(first)
    })
    expect(showObsidian).toHaveBeenCalledWith('Folder_Topic', [first])
    showObsidian.mockResolvedValueOnce(false)
    await act(async () => {
      expect(await result.current.exportMessages([first, second], 'obsidian')).toBe(false)
    })
    expect(showObsidian).toHaveBeenLastCalledWith('Folder_Topic', [first, second])
  })

  it('preserves the extra Notion topic heading only for selected-message exports', async () => {
    await preferenceService.set('data.integration.notion.api_key', 'test-key')
    await preferenceService.set('data.integration.notion.database_id', 'test-database')
    const result = renderExports('Topic name')
    await act(async () => {
      await result.current.exportToNotion?.(first)
    })
    const singleBlocks = JSON.stringify(appendBlocks.mock.calls[0][0].children)
    expect(singleBlocks).toContain('Question')
    expect(singleBlocks).not.toContain('Topic name')
    await act(async () => {
      expect(await result.current.exportMessages([first, second], 'notion')).toBe(true)
    })
    const multipleBlocks = JSON.stringify(appendBlocks.mock.calls[1][0].children)
    expect(multipleBlocks).toMatch(/Topic name[\s\S]*Question[\s\S]*Answer/)
    appendBlocks.mockResolvedValueOnce({ error: 'write failed' })
    await act(async () => {
      expect(await result.current.exportMessages([first], 'notion')).toBe(false)
    })
  })

  it.each(['yuque', 'joplin', 'siyuan'] as const)(
    'reports %s HTTP failures and exports real combined content on retry',
    async (target) => {
      await preferenceService.set('data.integration.yuque.token', 'test-token')
      await preferenceService.set('data.integration.yuque.repo_id', 'repo')
      await preferenceService.set('data.integration.joplin.url', 'http://joplin.test')
      await preferenceService.set('data.integration.joplin.token', 'test-token')
      await preferenceService.set('data.integration.siyuan.api_url', 'http://siyuan.test')
      await preferenceService.set('data.integration.siyuan.token', 'test-token')
      await preferenceService.set('data.integration.siyuan.box_id', 'box')
      const result = renderExports('Topic')
      fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
      await act(async () => {
        expect(await result.current.exportMessages([first, second], target)).toBe(false)
      })
      fetchMock.mockImplementation(async (url: string) => ({
        ok: true,
        json: async () => ({ code: 0, data: url.endsWith('renderSprig') ? '/exports' : { id: 'document' } })
      }))
      await act(async () => {
        expect(await result.current.exportMessages([first, second], target)).toBe(true)
      })
      const payloads = fetchMock.mock.calls
        .map(([, options]) => options?.body)
        .filter(Boolean)
        .join('\n')
      expect(payloads).toMatch(/Question[\s\S]*Answer/)
      expect(payloads).toContain('Topic')
    }
  )
})
