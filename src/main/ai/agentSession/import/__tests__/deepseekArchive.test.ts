import { createHash } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'

import { expect, it } from 'vitest'

import { openDeepseekArchive } from '../deepseekArchive'
import { archiveFixture, conversation } from './fixtures'

it('reads the source tree from the original ZIP without flattening it', async () => {
  const archive = await openDeepseekArchive(await archiveFixture())
  try {
    expect(await archive.load('sample')).toEqual(conversation())
  } finally {
    await archive.close()
  }
})
it('keeps the digest and parsed contents on the opened ZIP when its path is replaced', async () => {
  const file = await archiveFixture()
  const digest = createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
  const archive = await openDeepseekArchive(file)
  try {
    await rename(file, `${file}.original`)
    const replacement = conversation()
    replacement.title = 'Replacement contents'
    await writeFile(file, await readFile(await archiveFixture([], 3, replacement)))
    expect(archive.digest).toBe(digest)
    expect((await archive.load('sample')).title).toBe(conversation().title)
  } finally {
    await archive.close()
  }
})

it('rejects in-place changes to the opened ZIP before reading a conversation', async () => {
  const file = await archiveFixture()
  const archive = await openDeepseekArchive(file)
  try {
    await writeFile(file, 'replaced in place')
    await expect(archive.load('sample')).rejects.toThrow('Import file changed')
  } finally {
    await archive.close()
  }
})
it.each([
  ['manifest.json', '{}'],
  ['Manifest.json', '{}']
])('rejects duplicate and folded archive paths (%s)', async (name, value) => {
  await expect(openDeepseekArchive(await archiveFixture([[name, value]]))).rejects.toThrow()
})
it('rejects unsupported versions before creating data', async () => {
  await expect(openDeepseekArchive(await archiveFixture([], 4))).rejects.toThrow()
})

it('rejects link entries before reading any conversation', async () => {
  const file = await archiveFixture()
  const zip = await readFile(file)
  const header = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
  zip.writeUInt32LE(0xa1ff0000, header + 38)
  await writeFile(file, zip)
  await expect(openDeepseekArchive(file)).rejects.toThrow('Unsupported ZIP entry')
})
it('rejects oversized declared entries before inflating their payloads', async () => {
  const file = await archiveFixture([['large.txt', 'x'.repeat(33 * 1024 * 1024)]])
  await expect(openDeepseekArchive(file)).rejects.toThrow('extraction limits')
})

it.each([false, true])('validates repeated attachment IDs across messages (conflict: %s)', async (conflict) => {
  const source = conversation()
  const attachment = {
    id: 'shared',
    file_name: 'image.png',
    file_size: 1,
    export_path: 'files/one.png',
    is_image: true
  }
  source.messages[0].fragments.push({ type: 'FILE', files: [attachment] })
  source.messages[1].fragments.push({
    type: 'FILE',
    files: [{ ...attachment, export_path: conflict ? 'files/two.png' : attachment.export_path }]
  })
  const archive = await openDeepseekArchive(
    await archiveFixture(
      [
        ['files/one.png', 'a'],
        ['files/two.png', 'b']
      ],
      3,
      source
    )
  )
  try {
    if (conflict) await expect(archive.load('sample')).rejects.toThrow('Conflicting DeepSeek attachment ID')
    else expect(await archive.load('sample')).toEqual(source)
  } finally {
    await archive.close()
  }
})

it.each([
  ['files/image.png', 'Missing or invalid DeepSeek attachment'],
  ['files/directory/', 'Missing or invalid DeepSeek attachment'],
  ['../image.png', 'Unsafe ZIP path']
])('rejects an invalid attachment reference (%s)', async (exportPath, error) => {
  const source = conversation()
  source.messages[0].fragments.push({
    type: 'FILE',
    files: [{ id: 'image', file_name: 'image.png', file_size: 2, export_path: exportPath, is_image: true }]
  })
  const archive = await openDeepseekArchive(
    await archiveFixture(
      [
        ['files/image.png', 'x'],
        ['files/directory/', '']
      ],
      3,
      source
    )
  )
  try {
    await expect(archive.load('sample')).rejects.toThrow(error)
  } finally {
    await archive.close()
  }
})

it.each([
  ['files/missing.png', true],
  ['files/another.png', false],
  [null, false]
])('compares original descriptors for repeated unavailable attachments (%s)', async (path, sameAttachment) => {
  const source = conversation()
  const attachment = {
    id: 'shared',
    file_name: 'image.png',
    file_size: 65 * 1024 * 1024,
    export_path: 'files/missing.png',
    is_image: true
  }
  source.messages[0].fragments.push({ type: 'FILE', files: [attachment] })
  source.messages[1].fragments.push({ type: 'FILE', files: [{ ...attachment, export_path: path }] })
  const archive = await openDeepseekArchive(await archiveFixture([], 3, source))
  try {
    if (sameAttachment) {
      const result = await archive.load('sample')
      for (const message of result.messages.slice(0, 2)) {
        expect(message.fragments).toContainEqual({ type: 'FILE', files: [{ ...attachment, export_path: null }] })
      }
    } else {
      await expect(archive.load('sample')).rejects.toThrow('Conflicting DeepSeek attachment ID')
    }
  } finally {
    await archive.close()
  }
})
