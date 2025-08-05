import { loggerService } from '@logger'

const logger = loggerService.withContext('useDataLimit')

export async function checkAppStorageQuota() {
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
        window.message.warning('本应用的内部存储空间即将用尽，可能导致无法保存新数据。请考虑在设置中清理缓存。')
      }
    }
  } catch (error) {
    logger.error('Failed to get storage quota:', error as Error)
  }
}

export async function checkAppDataDiskQuota() {
  const { usage, quota } = await window.api.getAppDataDiskQuota()
}
