import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { app, session } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

import { AdblockService } from '../AdblockService'
import { isBlockedByAdblock, setAdblockGate } from '../gate'

const ENGINE_PATH = new URL('../../../../../resources/adblock/engine.bin', import.meta.url)

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>()
  return {
    ...actual,
    readFile: vi.fn(async (file: string) => {
      if (file.endsWith('engine.bin')) return readFileSync(ENGINE_PATH)
      return actual.readFile(file, 'utf8')
    })
  }
})

const request = (url: string, resourceType = 'script', sourceUrl = 'https://www.baidu.com/s?wd=test') =>
  ({ url, resourceType, referrer: sourceUrl, method: 'GET' }) as Electron.OnBeforeRequestListenerDetails

async function startService(): Promise<AdblockService> {
  const service = new AdblockService()
  await (service as unknown as { onInit: () => Promise<void> }).onInit()
  return service
}

function stubPreloadApi(): void {
  for (const profile of [WebviewSecurityProfile.MiniApp, WebviewSecurityProfile.AgentBrowser]) {
    const guestSession = session.fromPartition(getWebviewPartition(profile)) as unknown as Record<string, unknown>
    guestSession.registerPreloadScript = vi.fn(() => `preload-${profile}`)
    guestSession.unregisterPreloadScript = vi.fn()
  }
}

describe('AdblockService', () => {
  let directory: string

  beforeEach(async () => {
    vi.clearAllMocks()
    BaseService.resetInstances()
    setAdblockGate(undefined)
    directory = await mkdtemp(path.join(os.tmpdir(), 'adblock-service-'))
    ;(app.getPath as unknown as ReturnType<typeof vi.fn>).mockImplementation((key: string) =>
      key === 'userData' ? directory : `/mock/${key}`
    )
    stubPreloadApi()
  })

  afterEach(async () => {
    setAdblockGate(undefined)
    await application.get('PreferenceService').set('app.browser.adblock.enabled', true)
    await application.get('PreferenceService').set('app.browser.adblock.search_ads', true)
    await rm(directory, { recursive: true, force: true })
  })

  it('blocks ad requests through the gate and leaves pages and ordinary assets alone', async () => {
    const service = await startService()

    expect(service.isActive()).toBe(true)
    expect(isBlockedByAdblock(request('https://cpro.baidu.com/cpro/ui/c.js'))).toBe(true)
    expect(isBlockedByAdblock(request('https://www.google.com/aclk?sa=L'))).toBe(true)
    expect(isBlockedByAdblock(request('https://cdn.jsdelivr.net/npm/vue/dist/vue.js'))).toBe(false)
    expect(isBlockedByAdblock(request('https://www.baidu.com/s?wd=test', 'mainFrame'))).toBe(false)

    await (service as unknown as { onStop: () => Promise<void> }).onStop()
  })

  it('registers the cosmetic preload once per browser session', async () => {
    const service = await startService()
    const siteSession = session.fromPartition(getWebviewPartition(WebviewSecurityProfile.MiniApp)) as unknown as {
      registerPreloadScript: ReturnType<typeof vi.fn>
    }

    expect(siteSession.registerPreloadScript).toHaveBeenCalledWith({
      type: 'frame',
      filePath: '/mock/app.root.resources/adblock/preload.cjs'
    })

    await (service as unknown as { onStop: () => Promise<void> }).onStop()
    expect(siteSession.registerPreloadScript).toHaveBeenCalledTimes(1)
  })

  it('stops matching as soon as the preference is turned off', async () => {
    const service = await startService()
    expect(service.isActive()).toBe(true)

    await application.get('PreferenceService').set('app.browser.adblock.enabled', false)

    expect(service.isActive()).toBe(false)
    expect(isBlockedByAdblock(request('https://cpro.baidu.com/cpro/ui/c.js'))).toBe(false)
    await (service as unknown as { onStop: () => Promise<void> }).onStop()
  })

  it('degrades to a no-op when the engine file is missing', async () => {
    const { readFile } = await import('node:fs/promises')
    vi.mocked(readFile).mockRejectedValueOnce(new Error('ENOENT'))

    const service = await startService()

    expect(service.isActive()).toBe(false)
    expect(isBlockedByAdblock(request('https://cpro.baidu.com/cpro/ui/c.js'))).toBe(false)
    await (service as unknown as { onStop: () => Promise<void> }).onStop()
  })

  it('applies an AI cosmetic rule to its own domain and drops it again', async () => {
    const service = await startService()
    const { rule } = await service.addCustomRule({
      domain: 'example.com',
      kind: 'cosmetic',
      value: '.ad-slot',
      source: 'ai'
    })
    const customCssFor = (url: string) =>
      (service as unknown as { customCssFor: (u: string) => string }).customCssFor(url)

    expect(customCssFor('https://www.example.com/page')).toContain('.ad-slot')
    expect(customCssFor('https://other.example.net/page')).toBe('')

    expect(await service.removeCustomRule(rule.id)).toBe(true)
    expect(customCssFor('https://www.example.com/page')).toBe('')
    await (service as unknown as { onStop: () => Promise<void> }).onStop()
  })

  it('blocks an AI network rule only when the page is on its domain', async () => {
    const service = await startService()
    await service.addCustomRule({
      domain: 'zzz-test.com',
      kind: 'network',
      value: '||tracker.zzz-test.com^',
      source: 'ai'
    })

    expect(
      isBlockedByAdblock(request('https://tracker.zzz-test.com/pixel.js', 'script', 'https://www.zzz-test.com/page'))
    ).toBe(true)
    expect(
      isBlockedByAdblock(request('https://tracker.zzz-test.com/pixel.js', 'script', 'https://www.other.com/page'))
    ).toBe(false)
    await (service as unknown as { onStop: () => Promise<void> }).onStop()
  })
})
