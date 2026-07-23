import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { FilePath } from '@shared/types/file'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { getMetadataByPath } from '../metadata'

// UTF-8 text long enough for chardet to detect with high confidence.
const TEXT_SAMPLE = '这是一段自定义格式的纯文本内容，长度足够让编码检测有信心地判定为文本。\n'.repeat(4)
// Binary bytes (contains null) so isBinaryFile classifies it as non-text.
const BINARY_SAMPLE = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x10])

describe('getMetadataByPath', () => {
  let tmp: string
  beforeEach(async () => {
    tmp = await mkdtemp(path.join(tmpdir(), 'cherry-fm-getmeta-test-'))
  })
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true })
  })

  // Guards this PR's behavior-fidelity core: `getMetadataByPath` (and the entry
  // arm via the shared `buildPhysicalFileMetadata`) must derive a real `type`,
  // including the content sniff that upgrades extension-unknown text files —
  // otherwise `useIsTextFile` / `isSupportedFile` silently regress to binary.
  it('derives type: text for an extensionless text file via content sniff', async () => {
    const f = path.join(tmp, 'README') // no extension → forces the content sniff
    await writeFile(f, TEXT_SAMPLE)
    const meta = await getMetadataByPath(f as FilePath)
    expect(meta).toMatchObject({ kind: 'file', type: 'text' })
    expect(typeof meta.size).toBe('number')
  })

  it('derives type: other for unknown-extension binary content', async () => {
    const f = path.join(tmp, 'mystery.xyz123')
    await writeFile(f, BINARY_SAMPLE)
    expect(await getMetadataByPath(f as FilePath)).toMatchObject({ kind: 'file', type: 'other' })
  })

  it('returns kind: directory for a directory', async () => {
    const d = path.join(tmp, 'sub')
    await mkdir(d)
    expect((await getMetadataByPath(d as FilePath)).kind).toBe('directory')
  })
})
