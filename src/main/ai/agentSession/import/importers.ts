import { DeepSeekImporter } from './DeepSeekImporter'
import type { ConversationImporter } from './types'

const defaultImporter = new DeepSeekImporter()
const importers: readonly ConversationImporter[] = [defaultImporter]

export function getConversationImporter(id = defaultImporter.id): ConversationImporter {
  const importer = importers.find((item) => item.id === id)
  if (!importer) throw new Error(`Unsupported conversation importer: ${id}`)
  return importer
}
