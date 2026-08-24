export class AsyncInitializer<T> {
  private promise: Promise<T> | null = null
  private factory: (...args: any[]) => Promise<T>

  constructor(factory: (...args: any[]) => Promise<T>) {
    this.factory = factory
  }

  async get(...args: any[]): Promise<T> {
    if (!this.promise) {
      this.promise = this.factory(...args)
    }
    // 如果需要允许重试，可以重置 this.promise 为 null。
    return this.promise
  }
}
