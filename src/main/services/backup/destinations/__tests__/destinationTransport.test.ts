import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import fs from 'fs-extra'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BackupCancelledError } from '../../errors'
import { createTransport } from '../destinationTransport'

describe('local destination transport', () => {
  let root: string
  let dir: string
  let archive: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'cs-destination-transport-'))
    dir = path.join(root, 'backups')
    archive = path.join(root, 'staged.cherrybackup')
    await writeFile(archive, 'new bytes')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  })

  const transport = () => createTransport({ kind: 'local', dir, maxBackups: 0 })

  it('replaces an archive of the same name only once the whole copy has landed', async () => {
    await fs.ensureDir(dir)
    await writeFile(path.join(dir, 'a.cherrybackup'), 'previous bytes')
    vi.spyOn(fs, 'copy').mockRejectedValueOnce(new Error('EIO: usb stick unplugged'))

    await expect(transport().upload(archive, 'a.cherrybackup')).rejects.toThrow('usb stick unplugged')

    expect(await readFile(path.join(dir, 'a.cherrybackup'), 'utf8')).toBe('previous bytes')
    expect(await readdir(dir)).toEqual(['a.cherrybackup'])
  })

  it('leaves no partial file behind once the archive is in place', async () => {
    await transport().upload(archive, 'a.cherrybackup')

    expect(await readdir(dir)).toEqual(['a.cherrybackup'])
    expect(await readFile(path.join(dir, 'a.cherrybackup'), 'utf8')).toBe('new bytes')
  })

  it('does not write anything for an upload that was already cancelled', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(transport().upload(archive, 'a.cherrybackup', controller.signal)).rejects.toBeInstanceOf(
      BackupCancelledError
    )
    expect(await fs.pathExists(dir)).toBe(false)
  })
})
