/**
 * The one place that knows how a mini app's session partition is named.
 *
 * Both halves were written out independently before — a literal in `webviewHost` and a
 * template in `MiniAppRuntimeService` — which is two strings that must agree with nothing
 * making them. Generic webview machinery reads `isMiniAppPartition` to leave mini apps
 * alone: a mini app configures its own session, preload and headers, and a process-wide
 * pass that writes over any of them is not extra hardening, it is a silent replacement.
 */

import { session } from 'electron'

export const MINI_APP_PARTITION_PREFIX = 'persist:miniapp:'

export function miniAppPartition(appId: string): string {
  return `${MINI_APP_PARTITION_PREFIX}${appId}`
}

/** `startsWith`, never `includes`: a partition merely CONTAINING the prefix is not a mini app's. */
export function isMiniAppPartition(partition: string | undefined): boolean {
  return partition?.startsWith(MINI_APP_PARTITION_PREFIX) ?? false
}

/** Only meaningful for a partition `isMiniAppPartition` accepts. */
export function miniAppIdOfPartition(partition: string): string {
  return partition.slice(MINI_APP_PARTITION_PREFIX.length)
}

/**
 * Everything Chromium stored for this app that no table knows about.
 *
 * The CSP `sandbox` (design §4.2.1) stops the PAGE from writing Web Storage, but once
 * the app is allowed a network domain, cookies and the HTTP cache accumulate in its
 * session anyway — and they are attached to the partition, not to the `mini_app` row,
 * so nothing cascades them. Skipping this makes "reset" and "uninstall" untrue: the
 * server's tracking cookie survives, and a reinstall of the same appId resumes the
 * old identity.
 *
 * CALLERS MUST PREVENT ANY GUEST FROM EXISTING OR ATTACHING FOR THE WHOLE CLEAR — a live
 * one writes straight back into what this just emptied. The requirement is on that
 * property, not on a list of call sites; two things satisfy it:
 *
 *   - holding `withAppQuiesced`, which evicts what is running and vetoes what attaches;
 *   - being startup recovery, which runs before any renderer has drawn a frame and so
 *     before a `<webview>` can attach. It holds no lease and must not: `withAppQuiesced`
 *     would be waiting on runtime state that is not up.
 *
 * Nothing weaker qualifies — "the app has no installation row" in particular does not.
 * Neither `ensurePartition` nor the `will-attach-webview` gate consults one, so a renderer
 * can prepare and attach on any appId it names.
 */
export async function clearMiniAppPartition(appId: string): Promise<void> {
  const sess = session.fromPartition(miniAppPartition(appId))
  await sess.clearStorageData()
  await sess.clearCache()
  // `clearCodeCaches`, plural — the singular does not exist on Session.
  await sess.clearCodeCaches({ urls: [] })
}
