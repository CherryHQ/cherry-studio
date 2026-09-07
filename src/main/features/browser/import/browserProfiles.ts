import { access, readdir, readFile } from 'node:fs/promises'
import { platform } from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { type BrowserImportSource, BrowserImportSourceSchema } from '@shared/ipc/schemas/browserImport'
import * as z from 'zod'

export interface BrowserProfile extends BrowserImportSource {
  directory: string
  historyFile?: string
  cookiesFile?: string
}

async function existingFile(directory: string, candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    const file = path.join(directory, candidate)
    try {
      await access(file)
      return file
    } catch {
      /* Optional profile data may not exist yet. */
    }
  }
  return undefined
}

const profileInfoSchema = z
  .object({
    name: z.string().trim().catch(''),
    user_name: z.string().trim().catch(''),
    gaia_name: z.string().trim().catch('')
  })
  .catch({ name: '', user_name: '', gaia_name: '' })
const localStateSchema = z.object({
  profile: z.object({ info_cache: z.record(z.string(), profileInfoSchema) })
})

async function readProfileInfo(file: string): Promise<Record<string, z.infer<typeof profileInfoSchema>>> {
  try {
    return localStateSchema.parse(JSON.parse(await readFile(file, 'utf8'))).profile.info_cache
  } catch {
    return {}
  }
}

const platformRestrictions: Partial<Record<BrowserImportSource['browser'], readonly NodeJS.Platform[]>> = {
  dia: ['darwin'],
  comet: ['darwin', 'win32']
}

async function scanBrowserProfiles(browser: BrowserImportSource['browser']): Promise<BrowserProfile[]> {
  const root = application.getPath(`external.browser.${browser}`)
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const isFirefox = browser === 'firefox'
  const profileInfo = isFirefox
    ? {}
    : await readProfileInfo(application.getPath(`external.browser.${browser}`, 'Local State'))
  const directories = entries
    .filter((entry) => entry.isDirectory() && (isFirefox || /^(Default|Profile \d+)$/.test(entry.name)))
    .map((entry) => entry.name)
  if (browser === 'opera') directories.unshift('')

  const historyCandidates = isFirefox ? ['places.sqlite'] : ['History']
  const cookieCandidates = isFirefox ? ['cookies.sqlite'] : ['Network/Cookies', 'Cookies']
  const profiles: BrowserProfile[] = []
  for (const name of directories) {
    const directory = path.join(root, name)
    const historyFile = await existingFile(directory, historyCandidates)
    const cookiesFile = await existingFile(directory, cookieCandidates)
    if (!historyFile && !cookiesFile) continue
    profiles.push({
      id: `${browser}:${name || 'root'}`,
      browser,
      profile: name || 'Opera',
      displayName: profileInfo[name]?.name || profileInfo[name]?.gaia_name || undefined,
      account: profileInfo[name]?.user_name || undefined,
      directory,
      historyFile,
      cookiesFile,
      history: !!historyFile,
      cookies: !cookiesFile ? 'unavailable' : isFirefox ? 'supported' : 'requires_authorization'
    })
  }
  return profiles
}

export async function listBrowserProfiles(): Promise<BrowserProfile[]> {
  const currentPlatform = platform()
  const browsers = BrowserImportSourceSchema.shape.browser.options.filter(
    (browser) => platformRestrictions[browser]?.includes(currentPlatform) ?? true
  )
  return (await Promise.all(browsers.map(scanBrowserProfiles))).flat()
}
