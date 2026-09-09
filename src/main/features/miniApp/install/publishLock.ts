/**
 * Serializes every publish action for one appId.
 *
 * Install / update / rollback / uninstall all contend for the same three trees and
 * the same journal slot, and each of them is a check-then-act over the filesystem
 * AND the database — two concurrent installs both pass "is this id taken?" before
 * either writes. The database transaction cannot cover this: the conflicting work
 * happens on disk, outside it.
 *
 * A promise chain per appId, not a global lock: two different mini apps have
 * nothing to contend over, and serializing them would make a slow download block
 * an unrelated uninstall.
 */
const chains = new Map<string, Promise<unknown>>()

export function withPublishLock<T>(appId: string, fn: () => Promise<T>): Promise<T> {
  const previous = chains.get(appId) ?? Promise.resolve()
  // Chain off the SETTLEMENT, not the value: a rejected predecessor must not
  // cancel its successors, and must not leave the chain permanently poisoned.
  const next = previous.then(fn, fn)
  chains.set(
    appId,
    next.catch(() => undefined)
  )
  return next
}
