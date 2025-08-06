import { loggerService } from '@logger'
import { AppInfo } from '@renderer/types'
import { t } from 'i18next'

const logger = loggerService.withContext('useDataLimit')

// 30 minutes
const CHECK_INTERVAL = 1000 * 60 * 30

/**
 * 判断是否应显示磁盘空间不足的警告
 * @param freeBytes - 磁盘可用空间（字节）
 * @param totalBytes - 磁盘总空间（字节）
 * @returns true表示需要警告，false则不需要
 */
function shouldShowDiskWarning(freeBytes: number, totalBytes: number) {
  const GIGABYTE = 1024 * 1024 * 1024
  if (freeBytes < 5 * GIGABYTE) {
    return true
  }
  const freePercentage = (freeBytes / totalBytes) * 100
  if (totalBytes > 1024 * GIGABYTE) {
    if (freeBytes < 50 * GIGABYTE) {
      return true
    }
  }

  if (totalBytes > 128 * GIGABYTE) {
    if (freePercentage < 5) {
      return true
    }
  }

  if (freePercentage < 10) {
    return true
  }
  return false
}

async function checkAppStorageQuota() {
  try {
    const { usage, quota } = await navigator.storage.estimate()
    if (usage && quota) {
      const usageInMB = (usage / 1024 / 1024).toFixed(2)
      const quotaInMB = (quota / 1024 / 1024).toFixed(2)
      const usagePercentage = (usage / quota) * 100

      logger.info(`App storage quota: Used ${usageInMB} MB / Total ${quotaInMB} MB (${usagePercentage.toFixed(2)}%)`)

      // if usage percentage is greater than 95%,
      // warn user to clean up app internal data
      if (usagePercentage > 95) {
        window.message.warning(t('data.limit.appStorageQuota'))
      }
    }
  } catch (error) {
    logger.error('Failed to get storage quota:', error as Error)
  }
}

async function checkAppDataDiskQuota(appDataPath: string) {
  const { free, size } = await window.api.getDiskInfo(appDataPath)
  logger.info(`App data disk quota: ${free / 1024 / 1024 / 1024} / ${size / 1024 / 1024 / 1024}`)
  if (shouldShowDiskWarning(free, size)) {
    logger.warn(`App data disk quota is low: ${free} / ${size}`)
    window.message.warning(t('data.limit.appDataDiskQuota'))
  }
}

export async function checkDataLimit() {
  const appInfo: AppInfo = await window.api.getAppInfo()

  const check = () => {
    if (appInfo?.appDataPath) {
      checkAppDataDiskQuota(appInfo.appDataPath)
    }
    checkAppStorageQuota()
  }

  const interval = setInterval(check, CHECK_INTERVAL)
  check()

  return () => clearInterval(interval)
}
