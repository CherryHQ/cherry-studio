import { preferenceService } from '@data/PreferenceService'
import { getTopicMessages } from '@renderer/hooks/useTopic'
import { toast } from '@renderer/services/toast'
import type { MessageExportView } from '@renderer/types/messageExport'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  exportMessageAsMarkdown,
  exportTopicAsMarkdown,
  messageToMarkdown,
  messageToMarkdownWithReasoning
} from '../ExportService'
import { collectExportableImages, serializeMessagesWithImages, writeImageAssets } from '../markdownImageExport'

// jsdom's Blob lacks the standard arrayBuffer(); shim it via FileReader so the
// production `blob.arrayBuffer()` call works unmodified in tests.
beforeAll(() => {
  if (typeof Blob.prototype.arrayBuffer !== 'function') {
    Blob.prototype.arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(this)
      })
    }
  }
})

vi.mock('@renderer/hooks/useTopic', () => ({
  getTopicMessages: vi.fn()
}))

// The mode choice is an interactive boundary: pipeline tests inject the user's
// decision through the same `chooseImageMode` hook the UI layer passes in.
const chooseImageMode = vi.fn<(imageCount: number) => Promise<'embed' | 'folder' | 'none' | null>>()

// --- Test data helpers ---

let idSeq = 0

function view(parts: unknown[], role: 'user' | 'assistant' = 'user'): MessageExportView {
  return {
    id: `m${++idSeq}`,
    role,
    topicId: 't1',
    createdAt: '2024-01-01T00:00:00Z',
    status: 'success',
    parts: parts as MessageExportView['parts']
  }
}

// 1x1 transparent PNG
const PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const PNG_1PX_RAW = PNG_1PX.slice('data:image/png;base64,'.length)
// 1x1 transparent GIF
const GIF_1PX = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'

function imageFilePart(url: string, entryId?: string, filename = 'photo.png', mediaType = 'image/png') {
  return {
    type: 'file',
    mediaType,
    url,
    filename,
    ...(entryId ? { providerMetadata: { cherry: { fileEntryId: entryId } } } : {})
  }
}

function generateImagePart(items: Array<{ id: string; name: string }>, state = 'output-available') {
  return {
    type: 'tool-generate_image',
    toolCallId: 'call-1',
    state,
    input: {},
    output: items
  }
}

// --- window.api stub (file save/write/mkdir/getPhysicalPath + ipc bridge) ---

const fileApi: Record<string, ReturnType<typeof vi.fn>> = {
  save: vi.fn(),
  write: vi.fn(),
  mkdir: vi.fn(),
  getPhysicalPath: vi.fn(),
  read: vi.fn(),
  writeWithId: vi.fn()
}
const ipcApiRequest = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'api', {
    value: {
      file: fileApi,
      ipcApi: { request: ipcApiRequest, on: vi.fn(() => () => {}) }
    },
    configurable: true
  })
})

// --- collectExportableImages ---

describe('collectExportableImages', () => {
  it('collects image file parts with fileEntryId as the dedup key', async () => {
    const message = view([{ type: 'text', text: 'look at this' }, imageFilePart('file:///data/Files/a.png', 'entry-a')])

    const { refs, unresolvedCount } = await collectExportableImages([message])

    expect(unresolvedCount).toBe(0)
    expect(refs).toEqual([
      {
        key: 'entry-a',
        source: 'file-part',
        url: 'file:///data/Files/a.png',
        filename: 'photo.png',
        mime: 'image/png'
      }
    ])
  })

  it('ignores non-image file parts', async () => {
    const message = view([{ type: 'file', mediaType: 'application/pdf', url: 'file:///data/Files/a.pdf' }])

    const { refs } = await collectExportableImages([message])

    expect(refs).toEqual([])
  })

  it('resolves generate_image output ids to file urls', async () => {
    fileApi.getPhysicalPath.mockResolvedValue('/data/Files/gen-1.png')
    const message = view([generateImagePart([{ id: 'gen-1', name: 'painting.png' }])], 'assistant')

    const { refs } = await collectExportableImages([message])

    expect(refs).toEqual([
      {
        key: 'gen-1',
        source: 'generate-image',
        url: 'file:///data/Files/gen-1.png',
        filename: 'painting.png'
      }
    ])
  })

  it('drops an unresolvable generate_image entry, counts it, and keeps the rest', async () => {
    fileApi.getPhysicalPath
      .mockRejectedValueOnce(new Error('entry cleaned up'))
      .mockResolvedValueOnce('/data/Files/gen-2.png')
    const message = view(
      [
        generateImagePart([
          { id: 'gone', name: 'old.png' },
          { id: 'gen-2', name: 'new.png' }
        ])
      ],
      'assistant'
    )

    const { refs, unresolvedCount } = await collectExportableImages([message])

    expect(unresolvedCount).toBe(1)
    expect(refs.map((ref) => ref.key)).toEqual(['gen-2'])
  })

  it('ignores generate_image parts that are still running', async () => {
    const message = view([generateImagePart([{ id: 'gen-1', name: 'a.png' }], 'input-available')])

    const { refs } = await collectExportableImages([message])

    expect(refs).toEqual([])
    expect(fileApi.getPhysicalPath).not.toHaveBeenCalled()
  })

  it('dedupes the same image referenced from two messages', async () => {
    const messages = [view([imageFilePart(PNG_1PX, 'entry-a')]), view([imageFilePart(PNG_1PX, 'entry-a')])]

    const { refs } = await collectExportableImages(messages)

    expect(refs).toHaveLength(1)
  })
})

// --- serializeMessagesWithImages ---

describe('serializeMessagesWithImages', () => {
  it('interleaves images with text in parts order and inlines data URIs (embed)', async () => {
    const message = view([
      { type: 'text', text: 'before the image' },
      imageFilePart(PNG_1PX, 'entry-a', 'shot one.png'),
      { type: 'text', text: 'after the image' }
    ])
    const { refs } = await collectExportableImages([message])

    const { overrides, skippedCount } = await serializeMessagesWithImages([message], 'embed', refs)

    expect(skippedCount).toBe(0)
    const content = overrides.get(message.id)!
    expect(content.indexOf('before the image')).toBeLessThan(content.indexOf('![shot one.png]'))
    expect(content.indexOf('![shot one.png]')).toBeLessThan(content.indexOf('after the image'))
    expect(content).toContain(`![shot one.png](data:image/png;base64,${PNG_1PX_RAW})`)
  })

  it('embeds two images from one message, both as data URIs (AC1)', async () => {
    const GIF_1PX_RAW = GIF_1PX.slice('data:image/gif;base64,'.length)
    const message = view([
      imageFilePart(PNG_1PX, 'entry-a', 'first.png'),
      { type: 'text', text: 'between the two pictures' },
      imageFilePart(GIF_1PX, 'entry-b', 'second.gif', 'image/gif')
    ])
    const { refs } = await collectExportableImages([message])

    const { overrides, skippedCount } = await serializeMessagesWithImages([message], 'embed', refs)

    expect(skippedCount).toBe(0)
    const content = overrides.get(message.id)!
    expect(content).toContain(`![first.png](data:image/png;base64,${PNG_1PX_RAW})`)
    expect(content).toContain(`![second.gif](data:image/gif;base64,${GIF_1PX_RAW})`)
    expect(content.indexOf('![first.png]')).toBeLessThan(content.indexOf('between the two pictures'))
    expect(content.indexOf('between the two pictures')).toBeLessThan(content.indexOf('![second.gif]'))
  })

  it('keeps an over-limit image in folder mode (no size cap there)', async () => {
    const oversized = `data:image/png;base64,${'A'.repeat(Math.ceil((10 * 1024 * 1024 + 1) / 3) * 4)}`
    const message = view([imageFilePart(oversized, 'entry-big')])
    const { refs } = await collectExportableImages([message])

    const { overrides, pendingWrites, skippedCount } = await serializeMessagesWithImages([message], 'folder', refs)

    expect(skippedCount).toBe(0)
    expect(pendingWrites).toHaveLength(1)
    expect(pendingWrites[0].ref.key).toBe('entry-big')
    expect(overrides.get(message.id)).toMatch(/!\[photo\.png\]\(assets\/img-/)
  })

  it('skips an embed image over 10 MiB and counts it', async () => {
    // 'A' padding decodes to zero bytes: ceil((limit+1)/3)*4 base64 chars yield limit+1 bytes.
    const oversized = `data:image/png;base64,${'A'.repeat(Math.ceil((10 * 1024 * 1024 + 1) / 3) * 4)}`
    const message = view([imageFilePart(oversized, 'entry-big')])
    const { refs } = await collectExportableImages([message])

    const { overrides, skippedCount, pendingWrites } = await serializeMessagesWithImages([message], 'embed', refs)

    expect(skippedCount).toBe(1)
    expect(pendingWrites).toEqual([])
    // no image survived: the message falls back to the shared text-only path
    expect(overrides.has(message.id)).toBe(false)
  })

  it('skips an unreadable image without aborting the export (embed)', async () => {
    const message = view([imageFilePart('data:,broken', 'entry-bad'), imageFilePart(PNG_1PX, 'entry-ok')])
    const { refs } = await collectExportableImages([message])

    const { overrides, skippedCount } = await serializeMessagesWithImages([message], 'embed', refs)

    expect(skippedCount).toBe(1)
    const content = overrides.get(message.id)!
    expect(content).not.toContain('data:,broken')
    expect(content).toContain(`data:image/png;base64,${PNG_1PX_RAW}`)
  })

  it('emits assets/ relative links and defers bytes (folder)', async () => {
    const message = view([{ type: 'text', text: 'see below' }, imageFilePart(PNG_1PX, 'entry-a')])
    const { refs } = await collectExportableImages([message])

    const { overrides, pendingWrites, skippedCount } = await serializeMessagesWithImages([message], 'folder', refs)

    expect(skippedCount).toBe(0)
    const content = overrides.get(message.id)!
    expect(content).toMatch(/!\[photo\.png\]\(assets\/img-[a-z0-9-]+\.png\)/)
    expect(pendingWrites).toEqual([{ fileName: expect.stringMatching(/^img-[a-z0-9-]+\.png$/), ref: refs[0] }])
  })

  it('allocates a distinct asset name per image so none overwrites another (folder)', async () => {
    const message = view([imageFilePart(PNG_1PX, 'entry-a'), imageFilePart(GIF_1PX, 'entry-b', 'anim.gif')])
    const { refs } = await collectExportableImages([message])

    const { pendingWrites } = await serializeMessagesWithImages([message], 'folder', refs)

    const names = pendingWrites.map((write) => write.fileName)
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
  })

  it('serializes generate_image outputs in both modes (folder)', async () => {
    fileApi.getPhysicalPath.mockResolvedValue('/data/Files/gen-1.png')
    ipcApiRequest.mockResolvedValue({ ok: true, data: { content: new Uint8Array([1, 2, 3]), mime: 'image/png' } })
    const message = view([generateImagePart([{ id: 'gen-1', name: 'painting.png' }])], 'assistant')
    const { refs } = await collectExportableImages([message])

    const folder = await serializeMessagesWithImages([message], 'folder', refs)
    expect(folder.overrides.get(message.id)).toMatch(/!\[painting\.png\]\(assets\/img-[a-z0-9-]+\.png\)/)

    const embed = await serializeMessagesWithImages([message], 'embed', refs)
    expect(embed.overrides.get(message.id)).toContain('![painting.png](data:image/png;base64,')
  })

  it('leaves messages without images unoverridden', async () => {
    const withImage = view([{ type: 'text', text: 'has image' }, imageFilePart(PNG_1PX, 'entry-a')])
    const textOnly = view([{ type: 'text', text: 'plain message' }])
    const { refs } = await collectExportableImages([withImage, textOnly])

    const { overrides } = await serializeMessagesWithImages([withImage, textOnly], 'embed', refs)

    expect(overrides.has(textOnly.id)).toBe(false)
    expect(overrides.has(withImage.id)).toBe(true)
  })
})

// --- writeImageAssets ---

describe('writeImageAssets', () => {
  it('creates assets/ and writes each image beside the markdown', async () => {
    ipcApiRequest.mockResolvedValue({ ok: true, data: { content: new Uint8Array([1, 2, 3]), mime: 'image/png' } })
    const pendingWrites = [
      {
        fileName: 'img-a.png',
        ref: { key: 'k', source: 'file-part', url: 'file:///data/Files/a.png', mime: 'image/png' } as const
      }
    ]

    const failedCount = await writeImageAssets('/tmp/exports', pendingWrites)

    expect(failedCount).toBe(0)
    expect(fileApi.mkdir).toHaveBeenCalledWith('/tmp/exports/assets')
    expect(fileApi.write).toHaveBeenCalledWith('/tmp/exports/assets/img-a.png', expect.any(Uint8Array))
  })

  it('keeps going when one image fails to write and reports the count', async () => {
    ipcApiRequest.mockResolvedValue({ ok: true, data: { content: new Uint8Array([1]), mime: 'image/png' } })
    fileApi.write.mockRejectedValueOnce(new Error('disk full'))
    const ref = { key: 'k', source: 'file-part', url: 'file:///data/Files/a.png', mime: 'image/png' } as const

    const failedCount = await writeImageAssets('/tmp/exports', [
      { fileName: 'img-a.png', ref },
      { fileName: 'img-b.png', ref }
    ])

    expect(failedCount).toBe(1)
    expect(fileApi.write).toHaveBeenCalledTimes(2)
  })

  it('does nothing when there are no pending writes', async () => {
    const failedCount = await writeImageAssets('/tmp/exports', [])

    expect(failedCount).toBe(0)
    expect(fileApi.mkdir).not.toHaveBeenCalled()
  })

  it('reports every image as failed when mkdir fails, without throwing', async () => {
    fileApi.mkdir.mockRejectedValueOnce(new Error('permission denied'))
    const ref = { key: 'k', source: 'file-part', url: 'file:///data/Files/a.png', mime: 'image/png' } as const

    const failedCount = await writeImageAssets('/tmp/exports', [
      { fileName: 'img-a.png', ref },
      { fileName: 'img-b.png', ref }
    ])

    // the .md is already saved by then: count-and-warn, never a thrown error
    expect(failedCount).toBe(2)
    expect(fileApi.write).not.toHaveBeenCalled()
  })
})

// --- rawContentOverride semantics ---

describe('messageToMarkdown rawContentOverride', () => {
  it('replaces the message text when provided', async () => {
    const message = view([{ type: 'text', text: 'original text' }])

    const markdown = await messageToMarkdown(message, undefined, 'OVERRIDE {{count}} content')

    expect(markdown).toContain('OVERRIDE {{count}} content')
    expect(markdown).not.toContain('original text')
  })

  it('keeps the current behavior when not provided', async () => {
    const message = view([{ type: 'text', text: 'original text' }])

    const markdown = await messageToMarkdown(message)

    expect(markdown).toContain('original text')
  })

  it('threads the override through the with-reasoning variant too (R6)', async () => {
    const message = view([{ type: 'text', text: 'original text' }], 'assistant')

    const markdown = await messageToMarkdownWithReasoning(message, undefined, 'REASONING VARIANT override')

    expect(markdown).toContain('REASONING VARIANT override')
    expect(markdown).not.toContain('original text')
  })
})

// --- export entry pipelines (mode × branch matrix) ---

describe('exportMessageAsMarkdown image pipeline', () => {
  const imageMessage = () => view([{ type: 'text', text: 'with picture' }, imageFilePart(PNG_1PX, 'entry-a')])

  it('never consults the mode chooser for messages without images', async () => {
    fileApi.save.mockResolvedValue('/tmp/x/a.md')
    const message = view([{ type: 'text', text: 'text only' }])

    await exportMessageAsMarkdown(message, false, undefined, chooseImageMode)

    expect(chooseImageMode).not.toHaveBeenCalled()
    expect(fileApi.save).toHaveBeenCalledTimes(1)
    expect(fileApi.save.mock.calls[0][1]).not.toContain('data:image')
  })

  it('exports text-only with a warning when the only image failed to resolve', async () => {
    fileApi.save.mockResolvedValue('/tmp/x/a.md')
    fileApi.getPhysicalPath.mockRejectedValue(new Error('entry cleaned up'))
    const message = view([
      { type: 'text', text: 'here is a painting' },
      generateImagePart([{ id: 'gone', name: 'painting.png' }])
    ])

    await exportMessageAsMarkdown(message, false, undefined, chooseImageMode)

    // nothing left to carry: chooser untouched, plain text export, skipped-count toast
    expect(chooseImageMode).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith('已跳过 1 张图片（无法获取或读取）')
    expect(fileApi.save).toHaveBeenCalledTimes(1)
    expect(fileApi.save.mock.calls[0][1]).toContain('here is a painting')
    expect(fileApi.save.mock.calls[0][1]).not.toContain('data:image')
  })

  it('aborts with zero file writes when the user cancels the mode choice', async () => {
    chooseImageMode.mockResolvedValue(null)

    await exportMessageAsMarkdown(imageMessage(), false, undefined, chooseImageMode)

    expect(fileApi.save).not.toHaveBeenCalled()
    expect(fileApi.write).not.toHaveBeenCalled()
    expect(fileApi.mkdir).not.toHaveBeenCalled()

    // export mutex must be released: a second call proceeds to the save dialog
    fileApi.save.mockResolvedValue('/tmp/x/a.md')
    await exportMessageAsMarkdown(view([{ type: 'text', text: 'text only' }]), false, undefined, chooseImageMode)
    expect(fileApi.save).toHaveBeenCalledTimes(1)
  })

  it('exports plain text when the user picks "no images"', async () => {
    chooseImageMode.mockResolvedValue('none')
    fileApi.save.mockResolvedValue('/tmp/x/a.md')

    await exportMessageAsMarkdown(imageMessage(), false, undefined, chooseImageMode)

    expect(fileApi.save.mock.calls[0][1]).toContain('with picture')
    expect(fileApi.save.mock.calls[0][1]).not.toContain('data:image')
    expect(fileApi.mkdir).not.toHaveBeenCalled()
  })

  it('embeds data URIs when the user picks "embed" (save dialog branch)', async () => {
    chooseImageMode.mockResolvedValue('embed')
    fileApi.save.mockResolvedValue('/tmp/x/a.md')

    await exportMessageAsMarkdown(imageMessage(), false, undefined, chooseImageMode)

    expect(fileApi.save.mock.calls[0][1]).toContain(`data:image/png;base64,${PNG_1PX_RAW}`)
    expect(fileApi.mkdir).not.toHaveBeenCalled()
  })

  it('writes an assets folder next to the saved file (folder, save dialog branch)', async () => {
    chooseImageMode.mockResolvedValue('folder')
    fileApi.save.mockResolvedValue('/tmp/exports/my chat.md')

    await exportMessageAsMarkdown(imageMessage(), false, undefined, chooseImageMode)

    expect(fileApi.mkdir).toHaveBeenCalledWith('/tmp/exports/assets')
    // the .md went through the save dialog; only the image is a direct write
    expect(fileApi.save).toHaveBeenCalledTimes(1)
    const markdown = fileApi.save.mock.calls[0][1] as string
    const link = markdown.match(/\(assets\/(img-[a-z0-9-]+\.png)\)/)![1]
    expect(fileApi.write).toHaveBeenCalledTimes(1)
    expect(fileApi.write.mock.calls[0][0]).toBe(`/tmp/exports/assets/${link}`)
    expect(fileApi.write.mock.calls[0][1]).toBeInstanceOf(Uint8Array)
  })

  it('falls back to warning when an asset write fails but keeps the .md (folder)', async () => {
    chooseImageMode.mockResolvedValue('folder')
    fileApi.save.mockResolvedValue('/tmp/x/a.md')
    fileApi.write.mockRejectedValueOnce(new Error('disk full'))

    await exportMessageAsMarkdown(imageMessage(), false, undefined, chooseImageMode)

    expect(fileApi.save).toHaveBeenCalledTimes(1)
    // real i18n: the interpolated zh-cn message proves the key exists and renders
    expect(toast.warning).toHaveBeenCalledWith('1 张图片写入失败')
  })

  it('warns but keeps the export when creating the assets folder fails (folder)', async () => {
    chooseImageMode.mockResolvedValue('folder')
    fileApi.save.mockResolvedValue('/tmp/x/a.md')
    fileApi.mkdir.mockRejectedValueOnce(new Error('permission denied'))

    await exportMessageAsMarkdown(imageMessage(), false, undefined, chooseImageMode)

    // the .md stays; the mkdir failure degrades to the write-failed warning
    expect(fileApi.save).toHaveBeenCalledTimes(1)
    expect(fileApi.write).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith('1 张图片写入失败')
  })

  it('toasts the skipped-image count and still completes the export (embed, oversize)', async () => {
    const oversized = `data:image/png;base64,${'A'.repeat(Math.ceil((10 * 1024 * 1024 + 1) / 3) * 4)}`
    const message = view([{ type: 'text', text: 'huge picture' }, imageFilePart(oversized, 'entry-big')])
    chooseImageMode.mockResolvedValue('embed')
    fileApi.save.mockResolvedValue('/tmp/x/a.md')

    await exportMessageAsMarkdown(message, false, undefined, chooseImageMode)

    expect(toast.warning).toHaveBeenCalledWith('已跳过 1 张图片（超过 10 MiB 或无法读取）')
    expect(fileApi.save).toHaveBeenCalledTimes(1)
    expect(fileApi.save.mock.calls[0][1]).toContain('huge picture')
    expect(fileApi.save.mock.calls[0][1]).not.toContain('data:image/png')
  })

  it('writes .md and assets into the preconfigured directory (folder, preconf branch)', async () => {
    await preferenceService.set('data.export.markdown.path', '/tmp/preconf')
    try {
      chooseImageMode.mockResolvedValue('folder')
      ipcApiRequest.mockResolvedValue({ ok: true, data: { content: new Uint8Array([1]), mime: 'image/png' } })

      await exportMessageAsMarkdown(imageMessage(), false, undefined, chooseImageMode)

      expect(fileApi.save).not.toHaveBeenCalled()
      expect(fileApi.mkdir).toHaveBeenCalledWith('/tmp/preconf/assets')
      const paths = fileApi.write.mock.calls.map((call: unknown[]) => call[0] as string)
      expect(paths.some((p) => p.startsWith('/tmp/preconf/') && p.endsWith('.md'))).toBe(true)
      expect(paths.some((p) => p.startsWith('/tmp/preconf/assets/img-'))).toBe(true)
    } finally {
      await preferenceService.set('data.export.markdown.path', null)
    }
  })
})

describe('exportTopicAsMarkdown image pipeline', () => {
  const topic = { id: 't1', name: 'My Topic' } as Parameters<typeof exportTopicAsMarkdown>[0]

  beforeEach(() => {
    // Stable instances: the entry calls getTopicMessages for collection, and
    // topicToMarkdown re-reads the same rows — ids must match across both calls.
    const messages = [
      view([{ type: 'text', text: 'user asks' }, imageFilePart(PNG_1PX, 'entry-a')], 'user'),
      view([{ type: 'text', text: 'assistant answers' }], 'assistant')
    ]
    vi.mocked(getTopicMessages).mockResolvedValue(messages)
  })

  it('embeds images from the topic messages when the user picks embed', async () => {
    chooseImageMode.mockResolvedValue('embed')
    fileApi.save.mockResolvedValue('/tmp/x/t.md')

    await exportTopicAsMarkdown(topic, false, undefined, chooseImageMode)

    expect(chooseImageMode).toHaveBeenCalledWith(1)
    const markdown = fileApi.save.mock.calls[0][1] as string
    expect(markdown).toContain(`data:image/png;base64,${PNG_1PX_RAW}`)
    expect(markdown).toContain('assistant answers')
  })

  it('aborts the topic export when the mode choice is cancelled', async () => {
    chooseImageMode.mockResolvedValue(null)

    await exportTopicAsMarkdown(topic, false, undefined, chooseImageMode)

    expect(fileApi.save).not.toHaveBeenCalled()
    expect(fileApi.write).not.toHaveBeenCalled()
  })
})
