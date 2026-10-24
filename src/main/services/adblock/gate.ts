/**
 * One-slot bridge between the ad blocker and the sessions that already own a
 * `webRequest.onBeforeRequest` listener.
 *
 * Electron keeps a single listener per event per session, and Cherry Studio's
 * browser sessions install their own security policies there. Registering a
 * second listener would silently replace one of them, so the owner handler
 * consults this gate before applying its own policy instead.
 *
 * Until `AdblockService` installs a gate the function answers `false`, which
 * keeps startup order irrelevant.
 */

export type AdblockGate = (details: Electron.OnBeforeRequestListenerDetails) => boolean

let gate: AdblockGate | undefined

export function setAdblockGate(next: AdblockGate | undefined): void {
  gate = next
}

export function isBlockedByAdblock(details: Electron.OnBeforeRequestListenerDetails): boolean {
  if (!gate) return false
  try {
    return gate(details)
  } catch {
    // A broken filter engine must never break browsing.
    return false
  }
}
