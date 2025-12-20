import { ChatBoxImporter } from './ChatBoxImporter'
import { ChatGPTImporter } from './ChatGPTImporter'

/**
 * Export all available importers
 */
export { ChatBoxImporter, ChatGPTImporter }

/**
 * Registry of all available importers
 * Add new importers here as they are implemented
 */
export const availableImporters = [new ChatGPTImporter(), new ChatBoxImporter()] as const
