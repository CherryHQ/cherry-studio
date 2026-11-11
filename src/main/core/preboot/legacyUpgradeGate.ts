import { app, dialog } from 'electron'

import { application } from '@application'
import {
  findLegacyUpgradeProfile,
  getLegacyUpgradeDownloadUrl,
  LEGACY_UPGRADE_VERSION
} from '@data/migration/legacyUpgrade'
import { showLegacyUpgradeWindow } from '@data/migration/legacyUpgradeWindow'
import { loggerService } from '@logger'
import { isPortable } from '@main/core/platform'
import { bootConfigService } from '@main/data/bootConfig'
import { resolveSystemLanguage, t } from '@main/i18n'

import { getNormalizedExecutablePath } from './userDataLocation'

const logger = loggerService.withContext('LegacyUpgradeGate')

export async function runLegacyUpgradeGate(): Promise<'handled' | 'skipped'> {
  try {
    const profile = findLegacyUpgradeProfile()
    if (!profile) return 'skipped'
    if (profile.kind === 'recover') {
      const previous = bootConfigService.get('app.user_data_path')
      bootConfigService.set('app.user_data_path', { ...previous, [getNormalizedExecutablePath()]: profile.path })
      try {
        bootConfigService.persist()
      } catch (error) {
        bootConfigService.set('app.user_data_path', previous)
        throw error
      }
      application.relaunch()
      return 'handled'
    }
    await app.whenReady()
    const language = resolveSystemLanguage(app.getLocale())
    const platform = {
      platform: process.platform,
      arch: process.arch,
      translated: app.runningUnderARM64Translation,
      portable: isPortable
    }
    await showLegacyUpgradeWindow(
      {
        title: t('dialog.legacy_upgrade.title', undefined, language),
        olderVersions: t('dialog.legacy_upgrade.older_versions', undefined, language),
        detail: t('dialog.legacy_upgrade.detail', { version: LEGACY_UPGRADE_VERSION }, language),
        prerequisite: t('dialog.legacy_upgrade.prerequisite', undefined, language),
        download: t('dialog.legacy_upgrade.download', { version: LEGACY_UPGRADE_VERSION }, language),
        downloadPrerequisite: t('dialog.legacy_upgrade.download', { version: '1.9.12' }, language),
        quit: t('dialog.legacy_upgrade.quit', undefined, language)
      },
      {
        bridge: getLegacyUpgradeDownloadUrl(platform),
        prerequisite: getLegacyUpgradeDownloadUrl({ ...platform, version: '1.9.12' })
      }
    )
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
