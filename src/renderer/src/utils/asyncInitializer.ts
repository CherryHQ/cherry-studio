export class AsyncInitializer<T> {
  private promise: Promise<T> | null = null
  private factory: () => Promise<T>

  constructor(factory: () => Promise<T>) {
    this.factory = factory
  }

  async get(): Promise<T> {
    if (!this.promise) {
      this.promise = this.factory()
    }
    // 如果需要允许重试，可以重置 this.promise 为 null。
    return this.promise
  }
}
