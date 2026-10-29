import { isSafeExternalUrl as isSharedSafeExternalUrl } from '@shared/utils/externalUrlSafety'

/**
 * Check the external-URL allowlist and narrowed file-editor/knowledge-action shapes.
 * The confirmation step for application links is owned by MainWindowService.openWebsite.
 */
export function isSafeExternalUrl(url: string): boolean {
  return isSharedSafeExternalUrl(url)
}
