export class BackupCancelledError extends Error {
  constructor() {
    super('Backup operation cancelled')
    this.name = 'BackupCancelledError'
  }
}

export class CancellationToken {
  private _cancelled = false

  get isCancelled(): boolean {
    return this._cancelled
  }

  cancel(): void {
    this._cancelled = true
  }

  throwIfCancelled(): void {
    if (this._cancelled) throw new BackupCancelledError()
  }
}
