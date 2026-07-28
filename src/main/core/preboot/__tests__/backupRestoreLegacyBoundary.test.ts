import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(__dirname, '../../../../..')
const MAIN_ROOT = path.join(REPO_ROOT, 'src/main')

function productionTypeScriptFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name)
    if (entry.isDirectory()) {
      return entry.name === '__tests__' ? [] : productionTypeScriptFiles(file)
    }
    return entry.name.endsWith('.ts') ? [file] : []
  })
}

function source(file: string): string {
  return fs.readFileSync(file, 'utf8')
}

describe('legacy backup boundary', () => {
  const mainSources = productionTypeScriptFiles(MAIN_ROOT)

  it('exposes neither legacy archive routes nor a renderer bridge', () => {
    const mainIpc = source(path.join(MAIN_ROOT, 'ipc.ts'))
    const preload = source(path.join(REPO_ROOT, 'src/preload/preload.ts'))
    const channels = source(path.join(REPO_ROOT, 'src/shared/IpcChannel.ts'))
    const legacyManager = ['Legacy', 'BackupManager'].join('')
    const legacyChannelPrefix = ['Backup', '_'].join('')

    expect(mainIpc).not.toContain(legacyManager)
    expect(mainIpc).not.toContain('backup:')
    expect(preload).not.toMatch(/\bbackup\s*:/)
    expect(channels).not.toContain(legacyChannelPrefix)
    expect(fs.existsSync(path.join(MAIN_ROOT, 'services', `${legacyManager}.ts`))).toBe(false)
  })

  it('limits version-1 journal access to the preboot compatibility executor', () => {
    const v1JournalModule = 'restoreJournalV1Compat'
    const importers = mainSources
      .filter((file) => path.basename(file) !== `${v1JournalModule}.ts` && source(file).includes(v1JournalModule))
      .map((file) => path.relative(REPO_ROOT, file))
      .sort()

    expect(importers).toEqual([
      'src/main/core/preboot/backupRestoreGate.ts',
      'src/main/data/db/restore/restorePromotionV1Compat.ts'
    ])
  })
})
