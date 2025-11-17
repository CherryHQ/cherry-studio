import { loggerService } from '@logger'

const logger = loggerService.withContext('TestService')

/**
 * Test service for API testing scenarios
 * Provides mock data and various test cases for comprehensive API testing
 */
export class TestService {
  private static instance: TestService
  private testItems: any[] = []
  private nextId = 1

  private constructor() {
    this.initializeMockData()
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): TestService {
    if (!TestService.instance) {
      TestService.instance = new TestService()
    }
    return TestService.instance
  }

  /**
   * Initialize mock test data
   */
  private initializeMockData() {
    // Initialize test items with various types
    for (let i = 1; i <= 20; i++) {
      this.testItems.push({
        id: `test-item-${i}`,
        title: `Test Item ${i}`,
        description: `This is test item ${i} for comprehensive API testing`,
        type: ['data', 'config', 'user', 'system'][i % 4],
        status: ['active', 'inactive', 'pending', 'archived'][i % 4],
        priority: ['low', 'medium', 'high'][i % 3],
        tags: [`tag${(i % 3) + 1}`, `category${(i % 2) + 1}`],
        createdAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: new Date(Date.now() - i * 12 * 60 * 60 * 1000).toISOString(),
        metadata: {
          version: `1.${i % 10}.0`,
          size: Math.floor(Math.random() * 1000) + 100,
          author: `TestUser${(i % 5) + 1}`
        }
      })
    }

    this.nextId = 100
    logger.info('Mock test data initialized', {
      itemCount: this.testItems.length,
      types: ['data', 'config', 'user', 'system'],
      statuses: ['active', 'inactive', 'pending', 'archived']
    })
  }

  /**
   * Generate new test ID
   */
  private generateId(prefix: string = 'test-item'): string {
    return `${prefix}-${this.nextId++}`
  }

  /**
   * Simulate network delay for realistic testing
   */
  private async simulateDelay(min = 100, max = 500): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min
    await new Promise((resolve) => setTimeout(resolve, delay))
  }

  /**
   * Get paginated list of test items
   */
  async getItems(
    params: { page?: number; limit?: number; type?: string; status?: string; search?: string } = {}
  ): Promise<{
    items: any[]
    total: number
    page: number
    pageCount: number
    hasNext: boolean
    hasPrev: boolean
  }> {
    await this.simulateDelay()

    const { page = 1, limit = 20, type, status, search } = params
    let filteredItems = [...this.testItems]

    // Apply filters
    if (type) {
      filteredItems = filteredItems.filter((item) => item.type === type)
    }
    if (status) {
      filteredItems = filteredItems.filter((item) => item.status === status)
    }
    if (search) {
      const searchLower = search.toLowerCase()
      filteredItems = filteredItems.filter(
        (item) => item.title.toLowerCase().includes(searchLower) || item.description.toLowerCase().includes(searchLower)
      )
    }

    // Apply pagination
    const startIndex = (page - 1) * limit
    const items = filteredItems.slice(startIndex, startIndex + limit)
    const total = filteredItems.length
    const pageCount = Math.ceil(total / limit)

    logger.debug('Retrieved test items', {
      page,
      limit,
      filters: { type, status, search },
      total,
      itemCount: items.length
    })

    return {
      items,
      total,
      page,
      pageCount,
      hasNext: startIndex + limit < total,
      hasPrev: page > 1
    }
  }

  /**
   * Get single test item by ID
   */
  async getItemById(id: string): Promise<any | null> {
    await this.simulateDelay()

    const item = this.testItems.find((item) => item.id === id)

    if (!item) {
      logger.warn('Test item not found', { id })
      return null
    }

    logger.debug('Retrieved test item by ID', { id, title: item.title })
    return item
  }

  /**
   * Create new test item
   */
  async createItem(data: {
    title: string
    description?: string
    type?: string
    status?: string
    priority?: string
    tags?: string[]
    metadata?: Record<string, any>
  }): Promise<any> {
    await this.simulateDelay()

    const newItem = {
      id: this.generateId(),
      title: data.title,
      description: data.description || '',
      type: data.type || 'data',
      status: data.status || 'active',
      priority: data.priority || 'medium',
      tags: data.tags || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        version: '1.0.0',
        size: Math.floor(Math.random() * 1000) + 100,
        author: 'TestUser',
        ...data.metadata
      }
    }

    this.testItems.unshift(newItem)
    logger.info('Created new test item', { id: newItem.id, title: newItem.title })

    return newItem
  }

  /**
   * Update existing test item
   */
  async updateItem(
    id: string,
    data: Partial<{
      title: string
      description: string
      type: string
      status: string
      priority: string
      tags: string[]
      metadata: Record<string, any>
    }>
  ): Promise<any | null> {
    await this.simulateDelay()

    const itemIndex = this.testItems.findIndex((item) => item.id === id)

    if (itemIndex === -1) {
      logger.warn('Test item not found for update', { id })
      return null
    }

    const updatedItem = {
      ...this.testItems[itemIndex],
      ...data,
      updatedAt: new Date().toISOString(),
      metadata: {
        ...this.testItems[itemIndex].metadata,
        ...data.metadata
      }
    }

    this.testItems[itemIndex] = updatedItem
    logger.info('Updated test item', { id, changes: Object.keys(data) })

    return updatedItem
  }

  /**
   * Delete test item
   */
  async deleteItem(id: string): Promise<boolean> {
    await this.simulateDelay()

    const itemIndex = this.testItems.findIndex((item) => item.id === id)

    if (itemIndex === -1) {
      logger.warn('Test item not found for deletion', { id })
      return false
    }

    this.testItems.splice(itemIndex, 1)
    logger.info('Deleted test item', { id })

    return true
  }

  /**
   * Get test statistics
   */
  async getStats(): Promise<{
    total: number
    byType: Record<string, number>
    byStatus: Record<string, number>
    byPriority: Record<string, number>
    recentActivity: Array<{
      date: string
      count: number
    }>
  }> {
    await this.simulateDelay()

    const byType: Record<string, number> = {}
    const byStatus: Record<string, number> = {}
    const byPriority: Record<string, number> = {}

    this.testItems.forEach((item) => {
      byType[item.type] = (byType[item.type] || 0) + 1
      byStatus[item.status] = (byStatus[item.status] || 0) + 1
      byPriority[item.priority] = (byPriority[item.priority] || 0) + 1
    })

    // Generate recent activity (mock data)
    const recentActivity: Array<{ date: string; count: number }> = []
    for (let i = 6; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      recentActivity.push({
        date,
        count: Math.floor(Math.random() * 10) + 1
      })
    }

    const stats = {
      total: this.testItems.length,
      byType,
      byStatus,
      byPriority,
      recentActivity
    }

    logger.debug('Retrieved test statistics', stats)
    return stats
  }

  /**
   * Bulk operations on test items
   */
  async bulkOperation(
    operation: 'create' | 'update' | 'delete',
    data: any[]
  ): Promise<{
    successful: number
    failed: number
    errors: string[]
  }> {
    await this.simulateDelay(200, 800)

    let successful = 0
    let failed = 0
    const errors: string[] = []

    for (const item of data) {
      try {
        switch (operation) {
          case 'create':
            await this.createItem(item)
            successful++
            break
          case 'update': {
            const updated = await this.updateItem(item.id, item)
            if (updated) successful++
            else {
              failed++
              errors.push(`Item not found: ${item.id}`)
            }
            break
          }
          case 'delete': {
            const deleted = await this.deleteItem(item.id)
            if (deleted) successful++
            else {
              failed++
              errors.push(`Item not found: ${item.id}`)
            }
            break
          }
        }
      } catch (error) {
        failed++
        errors.push(`Error processing item: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }

    logger.info('Completed bulk operation', { operation, successful, failed, errorCount: errors.length })

    return { successful, failed, errors }
  }

  /**
   * Search test items
   */
  async searchItems(
    query: string,
    options: {
      page?: number
      limit?: number
      filters?: Record<string, any>
    } = {}
  ): Promise<{
    items: any[]
    total: number
    page: number
    pageCount: number
    hasNext: boolean
    hasPrev: boolean
  }> {
    await this.simulateDelay()

    const { page = 1, limit = 20, filters = {} } = options
    const queryLower = query.toLowerCase()

    const results = this.testItems.filter((item) => {
      // Text search
      const matchesQuery =
        item.title.toLowerCase().includes(queryLower) ||
        item.description.toLowerCase().includes(queryLower) ||
        item.tags.some((tag: string) => tag.toLowerCase().includes(queryLower))

      // Apply additional filters
      let matchesFilters = true
      Object.entries(filters).forEach(([key, value]) => {
        if (value && item[key] !== value) {
          matchesFilters = false
        }
      })

      return matchesQuery && matchesFilters
    })

    // Apply pagination
    const startIndex = (page - 1) * limit
    const items = results.slice(startIndex, startIndex + limit)
    const total = results.length
    const pageCount = Math.ceil(total / limit)

    logger.debug('Search completed', { query, total, itemCount: items.length })

    return {
      items,
      total,
      page,
      pageCount,
      hasNext: startIndex + limit < total,
      hasPrev: page > 1
    }
  }

  /**
   * Simulate error scenarios for testing
   */
  async simulateError(errorType: string): Promise<never> {
    await this.simulateDelay()

    logger.warn('Simulating error scenario', { errorType })

    switch (errorType) {
      case 'timeout':
        await new Promise((resolve) => setTimeout(resolve, 35000))
        throw new Error('Request timeout')
      case 'network':
        throw new Error('Network connection failed')
      case 'server':
        throw new Error('Internal server error (500)')
      case 'notfound':
        throw new Error('Resource not found (404)')
      case 'validation':
        throw new Error('Validation failed: Invalid input data')
      case 'unauthorized':
        throw new Error('Unauthorized access (401)')
      case 'ratelimit':
        throw new Error('Rate limit exceeded (429)')
      default:
        throw new Error('Generic test error occurred')
    }
  }

  /**
   * Reset all test data to initial state
   */
  async resetData(): Promise<void> {
    await this.simulateDelay()

    this.testItems = []
    this.nextId = 1
    this.initializeMockData()

    logger.info('Test data reset to initial state')
  }
}
