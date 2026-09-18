import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { artifactSource, readArtifactFile, readInlineArtifact } from '../artifactAccess'
import { methodSchemas } from '../protocol'

const request = { sessionId: 'session', messageId: 'message', partIndex: 0, artifactIndex: 0, offset: 0, limitBytes: 4 }

describe('explicit artifact downloads', () => {
  let directory: string
  let workspace: string
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'remote-artifact-'))
    workspace = path.join(directory, 'workspace')
    await mkdir(workspace)
  })
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('returns bounded binary pages that reconstruct a declared workspace file', async () => {
    const content = Buffer.from([0, 255, 128, 13, 10, 42, 7, 9, 1])
    await writeFile(path.join(workspace, 'output.bin'), content)
    const first = await readArtifactFile(workspace, 'output.bin', request)
    expect(first.name).toBe('output.bin')
    expect(first.totalBytes).toBe(content.length)
    expect(Buffer.from(first.data, 'base64')).toEqual(content.subarray(0, 4))
    const second = await readArtifactFile(workspace, 'output.bin', { ...request, offset: 4, revision: first.revision })
    const last = await readArtifactFile(workspace, 'output.bin', { ...request, offset: 8, revision: first.revision })
    expect(last.nextOffset).toBeNull()
    expect(Buffer.concat([first, second, last].map((page) => Buffer.from(page.data, 'base64')))).toEqual(content)
  })

  it('rejects paths and symbolic links that escape the session workspace', async () => {
    const outside = path.join(directory, 'private.txt')
    await writeFile(outside, 'private data')
    await symlink(outside, path.join(workspace, 'escape.txt'))
    await expect(readArtifactFile(workspace, '../private.txt', request)).rejects.toThrow('ARTIFACT_UNAVAILABLE')
    await expect(readArtifactFile(workspace, outside, request)).rejects.toThrow('ARTIFACT_UNAVAILABLE')
    await expect(readArtifactFile(workspace, 'escape.txt', request)).rejects.toThrow('ARTIFACT_UNAVAILABLE')
    await expect(readArtifactFile(workspace, '.', request)).rejects.toThrow('ARTIFACT_UNAVAILABLE')
  })

  it('rejects continuing a download after the artifact changes and handles empty files', async () => {
    await writeFile(path.join(workspace, 'output.txt'), 'first version')
    const first = await readArtifactFile(workspace, 'output.txt', request)
    await writeFile(path.join(workspace, 'output.txt'), 'a changed and longer version')
    await expect(
      readArtifactFile(workspace, 'output.txt', { ...request, offset: 4, revision: first.revision })
    ).rejects.toThrow('CONTENT_CHANGED')
    await writeFile(path.join(workspace, 'empty.txt'), '')
    expect(await readArtifactFile(workspace, 'empty.txt', request)).toMatchObject({
      totalBytes: 0,
      data: '',
      nextOffset: null
    })
  })

  it('reads inline media only on demand and never accepts an arbitrary remote URL', () => {
    const page = readInlineArtifact(
      {
        url: 'data:application/octet-stream;base64,AP+AAg==',
        name: 'image.bin',
        mediaType: 'application/octet-stream'
      },
      request
    )
    expect(Buffer.from(page.data, 'base64')).toEqual(Buffer.from([0, 255, 128, 2]))
    expect(() => artifactSource({ type: 'file', url: 'http://private-host/file', mediaType: 'image/png' }, 0)).toThrow(
      'ARTIFACT_UNAVAILABLE'
    )
    expect(methodSchemas['artifacts.read'].safeParse({ ...request, path: '/private.txt' }).success).toBe(false)
    expect(methodSchemas['artifacts.read'].safeParse({ ...request, limitBytes: 262145 }).success).toBe(false)
  })
})
