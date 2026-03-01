import { ChatGPTImporter } from './ChatGPTImporter'
import { ClaudeImporter } from './ClaudeImporter'

/**
 * Export all available importers
 */
export { ChatGPTImporter, ClaudeImporter }

/**
 * Registry of all available importers
 * Add new importers here as they are implemented
 */
export const availableImporters = [new ChatGPTImporter(), new ClaudeImporter()] as const
