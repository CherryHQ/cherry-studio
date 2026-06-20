import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { CherryMessagePart, Message } from '@shared/data/types/message'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Mute the logger — we assert on return values, not log noise.
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

const { readMock } = vi.hoisted(() => ({
  readMock: vi.fn<(id: string, options: { encoding: 'base64' }) => Promise<{ content: string; mime: string }>>()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  // FileManager isn't in the default mock ServiceOverrides type — cast the
  // overrides object to bypass the closed key set so we can stub it for
  // the fileEntryId resolution path.
  const overrides = { FileManager: { read: readMock } } as Parameters<typeof mockApplicationFactory>[0]
  return mockApplicationFactory(overrides)
})

import { prepareUIMessages, toCherryUIMessage } from '../messageConverter'

function makeMessage(overrides: Partial<Message> & { parts?: CherryMessagePart[] } = {}): Message {
  const { parts, ...rest } = overrides
  return {
    id: 'msg-1',
    topicId: 't-1',
    parentId: null,
    role: 'user',
    data: { parts: parts ?? [] },
    status: 'success',
    siblingsGroupId: 0,
    modelId: null,
    ...rest
  } as Message
}

describe('toCherryUIMessage', () => {
  it('packages data.parts as UIMessage with the same id + role', () => {
    const ui = toCherryUIMessage(
      makeMessage({
        role: 'assistant',
        parts: [{ type: 'text', text: 'hi' }] as CherryMessagePart[]
      })
    )
    expect(ui.id).toBe('msg-1')
    expect(ui.role).toBe('assistant')
    expect(ui.parts).toEqual([{ type: 'text', text: 'hi' }])
  })

  it('defaults to empty parts when data.parts is missing', () => {
    const ui = toCherryUIMessage({ ...makeMessage(), data: {} } as Message)
    expect(ui.parts).toEqual([])
  })
})

describe('prepareUIMessages — file:// URL resolution', () => {
  let tmpDir: string
  let imgPath: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-msg-'))
    imgPath = path.join(tmpDir, 'pixel.png')
    // 1x1 PNG (smallest valid)
    const png = Buffer.from(
      '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA636400' +
        '01000000050001A7DFAA680000000049454E44AE426082',
      'hex'
    )
    await fs.writeFile(imgPath, png)
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('rewrites file:// URL file parts to base64 data URLs', async () => {
    const msg = makeMessage({
      parts: [
        { type: 'file', url: `file://${imgPath}`, mediaType: 'image/png', filename: 'pixel.png' }
      ] as CherryMessagePart[]
    })
    const [ui] = await prepareUIMessages([msg])
    const filePart = ui.parts[0] as { type: 'file'; url: string }
    expect(filePart.url.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('leaves data: URLs untouched', async () => {
    const dataUrl = 'data:image/png;base64,AAA'
    const msg = makeMessage({
      parts: [{ type: 'file', url: dataUrl, mediaType: 'image/png' }] as CherryMessagePart[]
    })
    const [ui] = await prepareUIMessages([msg])
    expect((ui.parts[0] as { url: string }).url).toBe(dataUrl)
  })

  it('leaves http(s) URLs untouched', async () => {
    const httpUrl = 'https://example.com/a.png'
    const msg = makeMessage({
      parts: [{ type: 'file', url: httpUrl, mediaType: 'image/png' }] as CherryMessagePart[]
    })
    const [ui] = await prepareUIMessages([msg])
    expect((ui.parts[0] as { url: string }).url).toBe(httpUrl)
  })

  it('drops file parts whose file:// URL cannot be read', async () => {
    const msg = makeMessage({
      parts: [
        { type: 'text', text: 'keep me' },
        { type: 'file', url: `file://${path.join(tmpDir, 'does-not-exist.png')}`, mediaType: 'image/png' }
      ] as CherryMessagePart[]
    })
    const [ui] = await prepareUIMessages([msg])
    expect(ui.parts).toHaveLength(1)
    expect(ui.parts[0]).toMatchObject({ type: 'text', text: 'keep me' })
  })

  it('normalizes a bare-extension mediaType (.png) to a real MIME from the on-disk file', async () => {
    const msg = makeMessage({
      parts: [
        { type: 'file', url: `file://${imgPath}`, mediaType: '.png', filename: 'pixel.png' }
      ] as CherryMessagePart[]
    })
    const [ui] = await prepareUIMessages([msg])
    const filePart = ui.parts[0] as { type: 'file'; url: string; mediaType: string }
    expect(filePart.mediaType).toBe('image/png')
    expect(filePart.url.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('upgrades a generic application/octet-stream mediaType to a real MIME from the on-disk file', async () => {
    const msg = makeMessage({
      parts: [
        { type: 'file', url: `file://${imgPath}`, mediaType: 'application/octet-stream', filename: 'pixel.png' }
      ] as CherryMessagePart[]
    })
    const [ui] = await prepareUIMessages([msg])
    const filePart = ui.parts[0] as { type: 'file'; url: string; mediaType: string }
    expect(filePart.mediaType).toBe('image/png')
    expect(filePart.url.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('leaves non-file parts unchanged', async () => {
    const msg = makeMessage({
      parts: [
        { type: 'text', text: 'hello' },
        { type: 'reasoning', text: 'thinking...' }
      ] as CherryMessagePart[]
    })
    const [ui] = await prepareUIMessages([msg])
    expect(ui.parts).toHaveLength(2)
    expect(ui.parts[0]).toMatchObject({ type: 'text', text: 'hello' })
    expect(ui.parts[1]).toMatchObject({ type: 'reasoning', text: 'thinking...' })
  })
})

describe('prepareUIMessages — fileEntryId resolution', () => {
  let tmpDir: string
  let imgPath: string

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cherry-msg-fid-'))
    imgPath = path.join(tmpDir, 'pixel.png')
    const png = Buffer.from(
      '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D4944415478DA636400' +
        '01000000050001A7DFAA680000000049454E44AE426082',
      'hex'
    )
    await fs.writeFile(imgPath, png)
  })

  afterAll(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('resolves a FileUIPart via FileManager.read and applies its MIME (overriding a bad hint)', async () => {
    readMock.mockReset()
    readMock.mockResolvedValueOnce({ content: 'QUJD', mime: 'image/png' })
    const msg = makeMessage({
      parts: [
        {
          type: 'file',
          mediaType: '.png', // bad hint — FileManager.read's on-disk MIME wins
          filename: 'pixel.png',
          url: '',
          providerMetadata: { cherry: { fileEntryId: 'entry-1' } }
        }
      ] as CherryMessagePart[]
    })
    const [ui] = await prepareUIMessages([msg])
    const filePart = ui.parts[0] as { type: 'file'; url: string; mediaType: string }
    expect(filePart.mediaType).toBe('image/png')
    expect(filePart.url).toBe('data:image/png;base64,QUJD')
    expect(readMock).toHaveBeenCalledWith('entry-1', { encoding: 'base64' })
  })

  it('falls back to url when fileEntryId resolution throws', async () => {
    readMock.mockReset()
    readMock.mockRejectedValueOnce(new Error('entry not found'))
    const msg = makeMessage({
      parts: [
        {
          type: 'file',
          mediaType: 'image/png',
          url: `file://${imgPath}`,
          providerMetadata: { cherry: { fileEntryId: 'entry-gone' } }
        }
      ] as CherryMessagePart[]
    })
    const [ui] = await prepareUIMessages([msg])
    const filePart = ui.parts[0] as { type: 'file'; url: string }
    expect(filePart.url.startsWith('data:image/png;base64,')).toBe(true)
    expect(readMock).toHaveBeenCalledWith('entry-gone', { encoding: 'base64' })
  })

  it('drops the part when both fileEntryId and url are unreadable', async () => {
    readMock.mockReset()
    readMock.mockRejectedValueOnce(new Error('entry not found'))
    const msg = makeMessage({
      parts: [
        { type: 'text', text: 'keep me' },
        {
          type: 'file',
          mediaType: 'image/png',
          url: `file://${path.join(tmpDir, 'nope.png')}`,
          providerMetadata: { cherry: { fileEntryId: 'entry-gone' } }
        }
      ] as CherryMessagePart[]
    })
    const [ui] = await prepareUIMessages([msg])
    expect(ui.parts).toHaveLength(1)
    expect(ui.parts[0]).toMatchObject({ type: 'text', text: 'keep me' })
  })

  it('drops the part when fileEntryId is unresolvable and there is no file:// url to rescue', async () => {
    readMock.mockReset()
    readMock.mockRejectedValueOnce(new Error('entry not found'))
    const msg = makeMessage({
      parts: [
        { type: 'text', text: 'keep me' },
        {
          type: 'file',
          mediaType: 'image/png',
          url: '',
          providerMetadata: { cherry: { fileEntryId: 'entry-gone' } }
        }
      ] as CherryMessagePart[]
    })
    const [ui] = await prepareUIMessages([msg])
    expect(ui.parts).toHaveLength(1)
    expect(ui.parts[0]).toMatchObject({ type: 'text', text: 'keep me' })
    expect(readMock).toHaveBeenCalledWith('entry-gone', { encoding: 'base64' })
  })

  it('does not call FileManager when the part has only a url (no cherry meta)', async () => {
    readMock.mockReset()
    const msg = makeMessage({
      parts: [{ type: 'file', url: `file://${imgPath}`, mediaType: 'image/png' }] as CherryMessagePart[]
    })
    await prepareUIMessages([msg])
    expect(readMock).not.toHaveBeenCalled()
  })
})
