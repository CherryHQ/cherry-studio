/** Raised when Worker code reaches a desktop feature the Web edition leaves out. */
export class WebUnsupportedError extends Error {
  constructor(feature: string) {
    super(`${feature} is not available in the Web edition`)
    this.name = 'WebUnsupportedError'
  }
}

export function unsupported(feature: string): (...args: unknown[]) => never {
  return () => {
    throw new WebUnsupportedError(feature)
  }
}

/** A service-singleton stand-in: calling any of its methods throws. */
export function unsupportedService(feature: string): Record<string, (...args: unknown[]) => never> {
  return new Proxy(
    {},
    {
      // `then` stays undefined so awaiting the object does not throw.
      get: (_, property) =>
        typeof property === 'string' && property !== 'then' ? unsupported(`${feature} (${property})`) : undefined
    }
  )
}

/** A class stand-in whose construction fails, for desktop services the Worker never instantiates. */
export function unsupportedClass(feature: string) {
  return class {
    constructor() {
      throw new WebUnsupportedError(feature)
    }
  }
}
