type Listener = () => void

/**
 * Create a keyed signal for pub/sub by a string key (e.g., agentId, appId).
 * Follows the same pattern as webviewStateManager.
 */
export function createKeyedSignal() {
  const listeners = new Map<string, Set<Listener>>()

  function subscribe(key: string, listener: Listener): () => void {
    let set = listeners.get(key)
    if (!set) {
      set = new Set()
      listeners.set(key, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (set.size === 0) listeners.delete(key)
    }
  }

  function emit(key: string): void {
    listeners.get(key)?.forEach((cb) => {
      try {
        cb()
      } catch {
        /* listener errors must not break the emit loop */
      }
    })
  }

  return { subscribe, emit }
}
