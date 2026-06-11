import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import AdmZip from 'adm-zip'
import { afterEach, describe, expect, it } from 'vitest'

import { readMarkdownFromResponseZip } from '../resultPersistence'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe('readMarkdownFromResponseZip integration', () => {
  it('downloads a real response body, reads markdown from a real zip, and removes temporary files', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'file-processing-result-'))
    tempRoots.push(tempRoot)
    const tempDir = path.join(tempRoot, 'downloads')

    const zip = new AdmZip()
    zip.addFile('bundle/output.md', Buffer.from('# real output'))
    zip.addFile('bundle/images/page-1.png', Buffer.from('png-bytes'))
    const zipBytes = new Uint8Array(zip.toBuffer())

    await expect(
      readMarkdownFromResponseZip({
        response: new Response(zipBytes),
        tempDir
      })
    ).resolves.toEqual(new Uint8Array(Buffer.from('# real output')))

    await expect(fs.readdir(tempDir)).resolves.toEqual([])
  })
})
