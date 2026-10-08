import { net } from 'electron'
import * as z from 'zod'

const releaseSchema = z.object({
  draft: z.literal(false).optional(),
  prerelease: z.literal(false),
  assets: z.array(z.object({ name: z.string(), browser_download_url: z.url() }))
})

export async function getAndroidDownloadUrl(country: string): Promise<string> {
  const inChina = country.toUpperCase() === 'CN'
  const host = inChina ? 'gitcode.com' : 'github.com'
  const endpoint = inChina
    ? 'https://api.gitcode.com/api/v5/repos/CherryHQ/cherry-studio-app/releases/latest'
    : 'https://api.github.com/repos/CherryHQ/cherry-studio-app/releases/latest'
  const response = await net.fetch(endpoint, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) {
    throw new Error(`Mobile release request failed with HTTP ${response.status}`)
  }

  const release = releaseSchema.parse(await response.json())
  const apk = release.assets.find((asset) => asset.name.endsWith('-android.apk'))
  if (!apk) {
    throw new Error('Mobile release has no Android APK')
  }

  const url = new URL(apk.browser_download_url)
  if (
    url.origin !== `https://${host}` ||
    url.username ||
    url.password ||
    !url.pathname.startsWith('/CherryHQ/cherry-studio-app/releases/download/') ||
    !url.pathname.endsWith('.apk')
  ) {
    throw new Error('Mobile release has an invalid Android download URL')
  }

  return apk.browser_download_url
}
