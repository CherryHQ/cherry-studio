import { app, dialog, shell } from 'electron'

import { application } from '@application'
import {
  findLegacyUpgradeProfile,
  getLegacyUpgradeDownloadUrl,
  LEGACY_UPGRADE_VERSION
} from '@data/migration/legacyUpgrade'
import { loggerService } from '@logger'
import { isPortable } from '@main/core/platform'
import { resolveSystemLanguage, t } from '@main/i18n'

const logger = loggerService.withContext('LegacyUpgradeGate')

export async function runLegacyUpgradeGate(): Promise<'handled' | 'skipped'> {
  try {
    const profile = findLegacyUpgradeProfile()
    if (!profile) return 'skipped'
    await app.whenReady()
    const language = resolveSystemLanguage(app.getLocale())
    const url = getLegacyUpgradeDownloadUrl({
      platform: process.platform,
      arch: process.arch,
      translated: app.runningUnderARM64Translation,
      portable: isPortable
    })
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: t('dialog.legacy_upgrade.title', undefined, language),
      message: t('dialog.legacy_upgrade.message', { version: LEGACY_UPGRADE_VERSION }, language),
      detail: t('dialog.legacy_upgrade.detail', { version: LEGACY_UPGRADE_VERSION, path: profile }, language),
      buttons: [
        t('dialog.legacy_upgrade.download', { version: LEGACY_UPGRADE_VERSION }, language),
        t('dialog.legacy_upgrade.quit', undefined, language)
      ],
      defaultId: 0,
      cancelId: 1
    })
    if (response === 0) await shell.openExternal(url)
  } catch (error) {
    logger.error('Cannot complete legacy upgrade check', error as Error)
    await app.whenReady()
    const language = resolveSystemLanguage(app.getLocale())
    dialog.showErrorBox(
      t('dialog.legacy_upgrade.title', undefined, language),
      t('dialog.legacy_upgrade.error', { error: error instanceof Error ? error.message : String(error) }, language)
    )
  }
  application.quit()
  return 'handled'
}
