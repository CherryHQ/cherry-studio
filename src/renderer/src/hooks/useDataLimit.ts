import { loggerService } from '@logger'
import { AppInfo } from '@renderer/types'
import { GB, MB } from '@shared/config/constant'
import { t } from 'i18next'

const logger = loggerService.withContext('useDataLimit')

// 30 minutes
const CHECK_INTERVAL = 1000 * 60 * 30

// Track dismissed warnings to prevent showing again
let isWarningDismissed = false
let currentInterval: NodeJS.Timeout | null = null

/**
 * 判断是否应显示磁盘空间不足的警告
 * @param freeBytes - 磁盘可用空间（字节）
 * @param totalBytes - 磁盘总空间（字节）
 * @returns true表示需要警告，false则不需要
 */
function shouldShowDiskWarning(freeBytes: number, totalBytes: number) {
  if (totalBytes < 32 * GB) {
    if (freeBytes < 1 * GB) {
      return true
    }
  }

  if (totalBytes < 64 * GB) {
    if (freeBytes < 2 * GB) {
      return true
    }
  }

  if (totalBytes < 128 * GB) {
    if (freeBytes < 4 * GB) {
      return true
    }
  }

  if (freeBytes < 5 * GB) {
    return true
  }

  return false
}

async function checkAppStorageQuota() {
  try {
    const { usage, quota } = await navigator.storage.estimate()
    if (usage && quota) {
      const usageInMB = (usage / MB).toFixed(2)
      const quotaInMB = (quota / MB).toFixed(2)
      const usagePercentage = (usage / quota) * 100

      logger.info(`App storage quota: Used ${usageInMB} MB / Total ${quotaInMB} MB (${usagePercentage.toFixed(2)}%)`)

      // if usage percentage is greater than 95%,
      // warn user to clean up app internal data
      if (usagePercentage > 95) {
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
    logger.info(`App data disk quota: free: ${(free / GB).toFixed(2)}GB  total: ${(size / GB).toFixed(2)}GB`)
    return shouldShowDiskWarning(free, size)
  } catch (error) {
    logger.error('Failed to get app data disk quota:', error as Error)
  }
  return false
}

export async function checkDataLimit() {
  const check = async () => {
    // Skip checking if user has dismissed the warning
    if (isWarningDismissed) {
      return
    }

    let isStorageQuotaLow = false
    let appDataDiskQuotaLow = false

    isStorageQuotaLow = await checkAppStorageQuota()
    const appInfo: AppInfo = await window.api.getAppInfo()
    if (appInfo?.appDataPath) {
      appDataDiskQuotaLow = await checkAppDataDiskQuota(appInfo.appDataPath)
    }

    if (isStorageQuotaLow || appDataDiskQuotaLow) {
      window.message.warning(t('data.limit.appDataDiskQuota'), () => {
        // When user manually closes warning, stop showing it and clear interval
        logger.info('User dismissed data limit warning')
        isWarningDismissed = true
        if (currentInterval) {
          clearInterval(currentInterval)
          currentInterval = null
        }
      })
    }
  }

  currentInterval = setInterval(check, CHECK_INTERVAL)
  check()
}
