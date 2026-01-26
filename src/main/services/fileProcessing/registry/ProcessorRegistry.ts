/**
 * Processor Registry
 *
 * Singleton registry for managing file processor registration and lookup.
 * Follows the Open/Closed Principle - new processors can be added without
 * modifying existing code.
 */

import type { IFileProcessor } from '../interfaces'

/**
 * Registry for file processors
 *
 * Provides:
 * - Processor registration and unregistration
 * - Lookup by ID
 * - Availability checking
 */
export class ProcessorRegistry {
  private static instance: ProcessorRegistry | null = null
  private processors: Map<string, IFileProcessor> = new Map()

  private constructor() {}

  /**
   * Get the singleton instance
   */
  static getInstance(): ProcessorRegistry {
    if (!ProcessorRegistry.instance) {
      ProcessorRegistry.instance = new ProcessorRegistry()
    }
    return ProcessorRegistry.instance
  }

  /**
   * Register a processor
   *
   * @throws Error if a processor with the same ID is already registered
   */
  register(processor: IFileProcessor): void {
    if (this.processors.has(processor.id)) {
      throw new Error(`Processor "${processor.id}" is already registered`)
    }
    this.processors.set(processor.id, processor)
  }

  /**
   * Unregister a processor by ID
   *
   * @returns true if the processor was found and removed, false otherwise
   */
  unregister(processorId: string): boolean {
    return this.processors.delete(processorId)
  }

  /**
   * Get a processor by ID
   *
   * @returns The processor if found, undefined otherwise
   */
  get(processorId: string): IFileProcessor | undefined {
    return this.processors.get(processorId)
  }

  /**
   * Get all registered processors that are available
   */
  async getAll(): Promise<IFileProcessor[]> {
    const processors = Array.from(this.processors.values())
    const availability = await Promise.all(processors.map((processor) => processor.isAvailable()))
    return processors.filter((_, index) => availability[index])
  }
}

/**
 * Default processor registry instance
 */
export const processorRegistry = ProcessorRegistry.getInstance()
