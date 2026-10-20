import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type { FileUIPart } from '@shared/data/types/message'

const { readManaged } = vi.hoisted(() => ({ readManaged: vi.fn() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ FileManager: { read: readManaged } })
})

import { hasPiLocalImages, preparePiUserContent } from './piUserContent'

const message = (parts: AgentSessionMessageEntity['data']['parts']) =>
  ({ id: 'images', data: { parts } }) as AgentSessionMessageEntity
const image = (url: string, filename?: string): FileUIPart => ({ type: 'file', mediaType: 'image/jpeg', url, filename })
let directory: string
let paths: string[]
let bytes: Buffer[]
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pi-images-'))
  paths = ['red.jpg', 'blue.jpg'].map((name) => join(directory, name))
  bytes = await Promise.all(
    ['#ff0000', '#0000ff'].map((background) =>
      sharp({ create: { width: 8, height: 8, channels: 3, background } })
        .jpeg()
        .toBuffer()
    )
  )
  await Promise.all(paths.map((path, index) => writeFile(path, bytes[index])))
  readManaged.mockImplementation(async () => ({
    content: (await readFile(paths[0])).toString('base64'),
    mime: 'image/jpeg'
  }))
})
afterAll(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('Pi local image preparation', () => {
  it('preserves distinct JPEG bytes and order across managed entries and file URLs without mutating the message', async () => {
    const original = message([
      { type: 'text', text: 'Compare' },
      { ...image('', 'original-red.jpg'), providerMetadata: { cherry: { fileEntryId: 'managed-red' } } },
      image(pathToFileURL(paths[1]).href, 'original-blue.jpg'),
      {
        type: 'file',
        mediaType: 'text/plain',
        filename: 'notes.txt',
        url: pathToFileURL(join(directory, 'notes.txt')).href
      }
    ])
    const saved = structuredClone(original)
    const prepared = await preparePiUserContent(original)
    expect(bytes[0].equals(bytes[1])).toBe(false)
    expect(prepared.images).toHaveLength(2)
    expect(prepared.images.map((part) => Buffer.from(part.data, 'base64'))).toEqual(bytes)
    expect(prepared.images.map((part) => part.mimeType)).toEqual(['image/jpeg', 'image/jpeg'])
    expect(prepared.text).toContain('Compare')
    expect(prepared.text).toContain('notes.txt')
    expect(prepared.text).toContain(join(directory, 'notes.txt'))
    expect(prepared.text).not.toContain('original-red.jpg')
    expect(prepared.text).not.toContain('original-blue.jpg')
    expect(prepared.text).not.toContain(paths[1])
    expect(original).toEqual(saved)
  })

  it.each([
    ['missing.jpg', 'read'],
    ['empty.jpg', 'empty'],
    ['corrupt.jpg', 'processing']
  ])('rejects %s with the original filename and actionable detail', async (filename, reason) => {
    if (reason !== 'read') await writeFile(join(directory, filename), reason === 'empty' ? '' : 'not a JPEG')
    await expect(
      preparePiUserContent(message([image(pathToFileURL(join(directory, filename)).href, filename)]))
    ).rejects.toMatchObject({
      name: 'PiImagePreparationError',
      i18nKey: 'pi_image_preparation_failed',
      detailI18nKey: `pi_image_${reason}_failed`,
      detailI18nValues: { filename }
    })
  })

  it('rejects empty data, absent URLs and unavailable entries, recovering filenames or attachment numbers', async () => {
    await expect(
      preparePiUserContent(message([image('data:image/jpeg;base64,', 'empty-data.jpg')]))
    ).rejects.toMatchObject({
      detailI18nKey: 'pi_image_empty_failed',
      detailI18nValues: { filename: 'empty-data.jpg' }
    })
    await expect(preparePiUserContent(message([image('data:image/jpeg,', 'empty-data.jpg')]))).rejects.toMatchObject({
      detailI18nKey: 'pi_image_empty_failed',
      detailI18nValues: { filename: 'empty-data.jpg' }
    })
    await expect(preparePiUserContent(message([image('')]))).rejects.toMatchObject({
      detailI18nKey: 'pi_image_read_failed_unnamed',
      detailI18nValues: { filename: '1' }
    })
    readManaged.mockRejectedValueOnce(new Error('missing entry'))
    await expect(
      preparePiUserContent(message([{ ...image(''), providerMetadata: { cherry: { fileEntryId: 'opaque' } } }]))
    ).rejects.toMatchObject({ detailI18nValues: { filename: '1' } })
    await expect(
      preparePiUserContent(message([image(pathToFileURL(join(directory, 'recovered.jpg')).href)]))
    ).rejects.toMatchObject({ detailI18nValues: { filename: 'recovered.jpg' } })
  })

  it('rescues an unavailable entry from its local URL and leaves remote images alone', async () => {
    readManaged.mockRejectedValueOnce(new Error('missing entry'))
    const prepared = await preparePiUserContent(
      message([{ ...image(pathToFileURL(paths[0]).href), providerMetadata: { cherry: { fileEntryId: 'gone' } } }])
    )
    expect(Buffer.from(prepared.images[0].data, 'base64')).toEqual(bytes[0])
    const remote = message([image('https://example.com/photo.jpg')])
    expect(hasPiLocalImages(remote)).toBe(false)
    expect((await preparePiUserContent(remote)).images).toEqual([])
  })
})
