/**
 * Processor Registry
 *
 * Singleton registry for managing file processor registration and lookup.
 * Follows the Open/Closed Principle - new processors can be added without
 * modifying existing code.
 */

import type { FileProcessorFeature, FileProcessorInput } from '@shared/data/presets/fileProcessing'

import type { IFileProcessor } from '../interfaces'

/**
 * Registry for file processors
 *
 * Provides:
 * - Processor registration and unregistration
 * - Lookup by ID
 * - Lookup by capability (feature + input type)
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
   * Find all processors that support a given feature and input type
   *
   * @returns Array of processors supporting the capability
   */
  findByCapability(feature: FileProcessorFeature, inputType: FileProcessorInput): IFileProcessor[] {
    return Array.from(this.processors.values()).filter((p) => p.supports(feature, inputType))
  }

  /**
   * Check if a processor is available
   *
   * @returns true if the processor exists and is available, false otherwise
   */
  async isAvailable(processorId: string): Promise<boolean> {
    const processor = this.processors.get(processorId)
    return processor ? processor.isAvailable() : false
  }

  /**
   * Get all registered processors
   */
  getAll(): IFileProcessor[] {
    return Array.from(this.processors.values())
  }

  /**
   * Get all registered processor IDs
   */
  getAllIds(): string[] {
    return Array.from(this.processors.keys())
  }

  /**
   * Check if a processor is registered
   */
  has(processorId: string): boolean {
    return this.processors.has(processorId)
  }

  /**
   * Get the number of registered processors
   */
  get size(): number {
    return this.processors.size
  }

  /**
   * @internal Testing only - reset the singleton instance
   */
  static _resetForTesting(): void {
    ProcessorRegistry.instance = null
  }
}

/**
 * Default processor registry instance
 */
export const processorRegistry = ProcessorRegistry.getInstance()
