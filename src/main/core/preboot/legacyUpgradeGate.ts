import { app, dialog } from 'electron'

import { application } from '@application'
import { getLegacyBridgeEligibility, getLegacyLinuxPackageType } from '@data/migration/legacyBridgeInstaller'
import { LEGACY_PREREQUISITE_VERSION, LEGACY_UPGRADE_VERSION } from '@data/migration/legacyBridgeTarget'
import { findLegacyUpgradeProfile, getLegacyUpgradeDownloadUrl } from '@data/migration/legacyUpgrade'
import { showLegacyUpgradeWindow } from '@data/migration/legacyUpgradeWindow'
import { loggerService } from '@logger'
import { isPortable } from '@main/core/platform'
import { bootConfigService } from '@main/data/bootConfig'
import { resolveSystemLanguage, t } from '@main/i18n'
import { getAppEdition } from '@main/utils/appEdition'

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
      portable: isPortable,
      edition: getAppEdition(),
      linuxPackageType: getLegacyLinuxPackageType()
    }
    const eligibility = getLegacyBridgeEligibility(profile.path)
    const prerequisiteTarget =
      eligibility.target?.version === LEGACY_PREREQUISITE_VERSION ? eligibility.target : undefined
    await showLegacyUpgradeWindow(
      {
        title: t('dialog.legacy_upgrade.title', undefined, language),
        olderVersions: t('dialog.legacy_upgrade.older_versions', undefined, language),
        detail: t('dialog.legacy_upgrade.detail', { version: LEGACY_UPGRADE_VERSION }, language),
        prerequisite: prerequisiteTarget
          ? t(
              'dialog.legacy_upgrade.install_prerequisite_detail',
              { prerequisite: LEGACY_PREREQUISITE_VERSION, version: LEGACY_UPGRADE_VERSION },
              language
            )
          : t('dialog.legacy_upgrade.prerequisite', undefined, language),
        download: t('dialog.legacy_upgrade.download', { version: LEGACY_UPGRADE_VERSION }, language),
        downloadPrerequisite: t('dialog.legacy_upgrade.download', { version: LEGACY_PREREQUISITE_VERSION }, language),
        quit: t('dialog.legacy_upgrade.quit', undefined, language),
        installation: {
          enabled: !!eligibility.target,
          prerequisite: eligibility.prerequisite,
          action: prerequisiteTarget
            ? t('dialog.legacy_upgrade.install_prerequisite', { version: LEGACY_PREREQUISITE_VERSION }, language)
            : t('dialog.legacy_upgrade.install', undefined, language),
          detail: t('dialog.legacy_upgrade.install_detail', undefined, language),
          cancel: t('dialog.legacy_upgrade.cancel', undefined, language),
          retry: t('dialog.legacy_upgrade.retry', undefined, language),
          preparing: t('dialog.legacy_upgrade.preparing', undefined, language),
          downloading: t('dialog.legacy_upgrade.downloading', undefined, language),
          installing: t(
            'dialog.legacy_upgrade.installing',
            { version: eligibility.target?.version ?? LEGACY_UPGRADE_VERSION },
            language
          ),
          failed: t('dialog.legacy_upgrade.failed', undefined, language)
        }
      },
      {
        bridge: getLegacyUpgradeDownloadUrl(platform),
        prerequisite:
          prerequisiteTarget?.url ?? getLegacyUpgradeDownloadUrl({ ...platform, version: LEGACY_PREREQUISITE_VERSION })
      },
      eligibility.target,
      profile.path
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
