import { net } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAndroidDownloadUrl } from '../mobileAppDownload'

const downloadUrl = (host: string, version: string) =>
  `https://${host}/CherryHQ/cherry-studio-app/releases/download/v${version}/cherry-studio-${version}-android.apk`

const release = (host: string, version = '0.1.2') => ({
  prerelease: false,
  assets: [
    { name: 'source.zip', browser_download_url: 'https://example.com/source.zip' },
    { name: `cherry-studio-${version}-android.apk`, browser_download_url: downloadUrl(host, version) }
  ]
})

describe('getAndroidDownloadUrl', () => {
  beforeEach(() => {
    vi.mocked(net.fetch).mockReset()
  })

  it.each([
    ['CN', 'gitcode.com', 'https://api.gitcode.com/api/v5/repos/CherryHQ/cherry-studio-app/releases/latest'],
    ['cn', 'gitcode.com', 'https://api.gitcode.com/api/v5/repos/CherryHQ/cherry-studio-app/releases/latest'],
    ['US', 'github.com', 'https://api.github.com/repos/CherryHQ/cherry-studio-app/releases/latest'],
    ['HK', 'github.com', 'https://api.github.com/repos/CherryHQ/cherry-studio-app/releases/latest']
  ])('resolves the latest APK from the source for egress country %s', async (country, host, endpoint) => {
    vi.mocked(net.fetch).mockImplementation(async (input) => {
      if (input === endpoint) return Response.json(release(host))
      throw new Error(`Unexpected endpoint: ${input}`)
    })

    await expect(getAndroidDownloadUrl(country)).resolves.toBe(downloadUrl(host, '0.1.2'))
  })

  it('uses the asset returned by a newer release without a desktop update', async () => {
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(Response.json({ ...release('github.com'), draft: false }))
      .mockResolvedValueOnce(Response.json(release('github.com', '0.2.0')))

    await expect(getAndroidDownloadUrl('US')).resolves.toBe(downloadUrl('github.com', '0.1.2'))
    await expect(getAndroidDownloadUrl('US')).resolves.toBe(downloadUrl('github.com', '0.2.0'))
  })

  it.each([
    ['draft', { ...release('github.com'), draft: true }],
    ['prerelease', { ...release('github.com'), prerelease: true }],
    ['missing APK', { prerelease: false, assets: [] }],
    ['malformed metadata', { assets: 'invalid' }],
    ['untrusted URL', release('example.com')],
    [
      'another repository',
      {
        prerelease: false,
        assets: [
          { name: 'app-android.apk', browser_download_url: 'https://github.com/other/app/releases/download/app.apk' }
        ]
      }
    ]
  ])('rejects %s instead of returning an unusable download URL', async (_name, metadata) => {
    vi.mocked(net.fetch).mockResolvedValueOnce(Response.json(metadata))

    await expect(getAndroidDownloadUrl('US')).rejects.toThrow()
  })

  it('surfaces HTTP and network failures so the user can retry', async () => {
    vi.mocked(net.fetch)
      .mockResolvedValueOnce(new Response(null, { status: 403 }))
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce(Response.json(release('github.com')))

    await expect(getAndroidDownloadUrl('US')).rejects.toThrow('HTTP 403')
    await expect(getAndroidDownloadUrl('US')).rejects.toThrow('Network unavailable')
    await expect(getAndroidDownloadUrl('US')).resolves.toBe(downloadUrl('github.com', '0.1.2'))
  })
})
