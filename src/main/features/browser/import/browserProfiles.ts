import { access, readdir } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import type { BrowserImportSource } from '@shared/ipc/schemas/browserImport'

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

export async function listBrowserProfiles(): Promise<BrowserProfile[]> {
  const profiles: BrowserProfile[] = []
  for (const browser of ['chrome', 'edge', 'brave', 'firefox'] as const) {
    const root = application.getPath(`external.browser.${browser}`)
    let entries
    try {
      entries = await readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || (browser !== 'firefox' && !/^(Default|Profile \d+)$/.test(entry.name))) continue
      const directory = path.join(root, entry.name)
      const historyFile = await existingFile(directory, browser === 'firefox' ? ['places.sqlite'] : ['History'])
      const cookiesFile = await existingFile(
        directory,
        browser === 'firefox' ? ['cookies.sqlite'] : ['Network/Cookies', 'Cookies']
      )
      if (!historyFile && !cookiesFile) continue
      profiles.push({
        id: `${browser}:${entry.name}`,
        browser,
        profile: entry.name,
        directory,
        historyFile,
        cookiesFile,
        history: !!historyFile,
        cookies: !cookiesFile ? 'unavailable' : browser === 'firefox' ? 'supported' : 'requires_authorization'
      })
    }
  }
  return profiles
}
