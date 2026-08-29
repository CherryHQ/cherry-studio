/**
 * The one error class with no domain of its own.
 *
 * The other three live where their subject does — `PermissionDeniedError` with grants,
 * `QuotaExceededError` with quotas, `MiniAppQuiescingError` with the runtime. "The
 * caller passed something wrong" belongs to the bridge, but the bridge comes
 * AFTER the capabilities that throw it, so it cannot be the home. Hence one small file,
 * early enough for every thrower to import.
 */
export class InvalidArgumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidArgumentError'
  }
}

/**
 * A timeout, a dead host, a stream that never ends — the host cannot provide the
 * capability right now. Maps to the frozen public `Unavailable` (design §6.0); it does
 * NOT reuse `MiniAppQuiescingError`, which means something else entirely (this app is
 * being taken offline) and whose branch would start lying.
 */
export class MiniAppUnavailableError extends Error {
  /**
   * `options.cause` carries what actually failed, for the USER's activity log. It never
   * reaches the guest: `publicErrorOf` builds the guest's answer from the class and this
   * `message` alone, and both are written to disclose nothing about the host's setup.
   */
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MiniAppUnavailableError'
  }
}
