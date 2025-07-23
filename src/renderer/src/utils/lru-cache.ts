class LinkNode<K, V> {
  key: K
  value: V
  prev: LinkNode<K, V> | null
  next: LinkNode<K, V> | null
  accessTime: number

  constructor(key: K, value: V) {
    this.key = key
    this.value = value
    this.prev = null
    this.next = null
    this.accessTime = Date.now()
  }
}

interface LRUCacheOptions<K, V> {
  max?: number
  ttl?: number
  dispose?: (value: V, key: K) => void
  disposeAfter?: () => void
  onInsert?: () => void
  updateAgeOnGet?: boolean
}

/**
 * LRU 缓存
 * @param {LRUCacheOptions} options - 缓存选项
 * @param {number} options.capacity - 缓存的最大容量
 * @param {number} options.ttl - 过期时间（毫秒）
 */
export class LRUCache<K, V> {
  public capacity: number
  private cache: Map<K, LinkNode<K, V>>
  private ttl?: number
  private updateAgeOnGet: boolean

  // 回调函数
  private disposeCallback?: (value: V, key: K) => void
  private disposeAfter?: () => void
  private onInsert?: () => void

  // 双向链表的头尾节点
  // head.next 是最新使用的节点，tail.prev 是最久未使用的节点
  private head: LinkNode<K, V>
  private tail: LinkNode<K, V>

  // TTL 清理定时器
  private cleanupTimer?: ReturnType<typeof setTimeout>

  constructor(options: LRUCacheOptions<K, V> = {}) {
    const capacity = options.max ?? 0
    if (capacity <= 0) {
      throw new Error('Capacity must be a positive number')
    }

    this.capacity = capacity
    this.cache = new Map<K, LinkNode<K, V>>()
    this.ttl = options.ttl
    this.updateAgeOnGet = options.updateAgeOnGet ?? true

    // 可选的回调函数
    this.disposeAfter = options.disposeAfter
    this.disposeCallback = options.dispose
    this.onInsert = options.onInsert

    // 初始化头尾节点
    this.head = new LinkNode<K, V>(null as any, null as any)
    this.tail = new LinkNode<K, V>(null as any, null as any)
    // 构建双向链表
    this.head.next = this.tail
    this.tail.prev = this.head

    // 如果设置了 TTL，启动定期清理
    if (this.ttl) {
      this.startCleanupTimer()
    }
  }

  get(key: K): V | undefined {
    const node = this.cache.get(key)
    if (!node) return undefined

    // 检查 TTL 过期
    if (this.ttl && Date.now() - node.accessTime > this.ttl) {
      this.delete(key)
      return undefined
    }

    // 更新访问时间
    if (this.updateAgeOnGet) {
      node.accessTime = Date.now()
    }

    // 将节点移动到链表的头部（最新使用）
    this.moveToFront(node)

    return node.value
  }

  set(key: K, value: V): this {
    let node = this.cache.get(key)
    if (node) {
      node.value = value
      node.accessTime = Date.now()
      this.moveToFront(node)
    } else {
      node = new LinkNode(key, value)
      this.cache.set(key, node)
      this.addToFront(node)

      // 触发 onInsert 回调
      if (this.onInsert) {
        this.onInsert()
      }

      // 如果超出容量，移除最久未使用的节点
      if (this.cache.size > this.capacity) {
        const lruNode = this.tail.prev!
        this.removeNode(lruNode)
        this.cache.delete(lruNode.key)

        // 触发 dispose 回调
        if (this.disposeCallback) {
          this.disposeCallback(lruNode.value, lruNode.key)
        }
      }
    }
    return this
  }

  has(key: K): boolean {
    const node = this.cache.get(key)
    if (!node) return false

    // 检查 TTL 过期
    if (this.ttl && Date.now() - node.accessTime > this.ttl) {
      this.delete(key)
      return false
    }

    return true
  }

  delete(key: K): boolean {
    const node = this.cache.get(key)
    if (!node) return false

    this.removeNode(node)
    this.cache.delete(key)

    // 触发 dispose 回调
    if (this.disposeCallback) {
      this.disposeCallback(node.value, node.key)
    }

    // 触发 disposeAfter 回调
    if (this.disposeAfter) {
      this.disposeAfter()
    }

    return true
  }

  clear(): void {
    // 触发所有节点的 dispose 回调
    if (this.disposeCallback) {
      for (const [key, node] of this.cache) {
        this.disposeCallback(node.value, key)
      }
    }

    this.cache.clear()
    this.head.next = this.tail
    this.tail.prev = this.head

    // 清理定时器
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
  }

  // 兼容 lru-cache 的 keys() 方法
  keys(): IterableIterator<K> {
    this.cleanupExpired()
    return this.cache.keys()
  }

  private moveToFront(node: LinkNode<K, V>) {
    this.removeNode(node)
    this.addToFront(node)
  }

  private addToFront(node: LinkNode<K, V>): void {
    node.next = this.head.next
    node.prev = this.head
    this.head.next!.prev = node
    this.head.next = node
  }

  private removeNode(node: LinkNode<K, V>): void {
    node.prev!.next = node.next
    node.next!.prev = node.prev
  }

  private startCleanupTimer(): void {
    if (!this.ttl) return

    // 每 TTL/4 的时间清理一次过期项，最少 1 秒
    const interval = Math.max(1000, this.ttl / 4)

    this.cleanupTimer = setTimeout(() => {
      this.cleanupExpired()
      this.startCleanupTimer() // 递归设置下一次清理
    }, interval)
  }

  private cleanupExpired(): void {
    if (!this.ttl) return

    const now = Date.now()
    const keysToDelete: K[] = []

    for (const [key, node] of this.cache) {
      if (now - node.accessTime > this.ttl) {
        keysToDelete.push(key)
      }
    }

    for (const key of keysToDelete) {
      this.delete(key)
    }
  }

  get size(): number {
    this.cleanupExpired()
    return this.cache.size
  }

  get values(): V[] {
    this.cleanupExpired()
    return Array.from(this.cache.values()).map((node) => node.value)
  }

  get entries(): [K, V][] {
    this.cleanupExpired()
    return Array.from(this.cache.entries()).map(([key, node]) => [key, node.value])
  }

  // 销毁缓存，清理所有资源
  dispose(): void {
    this.clear()
  }
}
