import { readFile, writeFile } from 'node:fs/promises'

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
