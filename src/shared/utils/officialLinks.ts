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

/** Recovery links a preboot window may ask main to open. The renderer names a purpose, never a URL. */
export type SupportLinkPurpose = 'feedback' | 'download'

export function isSupportLinkPurpose(value: unknown): value is SupportLinkPurpose {
  return value === 'feedback' || value === 'download'
}

/** The URL behind a support link purpose for an app edition. */
export function supportLinkUrl(purpose: SupportLinkPurpose, edition: AppEdition): string {
  return purpose === 'feedback' ? FEEDBACK_MAILTO : officialDownloadUrl(edition)
}
