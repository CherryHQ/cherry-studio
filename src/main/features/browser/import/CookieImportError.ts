import type { BrowserImportReason } from '@shared/ipc/schemas/browserImport'

export class CookieImportError extends Error {
  constructor(readonly reason: BrowserImportReason) {
    super(reason)
    this.name = 'CookieImportError'
  }
}
