/** A resource with synchronous, idempotent cleanup. Disposal does not imply cancellation of ongoing work. */
export interface Disposable {
  dispose(): void
}
