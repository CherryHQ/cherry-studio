import { loggerService } from '@logger'

const logger = loggerService.withContext('copyApiKeyToClipboard')

export async function copyApiKeyToClipboard(apiKey: string, t: (key: string) => string): Promise<void> {
  try {
    await navigator.clipboard.writeText(apiKey)
    window.toast.success(t('message.copied'))
  } catch (error) {
    logger.warn('Failed to copy API key to clipboard', error as Error)
    window.toast.error(t('common.copy_failed'))
  }
}
