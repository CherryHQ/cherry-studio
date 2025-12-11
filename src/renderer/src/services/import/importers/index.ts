import { ChatGPTImporter } from './ChatGPTImporter'
import { GeminiImporter } from './GeminiImporter'

/**
 * Export all available importers
 */
export { ChatGPTImporter, GeminiImporter }

/**
 * Registry of all available importers
 * Add new importers here as they are implemented
 */
export const availableImporters = [new ChatGPTImporter(), new GeminiImporter()] as const
