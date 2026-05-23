import { ChatgptImporter } from './ChatgptImporter'

/**
 * Export all available importers
 */
export { ChatgptImporter }

/**
 * Registry of all available importers
 * Add new importers here as they are implemented
 */
export const availableImporters = [new ChatgptImporter()] as const
