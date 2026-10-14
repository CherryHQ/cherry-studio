/**
 * Sessions whose owner installs its own single-slot session policy.
 *
 * Electron keeps ONE listener per session for `webRequest.onHeadersReceived` and its
 * siblings, so a process-wide pass registering on every session silently replaces
 * whatever that session's owner installed — and neither module can tell, because both
 * calls succeed. Generic hardening consults this and skips; the owner is then the only
 * writer, which is the only arrangement where the policy in force is the one intended.
 *
 * A `WeakSet`, so a session that goes away takes its entry with it and this never becomes
 * a table of dead sessions nothing reclaims.
 */
const selfHardened = new WeakSet<Electron.Session>()

/** Called by the owner as it installs its policy, BEFORE any content loads in the session. */
export function markSelfHardenedSession(session: Electron.Session): void {
  selfHardened.add(session)
}

export function isSelfHardenedSession(session: Electron.Session): boolean {
  return selfHardened.has(session)
}
