import { AnthropicImporter } from './AnthropicImporter'
import { ChatGPTImporter } from './ChatGPTImporter'

/**
 * Registry of all available importers
 * Add new importers here as they are implemented
 */
export const availableImporters = [new ChatGPTImporter(), new AnthropicImporter()] as const
