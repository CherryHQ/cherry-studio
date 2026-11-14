/** Holds new requests while a regional session changes its inherited proxy. */
export class RegionalProxyGate {
  appliedKey: string | null = null
  private state: 'waiting' | 'ready' | 'blocked' = 'waiting'
  private readonly pending = new Set<(cancel: boolean) => void>()

  constructor(private readonly guestSession: Electron.Session) {
    guestSession.webRequest.onBeforeRequest((_details, callback) => {
      if (this.state !== 'waiting') {
        callback({ cancel: this.state === 'blocked' })
        return
      }
      if (this.pending.size >= 256) {
        callback({ cancel: true })
        return
      }
      const settle = (cancel: boolean) => {
        clearTimeout(timer)
        this.pending.delete(settle)
        callback({ cancel })
      }
      const timer = setTimeout(() => settle(true), 15_000)
      timer.unref()
      this.pending.add(settle)
    })
  }

  wait(): void {
    this.state = 'waiting'
  }

  settle(ready: boolean): void {
    this.state = ready ? 'ready' : 'blocked'
    for (const callback of this.pending) callback(!ready)
  }

  dispose(): void {
    this.settle(false)
    this.guestSession.webRequest.onBeforeRequest((_details, callback) => callback({ cancel: true }))
  }
}
