import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import AdmZip from 'adm-zip'
import * as tar from 'tar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'

import { installBinaryAgent } from '../installBinary'

const exec = promisify(execFile)

describe('system binary installation', () => {
  let root: string
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "ACP 'system "))
    vi.mocked(application.getPath).mockImplementation((key, file) => {
      const directory = path.join(root, key === 'external.acp.bin' ? 'bin' : 'agents')
      return file ? path.join(directory, file) : directory
    })
  })
  afterEach(async () => {
    vi.unstubAllGlobals()
    await fs.rm(root, { recursive: true, force: true })
  })
  const serve = (body: Buffer) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(body)))
    )

  it('extracts a zip, verifies its digest and publishes a command without breaking sibling resources', async () => {
    const zip = new AdmZip()
    zip.addFile('bundle/agent', Buffer.from('#!/bin/sh\ncat "$(dirname "$0")/resource"\n'))
    zip.addFile('bundle/resource', Buffer.from('installed agent'))
    const body = zip.toBuffer()
    serve(body)
    const command = await installBinaryAgent(
      'example-agent',
      {
        manager: 'binary',
        version: '1.0.0',
        archive: 'https://example.com/agent.zip',
        cmd: './bundle/agent',
        sha256: createHash('sha256').update(body).digest('hex')
      },
      new AbortController().signal
    )
    expect(command).toBe(path.join(root, 'bin', process.platform === 'win32' ? 'example-agent.cmd' : 'example-agent'))
    if (process.platform !== 'win32') expect((await exec(command)).stdout).toBe('installed agent')
  })

  it('never publishes an executable for a checksum mismatch', async () => {
    serve(Buffer.from('wrong archive'))
    await expect(
      installBinaryAgent(
        'example-agent',
        {
          manager: 'binary',
          version: '1.0.0',
          archive: 'https://example.com/agent',
          cmd: './agent',
          sha256: '0'.repeat(64)
        },
        new AbortController().signal
      )
    ).rejects.toThrow('SHA-256')
    expect(await fs.readdir(path.join(root, 'agents'))).toEqual([])
  })

  it('does not overwrite an existing command', async () => {
    await fs.mkdir(path.join(root, 'bin'))
    const entry = path.join(root, 'bin', process.platform === 'win32' ? 'example-agent.cmd' : 'example-agent')
    await fs.writeFile(entry, 'existing command')
    serve(Buffer.from('binary contents'))
    await expect(
      installBinaryAgent(
        'example-agent',
        {
          manager: 'binary',
          version: '1.0.0',
          archive: 'https://example.com/agent',
          cmd: './agent'
        },
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await fs.readFile(entry, 'utf8')).toBe('existing command')
    expect(await fs.readdir(path.join(root, 'agents'))).toEqual([])
  })

  it('extracts tar.gz bundles and preserves nested executable paths', async () => {
    const source = path.join(root, 'source')
    await fs.mkdir(source)
    await fs.writeFile(path.join(source, 'agent'), '#!/bin/sh\necho ready\n')
    await fs.chmod(path.join(source, 'agent'), 0o755)
    const archive = path.join(root, 'archive.tgz')
    await tar.c({ cwd: source, file: archive, gzip: true }, ['agent'])
    serve(await fs.readFile(archive))
    const entry = await installBinaryAgent(
      'example-agent',
      {
        manager: 'binary',
        version: '1.0.0',
        archive: 'https://example.com/agent.tar.gz',
        cmd: './agent'
      },
      new AbortController().signal
    )
    if (process.platform !== 'win32') expect((await exec(entry)).stdout).toBe('ready\n')
  })

  it('extracts bzip2 tar distributions without requiring an external decompressor', async () => {
    serve(
      Buffer.from(
        'QlpoOTFBWSZTWRaa+J0AAHHbgMrQaALfgAAIfuHeMAgIIAB1EImgGgAM0geo2oJKgGgAAAAH3Uo2hAx1CEUc1MKY4YECGga82b5q+7s7tiExQCBLEFu1fiQSzMUHj3wazlxHJ8ZpGmC5/bEdXFG5ikH4u5IpwoSAtNfE6A==',
        'base64'
      )
    )
    const entry = await installBinaryAgent(
      'example-agent',
      {
        manager: 'binary',
        version: '1.0.0',
        archive: 'https://example.com/agent.tar.bz2',
        cmd: './agent'
      },
      new AbortController().signal
    )
    if (process.platform !== 'win32') expect((await exec(entry)).stdout).toBe('bzip-ready\n')
  })

  it.skipIf(process.platform === 'win32')(
    'rejects tar symlinks without publishing files outside the bundle',
    async () => {
      const source = path.join(root, 'source')
      await fs.mkdir(source)
      await fs.symlink('../../outside', path.join(source, 'escape'))
      const archive = path.join(root, 'unsafe.tgz')
      await tar.c({ cwd: source, file: archive, gzip: true }, ['escape'])
      serve(await fs.readFile(archive))
      await expect(
        installBinaryAgent(
          'example-agent',
          {
            manager: 'binary',
            version: '1.0.0',
            archive: 'https://example.com/agent.tar.gz',
            cmd: './escape'
          },
          new AbortController().signal
        )
      ).rejects.toThrow('Unsupported archive entry')
      expect(await fs.readdir(path.join(root, 'agents'))).toEqual([])
    }
  )

  it('rejects registry executable paths outside the extracted bundle', async () => {
    serve(Buffer.from('binary contents'))
    await expect(
      installBinaryAgent(
        'example-agent',
        {
          manager: 'binary',
          version: '1.0.0',
          archive: 'https://example.com/agent',
          cmd: '../../outside'
        },
        new AbortController().signal
      )
    ).rejects.toThrow('escapes')
    await expect(fs.stat(path.join(root, 'outside'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
