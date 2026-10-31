import type { WebDbService } from '../database/WebDbService'

/** Electron's WindowManager role in the Worker: deliver main-process broadcasts to the page. */
export interface WebWindowManager {
  broadcast(channel: string, payload: unknown): void
}

interface WebServices {
  DbService: WebDbService
  WindowManager: WebWindowManager
}

/**
 * Browser stand-in for `@application`, aliased in by the Worker build. The data
 * services only resolve `DbService` and `WindowManager` through it.
 */
class WebApplication {
  readonly #services = new Map<keyof WebServices, unknown>()

  register<K extends keyof WebServices>(name: K, instance: WebServices[K]): void {
    this.#services.set(name, instance)
  }

  get<K extends keyof WebServices>(name: K): WebServices[K] {
    const instance = this.#services.get(name)
    if (!instance) throw new Error(`Service "${name}" is not available in the Web Core Worker`)
    return instance as WebServices[K]
  }

  isReady(): boolean {
    return this.#services.has('DbService')
  }
}

export const application = new WebApplication()
