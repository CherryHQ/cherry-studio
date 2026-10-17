export class AsyncInitializer<T> {
  private promise: Promise<T> | null = null
  private factory: (...args: any[]) => Promise<T>

  constructor(factory: (...args: any[]) => Promise<T>) {
    this.factory = factory
  }

  /** Returns the factory's cached promise; synchronous throws reject without being cached. */
  get(...args: any[]): Promise<T> {
    try {
      return (this.promise ??= this.factory(...args))
    } catch (error) {
      return Promise.reject(error)
    }
  }
}
