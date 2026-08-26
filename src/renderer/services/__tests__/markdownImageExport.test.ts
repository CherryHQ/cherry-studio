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
import {
  collectExportableImages,
  hydrateDeferredImageOutputs,
  serializeMessagesWithImages,
  writeImageAssets
} from '../markdownImageExport'

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

/** MCP CallToolResult shape: inline base64 payloads instead of FileEntry references. */
function generateImageInlinePart(images: Array<{ data: string; mimeType?: string }>, state = 'output-available') {
  return {
    type: 'tool-generate_image',
    toolCallId: 'call-1',
    state,
    input: {},
    output: {
      content: images.map((img) => ({ type: 'image', data: img.data, mimeType: img.mimeType }))
    }
  }
}

/** Agent-session transport shape: an output over the limit arrives as a deferred ref. */
function generateImageDeferredPart(toolCallId = 'call-1') {
  return {
    type: 'tool-mcp__cherry-tools__generate_image',
    toolCallId,
    state: 'output-available',
    input: {},
    output: {
      $deferredToolResult: { topicId: 'agent-session:s1', messageId: 'm1', toolCallId }
    }
  }
}

// --- window.api stub (file save/write/mkdir + ipc bridge) ---

const fileApi: Record<string, ReturnType<typeof vi.fn>> = {
  save: vi.fn(),
  write: vi.fn(),
  mkdir: vi.fn(),
  read: vi.fn(),
  writeWithId: vi.fn()
}
const ipcApiRequest = vi.fn()

/** One-shot mock of `file.batch_get_physical_paths`; a null path is a dangling entry. */
function mockPhysicalPaths(entries: Record<string, string | null>) {
  ipcApiRequest.mockResolvedValueOnce({ ok: true, data: entries })
}

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
  it("resolves a fileEntryId part to the entry's current physical path", async () => {
    mockPhysicalPaths({ 'entry-a': '/data/Files/moved-a.png' })
    const message = view([{ type: 'text', text: 'look at this' }, imageFilePart('file:///data/Files/a.png', 'entry-a')])

    const { refs, unresolvedCount } = await collectExportableImages([message])

    expect(unresolvedCount).toBe(0)
    expect(ipcApiRequest).toHaveBeenCalledWith('file.batch_get_physical_paths', { ids: ['entry-a'] })
    expect(refs).toEqual([
      {
        key: 'entry-a',
        url: 'file:///data/Files/moved-a.png',
        filename: 'photo.png',
        mime: 'image/png'
      }
    ])
  })

  it('falls back to the stored url when the entry resolves to no physical path (dangling)', async () => {
    mockPhysicalPaths({ 'entry-a': null })
    const message = view([imageFilePart('file:///data/Files/a.png', 'entry-a')])

    const { refs, unresolvedCount } = await collectExportableImages([message])

    expect(unresolvedCount).toBe(0)
    expect(refs).toEqual([
      { key: 'entry-a', url: 'file:///data/Files/a.png', filename: 'photo.png', mime: 'image/png' }
    ])
  })

  it('ignores non-image file parts', async () => {
    const message = view([{ type: 'file', mediaType: 'application/pdf', url: 'file:///data/Files/a.pdf' }])

    const { refs } = await collectExportableImages([message])

    expect(refs).toEqual([])
  })

  it('resolves generate_image output ids to file urls', async () => {
    mockPhysicalPaths({ 'gen-1': '/data/Files/gen-1.png' })
    const message = view([generateImagePart([{ id: 'gen-1', name: 'painting.png' }])], 'assistant')

    const { refs } = await collectExportableImages([message])
    expect(ipcApiRequest).toHaveBeenCalledWith('file.batch_get_physical_paths', { ids: ['gen-1'] })

    expect(refs).toEqual([
      {
        key: 'gen-1',
        url: 'file:///data/Files/gen-1.png',
        filename: 'painting.png'
      }
    ])
  })

  it('drops an unresolvable generate_image entry, counts it, and keeps the rest', async () => {
    mockPhysicalPaths({ gone: null })
    mockPhysicalPaths({ 'gen-2': '/data/Files/gen-2.png' })
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
    expect(ipcApiRequest).not.toHaveBeenCalled()
  })

  it('dedupes the same image referenced from two messages', async () => {
    const messages = [view([imageFilePart(PNG_1PX, 'entry-a')]), view([imageFilePart(PNG_1PX, 'entry-a')])]

    const { refs } = await collectExportableImages(messages)

    expect(refs).toHaveLength(1)
  })

  it('falls back to the part url as dedup key when no fileEntryId exists', async () => {
    // No cherry meta on these parts — the url itself must dedupe identical attachments
    // and stay distinct from a different image sharing no entry id either.
    const sameUrl = [imageFilePart('file:///data/Files/a.png'), imageFilePart('file:///data/Files/a.png')]
    const messages = [...sameUrl.map((p) => view([p])), view([imageFilePart('file:///data/Files/b.png')])]

    const { refs } = await collectExportableImages(messages)

    expect(refs.map((r) => r.key)).toEqual(['file:///data/Files/a.png', 'file:///data/Files/b.png'])
  })

  it('recognizes the mcp-prefixed agent generate_image tool name', async () => {
    mockPhysicalPaths({ 'gen-9': '/data/Files/gen-9.png' })
    const part = {
      ...generateImagePart([{ id: 'gen-9', name: 'a.png' }]),
      type: 'tool-mcp__cherry-tools__generate_image'
    }
    const message = view([part], 'assistant')

    const { refs } = await collectExportableImages([message])

    expect(refs).toEqual([{ key: 'gen-9', url: 'file:///data/Files/gen-9.png', filename: 'a.png' }])
  })

  it('collects MCP inline generate_image payloads as data URLs (render parity)', async () => {
    const raw = PNG_1PX.slice('data:image/png;base64,'.length)
    const message = view(
      [generateImageInlinePart([{ data: raw }]), generateImageInlinePart([{ data: raw, mimeType: 'image/png' }])],
      'assistant'
    )

    const { refs, unresolvedCount } = await collectExportableImages([message])

    expect(unresolvedCount).toBe(0)
    // identical inline payloads collapse to one data-URL ref; no FileEntry lookup happens
    expect(refs).toEqual([{ key: PNG_1PX, url: PNG_1PX, filename: undefined, mime: 'image/png' }])
    expect(ipcApiRequest).not.toHaveBeenCalled()
  })

  it('collects MCP inline payloads that keep the {content} envelope (mcp metadata)', async () => {
    // With mcp metadata present, extractOutputMetadata keeps the {content: [...]}
    // envelope instead of unwrapping to the array — the envelope branch must hit too.
    const part = {
      ...generateImageInlinePart([{ data: PNG_1PX_RAW, mimeType: 'image/png' }]),
      output: {
        content: [{ type: 'image', data: PNG_1PX_RAW, mimeType: 'image/png' }],
        metadata: { type: 'mcp', name: 'generate_image' }
      }
    }
    const message = view([part], 'assistant')

    const { refs, unresolvedCount } = await collectExportableImages([message])

    expect(unresolvedCount).toBe(0)
    expect(refs).toEqual([{ key: PNG_1PX, url: PNG_1PX, filename: undefined, mime: 'image/png' }])
  })

  it('does not export an errored MCP inline result as an image', async () => {
    const part = {
      ...generateImageInlinePart([{ data: PNG_1PX_RAW }]),
      output: {
        content: [{ type: 'image', data: PNG_1PX_RAW, mimeType: 'image/png' }],
        isError: true,
        metadata: { type: 'mcp', name: 'generate_image' }
      }
    }
    const message = view([part], 'assistant')

    const { refs, unresolvedCount } = await collectExportableImages([message])

    expect(refs).toEqual([])
    expect(unresolvedCount).toBe(0)
  })

  it('does not export an errored envelope whose flag the unwrap would drop (no metadata)', async () => {
    // Without mcp metadata extractOutputMetadata unwraps to the bare content array,
    // so the isError flag only survives a check made before the unwrap.
    const part = {
      ...generateImageInlinePart([{ data: PNG_1PX_RAW }]),
      output: {
        content: [{ type: 'image', data: PNG_1PX_RAW, mimeType: 'image/png' }],
        isError: true
      }
    }
    const message = view([part], 'assistant')

    const { refs, unresolvedCount } = await collectExportableImages([message])

    expect(refs).toEqual([])
    expect(unresolvedCount).toBe(0)
  })
})

// --- hydrateDeferredImageOutputs ---

describe('hydrateDeferredImageOutputs', () => {
  it('resolves a deferred generate_image ref into the stored output', async () => {
    ipcApiRequest.mockResolvedValueOnce({
      ok: true,
      data: { found: true, output: { content: [{ type: 'image', data: PNG_1PX_RAW, mimeType: 'image/png' }] } }
    })
    const message = view([generateImageDeferredPart()], 'assistant')

    const { messages, unresolvedCount } = await hydrateDeferredImageOutputs([message])

    expect(unresolvedCount).toBe(0)
    expect(ipcApiRequest).toHaveBeenCalledWith('ai.tool.get_result', {
      topicId: 'agent-session:s1',
      messageId: 'm1',
      toolCallId: 'call-1'
    })
    expect(messages[0].parts?.[0]).toHaveProperty('output.content', [
      { type: 'image', data: PNG_1PX_RAW, mimeType: 'image/png' }
    ])
  })

  it('counts an unresolvable ref, keeps the marker part, and leaves other messages untouched', async () => {
    ipcApiRequest.mockResolvedValueOnce({ ok: true, data: { found: false } })
    const deferred = view([generateImageDeferredPart()], 'assistant')
    const plain = view([{ type: 'text', text: 'no tools here' }])

    const { messages, unresolvedCount } = await hydrateDeferredImageOutputs([deferred, plain])

    expect(unresolvedCount).toBe(1)
    // the same array reference survives when nothing resolved
    expect(messages[0]).toBe(deferred)
    expect(messages[1]).toBe(plain)
  })

  it('does not fetch deferred outputs of other tools', async () => {
    const part = {
      type: 'tool-mcp__cherry-tools__web_search',
      toolCallId: 'call-2',
      state: 'output-available',
      input: {},
      output: { $deferredToolResult: { topicId: 'agent-session:s1', messageId: 'm1', toolCallId: 'call-2' } }
    }
    const message = view([part], 'assistant')

    const { messages, unresolvedCount } = await hydrateDeferredImageOutputs([message])

    expect(ipcApiRequest).not.toHaveBeenCalled()
    expect(unresolvedCount).toBe(0)
    expect(messages[0]).toBe(message)
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

  it('skips an HTTPS image whose response is not ok instead of exporting the error page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>Not Found</html>', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const message = view([imageFilePart('https://example.com/gone.png', 'entry-http')])
      const { refs } = await collectExportableImages([message])

      const { overrides, skippedCount } = await serializeMessagesWithImages([message], 'embed', refs)

      expect(skippedCount).toBe(1)
      expect(overrides.has(message.id)).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
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

  it('maps an SVG attachment to a .svg asset name from its mime type (folder)', async () => {
    // extensionless filename: the .svg extension must come from the mime map, not the name
    const message = view([imageFilePart('file:///data/Files/icon', 'entry-svg', 'icon', 'image/svg+xml')])
    const { refs } = await collectExportableImages([message])

    const { pendingWrites } = await serializeMessagesWithImages([message], 'folder', refs)

    expect(pendingWrites[0].fileName).toMatch(/^img-[a-z0-9-]+\.svg$/)
  })

  it('allocates a distinct asset name per image so none overwrites another (folder)', async () => {
    const message = view([imageFilePart(PNG_1PX, 'entry-a'), imageFilePart(GIF_1PX, 'entry-b', 'anim.gif')])
    const { refs } = await collectExportableImages([message])

    const { pendingWrites } = await serializeMessagesWithImages([message], 'folder', refs)

    const names = pendingWrites.map((write) => write.fileName)
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
  })

  it('still allocates distinct assets when images share filename and MIME type (folder)', async () => {
    const PNG_1PX_RAW_B = PNG_1PX_RAW.slice(0, -2) + 'gg'
    const PNG_1PX_B = `data:image/png;base64,${PNG_1PX_RAW_B}`
    const message = view([
      imageFilePart(PNG_1PX, 'entry-a', 'photo.png'),
      imageFilePart(PNG_1PX_B, 'entry-b', 'photo.png')
    ])
    const { refs } = await collectExportableImages([message])

    const { pendingWrites } = await serializeMessagesWithImages([message], 'folder', refs)

    expect(refs).toHaveLength(2)
    const names = pendingWrites.map((write) => write.fileName)
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)
  })

  it('reuses one asset per FileEntry across messages (folder)', async () => {
    const first = view([{ type: 'text', text: 'first' }, imageFilePart(PNG_1PX, 'shared-entry')])
    const second = view([{ type: 'text', text: 'second' }, imageFilePart(PNG_1PX, 'shared-entry')])
    const { refs } = await collectExportableImages([first, second])

    const { overrides, pendingWrites } = await serializeMessagesWithImages([first, second], 'folder', refs)

    expect(refs).toHaveLength(1)
    expect(pendingWrites).toHaveLength(1)
    const link = overrides.get(first.id)!.match(/\(assets\/(img-[a-z0-9-]+\.png)\)/)![1]
    expect(overrides.get(second.id)).toContain(`(assets/${link})`)
  })

  it('serializes generate_image outputs in both modes (folder)', async () => {
    mockPhysicalPaths({ 'gen-1': '/data/Files/gen-1.png' })
    ipcApiRequest.mockResolvedValue({ ok: true, data: { content: new Uint8Array([1, 2, 3]), mime: 'image/png' } })
    const message = view([generateImagePart([{ id: 'gen-1', name: 'painting.png' }])], 'assistant')
    const { refs } = await collectExportableImages([message])

    const folder = await serializeMessagesWithImages([message], 'folder', refs)
    expect(folder.overrides.get(message.id)).toMatch(/!\[painting\.png\]\(assets\/img-[a-z0-9-]+\.png\)/)

    const embed = await serializeMessagesWithImages([message], 'embed', refs)
    expect(embed.overrides.get(message.id)).toContain('![painting.png](data:image/png;base64,')
  })

  it('serializes MCP inline generate_image payloads in both modes', async () => {
    const message = view([generateImageInlinePart([{ data: PNG_1PX_RAW }])], 'assistant')
    const { refs } = await collectExportableImages([message])

    const embed = await serializeMessagesWithImages([message], 'embed', refs)
    expect(embed.overrides.get(message.id)).toContain(`![image](data:image/png;base64,${PNG_1PX_RAW})`)

    const folder = await serializeMessagesWithImages([message], 'folder', refs)
    expect(folder.overrides.get(message.id)).toMatch(/!\[image\]\(assets\/img-[a-z0-9-]+\.png\)/)
    expect(folder.pendingWrites).toHaveLength(1)
    expect(folder.pendingWrites[0].ref.url).toBe(PNG_1PX)
  })

  it('leaves messages without images unoverridden', async () => {
    const withImage = view([{ type: 'text', text: 'has image' }, imageFilePart(PNG_1PX, 'entry-a')])
    const textOnly = view([{ type: 'text', text: 'plain message' }])
    const { refs } = await collectExportableImages([withImage, textOnly])

    const { overrides } = await serializeMessagesWithImages([withImage, textOnly], 'embed', refs)

    expect(overrides.has(textOnly.id)).toBe(false)
    expect(overrides.has(withImage.id)).toBe(true)
  })

  it('rewrites composer skill tokens in the override text like the plain export path', async () => {
    const message = view(
      [
        {
          type: 'text',
          text: 'Use the find-skills skill. **hello**',
          providerMetadata: {
            cherry: {
              composer: {
                version: 1,
                tokens: [
                  {
                    id: 'skill:find-skills',
                    kind: 'skill',
                    label: 'find-skills',
                    index: 0,
                    textOffset: 0,
                    promptText: 'Use the find-skills skill.'
                  }
                ]
              }
            }
          }
        },
        imageFilePart(PNG_1PX, 'entry-a')
      ],
      'user'
    )
    const { refs } = await collectExportableImages([message])

    const { overrides } = await serializeMessagesWithImages([message], 'folder', refs)

    const content = overrides.get(message.id)!
    expect(content).toContain('/find-skills/ **hello**')
    expect(content).not.toContain('Use the find-skills skill.')
  })
})

// --- writeImageAssets ---

describe('writeImageAssets', () => {
  it('creates assets/ and writes each image beside the markdown', async () => {
    ipcApiRequest.mockResolvedValue({ ok: true, data: { content: new Uint8Array([1, 2, 3]), mime: 'image/png' } })
    const pendingWrites = [
      {
        fileName: 'img-a.png',
        ref: { key: 'k', url: 'file:///data/Files/a.png', mime: 'image/png' } as const
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
    const ref = { key: 'k', url: 'file:///data/Files/a.png', mime: 'image/png' } as const

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
    const ref = { key: 'k', url: 'file:///data/Files/a.png', mime: 'image/png' } as const

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
    mockPhysicalPaths({ gone: null })
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

  it('carries a deferred agent-session generate_image image once its ref is resolved (embed)', async () => {
    // Agent sessions read with deferToolOutputs, so an inline image over the transport
    // limit reaches the export as $deferredToolResult — hydrating it must surface the
    // image instead of silently taking the text-only path.
    fileApi.save.mockResolvedValue('/tmp/x/a.md')
    ipcApiRequest.mockResolvedValueOnce({
      ok: true,
      data: { found: true, output: { content: [{ type: 'image', data: PNG_1PX_RAW, mimeType: 'image/png' }] } }
    })
    chooseImageMode.mockResolvedValue('embed')
    const message = view([{ type: 'text', text: 'generated this' }, generateImageDeferredPart()], 'assistant')

    await exportMessageAsMarkdown(message, false, undefined, chooseImageMode)

    expect(chooseImageMode).toHaveBeenCalledWith(1)
    expect(fileApi.save.mock.calls[0][1]).toContain(`data:image/png;base64,${PNG_1PX_RAW}`)
  })

  it('exports text-only with a warning when a deferred output can no longer be resolved', async () => {
    fileApi.save.mockResolvedValue('/tmp/x/a.md')
    ipcApiRequest.mockResolvedValueOnce({ ok: true, data: { found: false } })
    const message = view([generateImageDeferredPart()], 'assistant')

    await exportMessageAsMarkdown(message, false, undefined, chooseImageMode)

    expect(chooseImageMode).not.toHaveBeenCalled()
    expect(toast.warning).toHaveBeenCalledWith('已跳过 1 张图片（无法获取或读取）')
    expect(fileApi.save).toHaveBeenCalledTimes(1)
    expect(fileApi.save.mock.calls[0][1]).not.toContain('data:image')
  })

  it('toasts the combined skip count when unresolved and exported images coexist', async () => {
    fileApi.save.mockResolvedValue('/tmp/x/a.md')
    // one dead generate_image entry (collection failure) + one healthy attachment
    // (no entryId, so the healthy part never touches the batch route)
    mockPhysicalPaths({ gone: null })
    const message = view([imageFilePart(PNG_1PX), generateImagePart([{ id: 'gone', name: 'painting.png' }])])
    chooseImageMode.mockResolvedValue('embed')

    await exportMessageAsMarkdown(message, false, undefined, chooseImageMode)

    expect(chooseImageMode).toHaveBeenCalledWith(1)
    // embed mode surfaces collection failures with the embed-flavored copy
    expect(toast.warning).toHaveBeenCalledWith('已跳过 1 张图片（超过 10 MiB 或无法读取）')
    expect(fileApi.save.mock.calls[0][1]).toContain(`data:image/png;base64,${PNG_1PX_RAW}`)
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

  it('aborts an image-bearing export when no chooser is injected (service called without UI context)', async () => {
    await exportMessageAsMarkdown(imageMessage())

    expect(fileApi.save).not.toHaveBeenCalled()
    expect(fileApi.write).not.toHaveBeenCalled()
    expect(chooseImageMode).not.toHaveBeenCalled()
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

  it('derives the assets directory from root save paths (POSIX root and Windows drive root)', async () => {
    chooseImageMode.mockResolvedValue('folder')

    fileApi.save.mockResolvedValueOnce('/a.md')
    await exportMessageAsMarkdown(imageMessage(), false, undefined, chooseImageMode)
    expect(fileApi.mkdir).toHaveBeenCalledWith('/assets')

    // A bare drive letter is not a usable directory: 'C:\a.md' must keep its separator.
    fileApi.save.mockResolvedValueOnce('C:\\a.md')
    await exportMessageAsMarkdown(imageMessage(), false, undefined, chooseImageMode)
    expect(fileApi.mkdir).toHaveBeenCalledWith('C:\\assets')
  })

  it('writes asset bytes identical to the source image (folder, save dialog branch)', async () => {
    chooseImageMode.mockResolvedValue('folder')
    fileApi.save.mockResolvedValue('/tmp/x/a.md')

    await exportMessageAsMarkdown(imageMessage(), false, undefined, chooseImageMode)

    const written = fileApi.write.mock.calls[0][1] as Uint8Array
    const source = Uint8Array.from(atob(PNG_1PX_RAW), (c) => c.charCodeAt(0))
    expect(Array.from(written)).toEqual(Array.from(source))
  })

  it('skips asset writing entirely when the save dialog is cancelled after picking folder mode', async () => {
    chooseImageMode.mockResolvedValue('folder')
    fileApi.save.mockResolvedValue(null)

    await exportMessageAsMarkdown(imageMessage(), false, undefined, chooseImageMode)

    expect(fileApi.save).toHaveBeenCalledTimes(1)
    expect(fileApi.mkdir).not.toHaveBeenCalled()
    expect(fileApi.write).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
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
      const mdPath = paths.find((p) => p.startsWith('/tmp/preconf/') && p.endsWith('.md'))
      const assetPath = paths.find((p) => p.startsWith('/tmp/preconf/assets/img-'))
      expect(mdPath).toBeDefined()
      expect(assetPath).toBeDefined()
      // the markdown body must link to the exact asset file that was written
      const markdown = fileApi.write.mock.calls.find((call: unknown[]) => call[0] === mdPath)![1] as string
      expect(markdown).toContain(`(assets/${assetPath!.split('/').pop()})`)
    } finally {
      await preferenceService.set('data.export.markdown.path', null)
    }
  })
})

describe('exportTopicAsMarkdown image pipeline', () => {
  const topic = { id: 't1', name: 'My Topic' } as Parameters<typeof exportTopicAsMarkdown>[0]

  beforeEach(() => {
    // Single snapshot for the whole export: collection and rendering must see
    // the same rows even if the topic changes while the mode dialog is open.
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

  it('renders from the collected snapshot even if the topic changes while the dialog is open', async () => {
    // First read (collection) returns the image message; any later read would
    // see a mutated topic. The export must stay consistent with the snapshot.
    const snapshot = [view([{ type: 'text', text: 'snapshot user text' }, imageFilePart(PNG_1PX, 'entry-a')], 'user')]
    const mutated = [view([{ type: 'text', text: 'MUTATED DURING DIALOG' }], 'user')]
    vi.mocked(getTopicMessages).mockReset()
    vi.mocked(getTopicMessages).mockResolvedValueOnce(snapshot).mockResolvedValue(mutated)
    chooseImageMode.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('embed'), 20)))
    fileApi.save.mockResolvedValue('/tmp/x/t.md')

    await exportTopicAsMarkdown(topic, false, undefined, chooseImageMode)

    const markdown = fileApi.save.mock.calls[0][1] as string
    expect(markdown).toContain('snapshot user text')
    expect(markdown).toContain(`data:image/png;base64,${PNG_1PX_RAW}`)
    expect(markdown).not.toContain('MUTATED DURING DIALOG')
  })

  it('aborts the topic export when the mode choice is cancelled', async () => {
    chooseImageMode.mockResolvedValue(null)

    await exportTopicAsMarkdown(topic, false, undefined, chooseImageMode)

    expect(fileApi.save).not.toHaveBeenCalled()
    expect(fileApi.write).not.toHaveBeenCalled()
  })
})
