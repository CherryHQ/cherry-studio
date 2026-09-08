import { application } from '@application'
import { browserHistoryService } from '@data/services/BrowserHistoryService'
import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheBrowserFavicons, captureBrowserFavicon } from '../browserFavicons'
import { trackBrowserHistory } from '../trackBrowserHistory'
import { createGuest } from './guestFixture'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aetkAAAAASUVORK5CYII=',
  'base64'
)
const iconPattern = /^data:image\/png;base64,/
async function expectCachedIcon() {
  const entries = application.get('CacheService').getPersist('browser.favicons')
  expect(Object.keys(entries)).toEqual(['https://example.com'])
  const value = entries['https://example.com']
  expect(value).toMatch(iconPattern)
  const sharp = (await import('sharp')).default
  expect(await sharp(Buffer.from(value.split(',')[1], 'base64')).metadata()).toMatchObject({
    format: 'png',
    width: 1,
    height: 1
  })
}

describe('Browser favicon cache', () => {
  setupTestDatabase()
  beforeEach(() => {
    application.get('CacheService').deletePersist('browser.favicons')
  })
  afterEach(() => vi.restoreAllMocks())

  it('caches the actual page icon for older visits on the same origin, without storing remote image URLs', async () => {
    const { guest, mock } = createGuest()
    Object.assign(mock.session, { fetch: vi.fn().mockResolvedValue(new Response(png)) })
    browserHistoryService.record({ url: 'https://example.com/old', title: 'Older page', visitedAt: 1 })
    await captureBrowserFavicon(
      guest,
      guest.getURL(),
      ['https://cdn.test/custom-icon.png'],
      new AbortController().signal
    )
    expect(browserHistoryService.list({ offset: 0, limit: 10 }).items[0].favicon).toMatch(iconPattern)
    await expectCachedIcon()
  })

  it('bounds downloads, skips undecodable candidates, and falls back to a valid icon', async () => {
    const { guest, mock } = createGuest()
    Object.assign(mock.session, {
      fetch: vi
        .fn()
        .mockResolvedValueOnce(new Response(Buffer.alloc(256 * 1024 + 1)))
        .mockResolvedValueOnce(new Response('not an image'))
        .mockResolvedValueOnce(new Response(png))
    })
    await captureBrowserFavicon(
      guest,
      guest.getURL(),
      ['https://example.com/huge', 'https://example.com/bad', 'https://example.com/icon'],
      new AbortController().signal
    )
    await expectCachedIcon()
  })

  it('preserves ICO bytes for the browser decoder and normalizes SVG to a bounded local PNG', async () => {
    const ico = Buffer.concat([
      Buffer.from([0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 32, 0]),
      Buffer.from([png.length, 0, 0, 0, 22, 0, 0, 0]),
      png
    ])
    await cacheBrowserFavicons(
      new Map([
        ['https://ico.test/', ico],
        [
          'https://svg.test/',
          Buffer.from(
            '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="red"/></svg>'
          )
        ]
      ])
    )
    const entries = application.get('CacheService').getPersist('browser.favicons')
    expect(entries['https://ico.test']).toBe(`data:image/x-icon;base64,${ico.toString('base64')}`)
    const sharp = (await import('sharp')).default
    const image = sharp(Buffer.from(entries['https://svg.test'].split(',')[1], 'base64'))
    expect(await image.metadata()).toMatchObject({ format: 'png', width: 32, height: 32 })
    expect([...(await image.raw().toBuffer()).subarray(0, 4)]).toEqual([255, 0, 0, 255])
  })

  it.each(['navigation', 'disposal'])('does not publish a late image after %s', async (reason) => {
    const { guest, mock } = createGuest()
    Object.assign(mock, { isLoadingMainFrame: () => true })
    let respond!: (response: Response) => void
    Object.assign(mock.session, {
      fetch: vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            respond = resolve
          })
      )
    })
    const tasks: Promise<void>[] = []
    const release = trackBrowserHistory(guest, true, (url, candidates, signal) => {
      tasks.push(captureBrowserFavicon(guest, url, candidates, signal))
    })
    mock.emit('page-favicon-updated', {}, ['https://example.com/icon'])
    if (reason === 'navigation') {
      mock.getURL.mockReturnValue('https://other.test/')
      mock.emit('did-navigate')
    } else release()
    respond(new Response(png))
    await Promise.all(tasks)
    expect(application.get('CacheService').getPersist('browser.favicons')).toEqual({})
    release()
    expect(mock.listenerCount('page-favicon-updated')).toBe(0)
  })

  it('limits persistent storage to 256 sites and excludes non-web origins and invalid images', async () => {
    await cacheBrowserFavicons(
      new Map([
        ['file:///private/site', png],
        ['https://invalid.test/', Buffer.from('invalid')],
        ...Array.from({ length: 257 }, (_, index) => [`https://site-${index}.test/page`, png] as const)
      ])
    )
    const entries = application.get('CacheService').getPersist('browser.favicons')
    expect(Object.keys(entries)).toHaveLength(256)
    expect(entries['https://site-0.test']).toBeUndefined()
    expect(entries['https://site-256.test']).toMatch(iconPattern)
    expect(entries['https://invalid.test']).toBeUndefined()
  })
})
