import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readDeviceNotesPath, writeDeviceNotesPath } from '../deviceNotesPath'

async function freshSidecarFile(): Promise<string> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'notes-device-'))
  return join(dir, 'notes-device.json')
}

describe('readDeviceNotesPath', () => {
  it('returns null when the sidecar was never written', async () => {
    await expect(readDeviceNotesPath(await freshSidecarFile())).resolves.toBeNull()
  })

  it('returns null for corrupt content instead of throwing', async () => {
    const file = await freshSidecarFile()
    await fs.writeFile(file, '{not json', 'utf8')
    await expect(readDeviceNotesPath(file)).resolves.toBeNull()
  })

  it.each([{ path: 42 }, { path: '' }, {}, null, []] as unknown[])(
    'returns null for non-string payload %j instead of throwing',
    async (payload) => {
      const file = await freshSidecarFile()
      await fs.writeFile(file, JSON.stringify(payload), 'utf8')
      await expect(readDeviceNotesPath(file)).resolves.toBeNull()
    }
  )
})

describe('writeDeviceNotesPath / readDeviceNotesPath', () => {
  it('round-trips the stamped path', async () => {
    const file = await freshSidecarFile()
    await writeDeviceNotesPath(file, 'D:\\Notes')
    await expect(readDeviceNotesPath(file)).resolves.toBe('D:\\Notes')
  })

  it('overwrites a previous choice', async () => {
    const file = await freshSidecarFile()
    await writeDeviceNotesPath(file, 'D:\\Notes')
    await writeDeviceNotesPath(file, 'E:\\Notes')
    await expect(readDeviceNotesPath(file)).resolves.toBe('E:\\Notes')
  })
})
