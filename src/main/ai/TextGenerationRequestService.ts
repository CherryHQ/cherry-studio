import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

@Injectable('TextGenerationRequestService')
@ServicePhase(Phase.WhenReady)
export class TextGenerationRequestService extends BaseService {
  private readonly controllers = new Map<string, AbortController>()

  protected async onInit() {
    this.registerDisposable(() => {
      for (const controller of this.controllers.values()) {
        controller.abort()
      }
      this.controllers.clear()
    })
  }

  async run<T>(requestId: string, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.controllers.has(requestId)) {
      throw new Error(`Request already in flight: ${requestId}`)
    }

    const controller = new AbortController()
    let onAbort: (() => void) | undefined
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(controller.signal.reason ?? new DOMException('The operation was aborted', 'AbortError'))
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })

    this.controllers.set(requestId, controller)
    try {
      return await Promise.race([operation(controller.signal), aborted])
    } finally {
      if (onAbort) controller.signal.removeEventListener('abort', onAbort)
      if (this.controllers.get(requestId) === controller) {
        this.controllers.delete(requestId)
      }
    }
  }

  abort(requestId: string): void {
    this.controllers.get(requestId)?.abort()
  }
}
