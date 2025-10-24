import type { PaginationParams, ServiceOptions } from '@shared/data/api/apiTypes'

/**
 * Standard service interface for data operations
 * Defines the contract that all services should implement
 * @template T - Type of the entity returned by service methods
 * @template TCreate - Type of the data required to create a new entity
 * @template TUpdate - Type of the data required to update an existing entity
 */
export interface IBaseService<T = any, TCreate = any, TUpdate = any> {
  /**
   * Find entity by ID
   */
  findById(id: string, options?: ServiceOptions): Promise<T | null>

  /**
   * Find multiple entities with pagination
   */
  findMany(
    params: PaginationParams & Record<string, any>,
    options?: ServiceOptions
  ): Promise<{
    items: T[]
    total: number
    hasNext?: boolean
    nextCursor?: string
  }>

  /**
   * Create new entity
   */
  create(data: TCreate, options?: ServiceOptions): Promise<T>

  /**
   * Update existing entity
   */
  update(id: string, data: TUpdate, options?: ServiceOptions): Promise<T>

  /**
   * Delete entity (hard or soft delete depending on implementation)
   */
  delete(id: string, options?: ServiceOptions): Promise<void>

  /**
   * Check if entity exists
   */
  exists(id: string, options?: ServiceOptions): Promise<boolean>
}

/**
 * Extended service interface for soft delete operations
 */
export interface ISoftDeleteService<T = any, TCreate = any, TUpdate = any> extends IBaseService<T, TCreate, TUpdate> {
  /**
   * Archive entity (soft delete)
   */
  archive(id: string, options?: ServiceOptions): Promise<T | void>

  /**
   * Restore archived entity
   */
  restore(id: string, options?: ServiceOptions): Promise<T | void>
}

/**
 * Extended service interface for search operations
 */
export interface ISearchableService<T = any, TCreate = any, TUpdate = any> extends IBaseService<T, TCreate, TUpdate> {
  /**
   * Search entities by query
   */
  search(
    query: string,
    params?: PaginationParams,
    options?: ServiceOptions
  ): Promise<{
    items: T[]
    total: number
    hasNext?: boolean
    nextCursor?: string
  }>
}

/**
 * Service interface for hierarchical data (parent-child relationships)
 */
export interface IHierarchicalService<TParent = any, TChild = any, TChildCreate = any> extends IBaseService<TParent> {
  /**
   * Get child entities for a parent
   */
  getChildren(
    parentId: string,
    params?: PaginationParams,
    options?: ServiceOptions
  ): Promise<{
    items: TChild[]
    total: number
    hasNext?: boolean
    nextCursor?: string
  }>

  /**
   * Add child entity to parent
   */
  addChild(parentId: string, childData: TChildCreate, options?: ServiceOptions): Promise<TChild>

  /**
   * Remove child entity from parent
   */
  removeChild(parentId: string, childId: string, options?: ServiceOptions): Promise<void>
}
