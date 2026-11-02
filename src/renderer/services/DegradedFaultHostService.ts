type DegradedFaultHandler = (error: unknown) => void

class DegradedFaultHostService {
  private handler: DegradedFaultHandler | null = null

  /** Migration and other preboot windows own this. It must not open a main-window popup. */
  setDegradedFaultHandler(next: DegradedFaultHandler | null): void {
    this.handler = next
  }

  presentDegradedFault(error: unknown): boolean {
    if (!this.handler) return false
    this.handler(error)
    return true
  }
}

export const degradedFaultHostService = new DegradedFaultHostService()
