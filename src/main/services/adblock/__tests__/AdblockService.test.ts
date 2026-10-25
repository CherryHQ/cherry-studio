import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import type * as FsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { ipcMain, session, webContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import { getWebviewPartition, WebviewSecurityProfile } from '@shared/utils/webviewSecurity'

import { AdblockService } from '../AdblockService'
import { isBlockedByAdblock, setAdblockGate } from '../gate'

const ENGINE_PATH = new URL('../../../../../resources/adblock/engine.bin', import.meta.url)
const INJECT_COSMETIC_FILTERS = '@ghostery/adblocker/inject-cosmetic-filters'

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
  const partitions = [
    getWebviewPartition(WebviewSecurityProfile.MiniApp),
    getWebviewPartition(WebviewSecurityProfile.AgentBrowser),
    'persist:default',
    'private'
  ]
  for (const partition of partitions) {
    const guestSession = session.fromPartition(partition) as unknown as Record<string, unknown>
    guestSession.registerPreloadScript = vi.fn(() => `preload-${partition}`)
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
    const getPath = application.getPath as unknown as ReturnType<typeof vi.fn>
    getPath.mockImplementation((key: string) =>
      key === 'feature.adblock.rules_file' ? path.join(directory, 'adblock-rules.json') : `/mock/${key}`
    )
    vi.mocked(webContents.getAllWebContents).mockReturnValue([])
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

  it('keeps a rule whose option tail ends in an escape inside its saved domain', async () => {
    const service = await startService()
    await service.addCustomRule({
      domain: 'zzz-escape.com',
      kind: 'network',
      value: '||tracker.zzz-test.com^$redirect=noopjs\\',
      source: 'ai'
    })

    expect(
      isBlockedByAdblock(request('https://tracker.zzz-test.com/pixel.js', 'script', 'https://www.zzz-escape.com/page'))
    ).toBe(true)
    expect(
      isBlockedByAdblock(request('https://tracker.zzz-test.com/pixel.js', 'script', 'https://www.other.com/page'))
    ).toBe(false)
    await (service as unknown as { onStop: () => Promise<void> }).onStop()
  })

  it('falls back to the initiator origin when the page sends no referrer', async () => {
    const service = await startService()
    await service.addCustomRule({
      domain: 'zzz-test.com',
      kind: 'network',
      value: '||tracker.zzz-test.com^',
      source: 'ai'
    })
    const noReferrer = (initiatorOrigin: string) =>
      ({
        url: 'https://tracker.zzz-test.com/pixel.js',
        resourceType: 'script',
        referrer: '',
        initiatorOrigin,
        method: 'GET'
      }) as Electron.OnBeforeRequestListenerDetails

    expect(isBlockedByAdblock(noReferrer('https://www.zzz-test.com'))).toBe(true)
    expect(isBlockedByAdblock(noReferrer('https://www.other.com'))).toBe(false)
    await (service as unknown as { onStop: () => Promise<void> }).onStop()
  })

  it('rejects a network rule that tries to pick its own scope', async () => {
    const service = await startService()

    await expect(
      service.addCustomRule({
        domain: 'example.com',
        kind: 'network',
        value: '||cdn.review-test.invalid^$domain=other.com',
        source: 'ai'
      })
    ).rejects.toThrow('domain')

    await (service as unknown as { onStop: () => Promise<void> }).onStop()
  })

  it('covers the standalone MCP browser sessions in normal and private mode', async () => {
    const service = await startService()

    for (const partition of ['persist:default', 'private']) {
      const guestSession = session.fromPartition(partition) as unknown as {
        registerPreloadScript: ReturnType<typeof vi.fn>
        webRequest: { onBeforeRequest: ReturnType<typeof vi.fn> }
      }
      expect(guestSession.registerPreloadScript, partition).toHaveBeenCalledWith({
        type: 'frame',
        filePath: '/mock/app.root.resources/adblock/preload.cjs'
      })
      const listener = guestSession.webRequest.onBeforeRequest.mock.calls[0]?.[1] as (
        details: Electron.OnBeforeRequestListenerDetails,
        callback: (response: { cancel?: boolean }) => void
      ) => void
      const callback = vi.fn()
      listener(request('https://cpro.baidu.com/cpro/ui/c.js'), callback)
      expect(callback, partition).toHaveBeenCalledWith({ cancel: true })
    }

    await (service as unknown as { onStop: () => Promise<void> }).onStop()
  })

  it('leaves AI cosmetic rules to the tracked page stylesheet only', async () => {
    const service = await startService()
    await service.addCustomRule({ domain: 'baidu.com', kind: 'cosmetic', value: '.ad-slot', source: 'ai' })
    ;(service as unknown as { engine: unknown }).engine = {
      getCosmeticsFilters: () => ({ active: true, styles: '.engine-ad { display: none; }', scripts: [] })
    }

    const handler = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === INJECT_COSMETIC_FILTERS)?.[1]
    const insertCSS = vi.fn<(css: string) => Promise<string>>().mockResolvedValue('engine-sheet')
    const sender = {
      getURL: () => 'https://www.baidu.com/s?wd=test',
      insertCSS,
      executeJavaScript: vi.fn(async () => undefined)
    }
    await (handler as (event: unknown, url?: string, message?: unknown) => Promise<void>)(
      { sender },
      undefined,
      undefined
    )

    expect(insertCSS).toHaveBeenCalledTimes(1)
    expect(insertCSS.mock.calls[0][0]).toBe('.engine-ad { display: none; }')

    await (service as unknown as { onStop: () => Promise<void> }).onStop()
  })

  it('emits one CSS block per selector so one bad entry cannot discard the rest', async () => {
    const service = await startService()
    await service.addCustomRule({
      domain: 'example.com',
      kind: 'cosmetic',
      value: '.good, .also-good',
      source: 'ai'
    })
    const css = (service as unknown as { customCssFor: (url: string) => string }).customCssFor(
      'https://www.example.com/page'
    )

    expect(css).toContain('.good {')
    expect(css).toContain('.also-good {')
    expect(css).not.toContain('.good,')
    await (service as unknown as { onStop: () => Promise<void> }).onStop()
  })

  it('removes the tracked stylesheet when its cosmetic rule is disabled', async () => {
    const service = await startService()
    const { rule } = await service.addCustomRule({
      domain: 'example.com',
      kind: 'cosmetic',
      value: '.ad-slot',
      source: 'ai'
    })
    const insertCSS = vi
      .fn<(css: string, options?: { cssOrigin?: string }) => Promise<string>>()
      .mockResolvedValue('sheet-1')
    const removeInsertedCSS = vi.fn<(key: string) => Promise<void>>().mockResolvedValue(undefined)
    const page = {
      id: 42,
      isDestroyed: () => false,
      getURL: () => 'https://www.example.com/page',
      insertCSS,
      removeInsertedCSS,
      session: session.fromPartition(getWebviewPartition(WebviewSecurityProfile.MiniApp))
    }
    vi.mocked(webContents.getAllWebContents).mockReturnValue([page] as unknown as Electron.WebContents[])

    await service.setCustomRuleEnabled(rule.id, true)
    await vi.waitFor(() => expect(insertCSS).toHaveBeenCalledTimes(1))
    expect(insertCSS.mock.calls[0][0]).toContain('.ad-slot')
    // Author origin: user-origin sheets cannot be removed on the pinned Electron.
    expect(insertCSS.mock.calls[0][1]).toEqual({ cssOrigin: 'author' })

    await service.setCustomRuleEnabled(rule.id, false)
    await vi.waitFor(() => expect(removeInsertedCSS).toHaveBeenCalledWith('sheet-1'))

    await (service as unknown as { onStop: () => Promise<void> }).onStop()
  })
})
