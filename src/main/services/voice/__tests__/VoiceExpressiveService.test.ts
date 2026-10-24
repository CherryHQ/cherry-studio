import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'

import { VoiceExpressiveService } from '../VoiceExpressiveService'

let directory: string

async function startService(): Promise<VoiceExpressiveService> {
  const service = new VoiceExpressiveService()
  await (service as unknown as { onInit: () => Promise<void> }).onInit()
  return service
}

beforeEach(async () => {
  vi.clearAllMocks()
  BaseService.resetInstances()
  directory = await mkdtemp(path.join(os.tmpdir(), 'voice-expressive-'))
  vi.mocked(application.getPath).mockReturnValue(path.join(directory, 'voice-expressive.json'))
})

afterEach(async () => {
  await rm(directory, { recursive: true, force: true })
})

describe('VoiceExpressiveService', () => {
  it('stores an emoji label and persists it', async () => {
    const service = await startService()

    const result = await service.set({ kind: 'emoji', match: '🫥', zh: '躲藏', en: 'hiding', source: 'ai' })

    expect(result.updated).toBe(false)
    expect(result.rule).toMatchObject({ kind: 'emoji', match: '🫥', zh: '躲藏', en: 'hiding', source: 'ai' })
    expect(service.list()).toHaveLength(1)

    const file = await readFile(path.join(directory, 'voice-expressive.json'), 'utf8')
    expect(JSON.parse(file)).toHaveLength(1)
  })

  it('updates an existing rule with the same kind and match', async () => {
    const service = await startService()
    const first = await service.set({ kind: 'kaomoji', match: '(｡•́︿•̀｡)', zh: '委屈', en: 'sad' })
    const second = await service.set({ kind: 'kaomoji', match: '(｡•́︿•̀｡)', zh: '难过', en: 'upset' })

    expect(second.updated).toBe(true)
    expect(second.rule.id).toBe(first.rule.id)
    expect(service.list()).toHaveLength(1)
    expect(service.list()[0].zh).toBe('难过')
  })

  it('rejects labels that would rewrite ordinary text', async () => {
    const service = await startService()

    await expect(service.set({ kind: 'emoji', match: 'abc', zh: '字母', en: 'letters' })).rejects.toThrow(
      'must contain an emoji'
    )
    await expect(service.set({ kind: 'kaomoji', match: 'word', zh: '词', en: 'word' })).rejects.toThrow(
      'at least one symbol'
    )
    await expect(service.set({ kind: 'emoji', match: '😄', zh: '', en: 'happy' })).rejects.toThrow()
    await expect(service.set({ kind: 'emoji', match: '😄', zh: '开心', en: 'x'.repeat(41) })).rejects.toThrow()
  })

  it('rejects punctuation and prose tokens that are not faces', async () => {
    const service = await startService()

    for (const match of ['.', 'C++', '1.2.3', '1.2', '(a+b)']) {
      await expect(service.set({ kind: 'kaomoji', match, zh: '点', en: 'dot' })).rejects.toThrow(
        'kaomoji must look like a face'
      )
    }
  })

  it('accepts face-shaped kaomoji and a flag emoji', async () => {
    const service = await startService()

    await expect(service.set({ kind: 'kaomoji', match: '(╥﹏╥)', zh: '大哭', en: 'crying' })).resolves.toBeTruthy()
    await expect(service.set({ kind: 'kaomoji', match: '¯\\_(ツ)_/¯', zh: '摊手', en: 'shrug' })).resolves.toBeTruthy()
    await expect(service.set({ kind: 'emoji', match: '🇺🇸', zh: '美国', en: 'United States' })).resolves.toBeTruthy()
  })

  it('removes a rule and reports a miss', async () => {
    const service = await startService()
    const { rule } = await service.set({ kind: 'emoji', match: '😄', zh: '开心', en: 'happy' })

    expect(await service.remove(rule.id)).toBe(true)
    expect(service.list()).toEqual([])
    expect(await service.remove('missing')).toBe(false)
  })

  it('drops an invalid row when reloading', async () => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(
      path.join(directory, 'voice-expressive.json'),
      JSON.stringify([
        { id: 'a', kind: 'emoji', match: '😄', zh: '开心', en: 'happy', source: 'manual', createdAt: 1 },
        { id: 'b', kind: 'emoji', match: 'plain', zh: '普通', en: 'plain', source: 'manual', createdAt: 1 }
      ])
    )

    const service = await startService()

    expect(service.list()).toHaveLength(1)
    expect(service.list()[0].id).toBe('a')
  })
})
