class LinkNode<K, V> {
  key: K
  value: V
  prev: LinkNode<K, V> | null = null
  next: LinkNode<K, V> | null = null
  accessTime: number

  constructor(key: K, value: V) {
    this.key = key
    this.value = value
    this.accessTime = Date.now()
  }
}

interface LRUCacheOptions<K, V> {
  max?: number
  ttl?: number
  dispose?: (value: V, key: K) => void
  onInsert?: () => void
  updateAgeOnGet?: boolean
  updateAgeOnHas?: boolean
}

export class LRUCache<K, V> {
  public readonly capacity: number
  private readonly cache = new Map<K, LinkNode<K, V>>()
  private readonly ttl?: number
  private readonly updateAgeOnGet: boolean
  private readonly updateAgeOnHas: boolean

  private readonly dispose?: (value: V, key: K) => void
  private readonly onInsert?: () => void

  private readonly head: LinkNode<K, V>
  private readonly tail: LinkNode<K, V>

  private cleanupTimer?: NodeJS.Timeout

  constructor(options: LRUCacheOptions<K, V> = {}) {
    this.capacity = this.validateCapacity(options.max ?? 0)
    this.ttl = options.ttl
    this.updateAgeOnGet = options.updateAgeOnGet ?? false
    this.updateAgeOnHas = options.updateAgeOnHas ?? false
    this.dispose = options.dispose
    this.onInsert = options.onInsert

    this.head = new LinkNode<K, V>(null as any, null as any)
    this.tail = new LinkNode<K, V>(null as any, null as any)
    this.initializeLinkedList()

    if (this.ttl) {
      this.startCleanupTimer()
    }
  }

  get(key: K): V | undefined {
    const node = this.cache.get(key)
    if (!node || this.isExpired(node)) {
      this.handleExpiredNode(key, node)
      return undefined
    }

    if (this.updateAgeOnGet) {
      node.accessTime = Date.now()
    }

    this.moveToFront(node)
    return node.value
  }

  set(key: K, value: V): this {
    const existingNode = this.cache.get(key)

    if (existingNode) {
      this.updateExistingNode(existingNode, value)
    } else {
      this.insertNewNode(key, value)
    }

    return this
  }

  has(key: K): boolean {
    const node = this.cache.get(key)
    if (!node || this.isExpired(node)) {
      this.handleExpiredNode(key, node)
      return false
    }
    if (this.updateAgeOnHas) {
      node.accessTime = Date.now()
    }
    this.moveToFront(node)
    return true
  }

  delete(key: K): boolean {
    const node = this.cache.get(key)
    if (!node) return false

    this.removeNodeFromCache(node)
    return true
  }

  clear(): void {
    this.disposeAllNodes()
    this.cache.clear()
    this.initializeLinkedList()
    this.stopCleanupTimer()
  }

  keys(): IterableIterator<K> {
    this.cleanupExpiredNodes()
    return this.cache.keys()
  }

  get size(): number {
    this.cleanupExpiredNodes()
    return this.cache.size
  }

  get values(): V[] {
    this.cleanupExpiredNodes()
    return this.collectLinkedListValues()
  }

  get entries(): [K, V][] {
    this.cleanupExpiredNodes()
    return this.collectLinkedListEntries()
  }

  // 初始化和验证方法
  private validateCapacity(capacity: number): number {
    if (capacity <= 0) {
      throw new Error('Capacity must be a positive number')
    }
    return capacity
  }

  private initializeLinkedList(): void {
    this.head.next = this.tail
    this.tail.prev = this.head
  }

  private updateExistingNode(node: LinkNode<K, V>, value: V): void {
    node.value = value
    node.accessTime = Date.now()
    this.moveToFront(node)
  }

  private insertNewNode(key: K, value: V): void {
    const newNode = new LinkNode(key, value)
    this.cache.set(key, newNode)
    this.addToFront(newNode)

    this.onInsert?.()
    this.evictIfNecessary()
  }

  private evictIfNecessary(): void {
    if (this.cache.size > this.capacity) {
      const lruNode = this.tail.prev!
      this.removeNodeFromCache(lruNode)
    }
  }

  private removeNodeFromCache(node: LinkNode<K, V>): void {
    this.removeFromLinkedList(node)
    this.cache.delete(node.key)
    this.dispose?.(node.value, node.key)
  }

  // 链表操作方法
  private moveToFront(node: LinkNode<K, V>): void {
    this.removeFromLinkedList(node)
    this.addToFront(node)
  }

  private addToFront(node: LinkNode<K, V>): void {
    const nextNode = this.head.next!
    node.next = nextNode
    node.prev = this.head
    nextNode.prev = node
    this.head.next = node
  }

  private removeFromLinkedList(node: LinkNode<K, V>): void {
    node.prev!.next = node.next
    node.next!.prev = node.prev
  }

  // TTL 相关方法
  private isExpired(node: LinkNode<K, V>): boolean {
    return this.ttl !== undefined && Date.now() - node.accessTime > this.ttl
  }

  private handleExpiredNode(key: K, node?: LinkNode<K, V>): void {
    if (node) {
      this.delete(key)
    }
  }

  private startCleanupTimer(): void {
    if (!this.ttl) return

    const interval = Math.max(1000, this.ttl / 4)
    this.cleanupTimer = setTimeout(() => {
      this.cleanupExpiredNodes()
      this.startCleanupTimer()
    }, interval)
  }

  private stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer)
      this.cleanupTimer = undefined
    }
  }

  private cleanupExpiredNodes(): void {
    if (!this.ttl) return

    const now = Date.now()
    const expiredKeys: K[] = []

    for (const [key, node] of this.cache) {
      if (now - node.accessTime > this.ttl) {
        expiredKeys.push(key)
      }
    }

    expiredKeys.forEach((key) => this.delete(key))
  }

  private collectLinkedListValues(): V[] {
    const values: V[] = []
    let current = this.head.next

    while (current && current !== this.tail) {
      values.push(current.value)
      current = current.next
    }

    return values
  }

  private collectLinkedListEntries(): [K, V][] {
    const entries: [K, V][] = []
    let current = this.head.next

    while (current && current !== this.tail) {
      entries.push([current.key, current.value])
      current = current.next
    }

    return entries
  }

  private disposeAllNodes(): void {
    if (!this.dispose) return

    for (const [key, node] of this.cache) {
      this.dispose(node.value, key)
    }
  }
}
