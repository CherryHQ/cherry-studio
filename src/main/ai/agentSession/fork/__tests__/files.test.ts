import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, it } from 'vitest'

import { publishForkArtifact } from '../files'

it('propagates ownership recording failures without treating them as cross-device link failures', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fork-artifact-'))

  try {
    const source = path.join(directory, 'source.jsonl')
    const target = path.join(directory, 'target.jsonl')
    await writeFile(source, 'native history')
    const failure = Object.assign(new Error('Ownership journal write failed'), { code: 'EXDEV' })

    await expect(
      publishForkArtifact(source, target, new AbortController().signal, () => {
        throw failure
      })
    ).rejects.toBe(failure)
    expect(await readFile(source, 'utf8')).toBe('native history')
    expect(await readFile(target, 'utf8')).toBe('native history')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
