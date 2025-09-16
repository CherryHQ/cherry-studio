import { loggerService } from '@logger'
import { AppInfo } from '@renderer/types'
import { GB, MB } from '@shared/config/constant'
import { t } from 'i18next'

const logger = loggerService.withContext('useDataLimit')

const CHECK_INTERVAL_NORMAL = 1000 * 60 * 10 // 10 minutes
const CHECK_INTERVAL_WARNING = 1000 * 60 * 1 // 1 minute when warning is active

let currentInterval: NodeJS.Timeout | null = null
let currentToastId: string | null = null

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
      if (usagePercentage >= 95) {
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
    const diskInfo = await window.api.getDiskInfo(appDataPath)
    if (!diskInfo) {
      return false
    }
    const { free } = diskInfo
    logger.info(`App data disk quota: Free ${(free / GB).toFixed(2)} GB`)
    // if free is less than 1GB, return true
    return free < 1 * GB
  } catch (error) {
    logger.error('Failed to get app data disk quota:', error as Error)
  }
  return false
}

export async function checkDataLimit() {
  const check = async () => {
    let isStorageQuotaLow = false
    let isAppDataDiskQuotaLow = false

    isStorageQuotaLow = await checkAppStorageQuota()

    const appInfo: AppInfo = await window.api.getAppInfo()
    if (appInfo?.appDataPath) {
      isAppDataDiskQuotaLow = await checkAppDataDiskQuota(appInfo.appDataPath)
    }

    const shouldShowWarning = isStorageQuotaLow || isAppDataDiskQuotaLow

    // Show or hide toast based on warning state
    if (shouldShowWarning && !currentToastId) {
      // Show persistent toast without close button
      const toastId = window.toast.warning({
        title: t('settings.data.limit.appDataDiskQuota'),
        description: t('settings.data.limit.appDataDiskQuotaDescription'),
        timeout: 0, // Never auto-dismiss
        hideCloseButton: true // Hide close button so user cannot dismiss
      })
      currentToastId = toastId

      // Switch to warning mode with shorter interval
      logger.info('Disk space low, switching to 1-minute check interval')
      if (currentInterval) {
        clearInterval(currentInterval)
      }
      currentInterval = setInterval(check, CHECK_INTERVAL_WARNING)
    } else if (!shouldShowWarning && currentToastId) {
      // Dismiss toast when space is recovered
      window.toast.closeToast(currentToastId)
      currentToastId = null

      // Switch back to normal mode
      logger.info('Disk space recovered, switching back to 10-minute check interval')
      if (currentInterval) {
        clearInterval(currentInterval)
      }
      currentInterval = setInterval(check, CHECK_INTERVAL_NORMAL)
    }
  }

  // Initial check
  check()

  // Set up initial interval (normal mode)
  if (!currentInterval) {
    currentInterval = setInterval(check, CHECK_INTERVAL_NORMAL)
  }
}
