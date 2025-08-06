import { loggerService } from '@logger'
import { GIGABYTE } from '@shared/config/constant'
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
  if (freeBytes < 5 * GIGABYTE) {
    return true
  }

  const freePercentage = (freeBytes / totalBytes) * 100
  if (totalBytes > 1024 * GIGABYTE) {
    if (freeBytes < 50 * GIGABYTE) {
      return true
    }
  }

  // if total bytes is greater than 128GB, and free percentage is less than 5%, warn user
  if (totalBytes > 128 * GIGABYTE) {
    if (freePercentage < 5) {
      return true
    }
  }

  // if total bytes is less than 128GB, and free percentage is less than 10%, warn user
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
        return true
      }
    }
  } catch (error) {
    logger.error('Failed to get storage quota:', error as Error)
  }
  return false
}

async function checkAppDataDiskQuota(appDataPath: string) {
  try {
    const { free, size } = await window.api.getDiskInfo(appDataPath)
    logger.info(
      `App data disk quota: free: ${(free / 1024 / 1024 / 1024).toFixed(2)}GB  total: ${(size / 1024 / 1024 / 1024).toFixed(2)}GB`
    )
    if (shouldShowDiskWarning(free, size)) {
      window.message.warning(t('data.limit.appDataDiskQuota'))
    }
  } catch (error) {
    logger.error('Failed to get app data disk quota:', error as Error)
  }
}

export async function checkDataLimit() {
  const check = async () => {
    // check app storage quota
    const isStorageQuotaLow = await checkAppStorageQuota()
    if (isStorageQuotaLow) {
      return
    }

    // check app data disk quota
    const appInfo: AppInfo = await window.api.getAppInfo()
    if (appInfo?.appDataPath) {
      await checkAppDataDiskQuota(appInfo.appDataPath)
    }
  }

  const interval = setInterval(check, CHECK_INTERVAL)
  check()

  return () => clearInterval(interval)
}
