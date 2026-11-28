import type { AppEdition } from '@shared/types/appEdition'

export const SUPPORT_EMAIL = 'support@cherry-ai.com'

/** Pre-addressed feedback mail to Cherry Studio support. */
export const FEEDBACK_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=Cherry%20Studio%20Feedback`

const OFFICIAL_DOWNLOAD_URLS: Record<AppEdition, string> = {
  global: 'https://cherryai.com/download',
  cn: 'https://cherryai.com.cn/download'
}

/** The official download page for an app edition. */
export function officialDownloadUrl(edition: AppEdition): string {
  return OFFICIAL_DOWNLOAD_URLS[edition]
}
