import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'

import { parseCherryTopicFile, toImportConversation, validateCherryTopicFileContent } from '../cherryTopicFormat'
import type { ConversationImporter, ImportResult } from '../types'

const logger = loggerService.withContext('CherryTopicImporter')

/**
 * Native single-topic importer for files written by the topic file export.
 * Unlike external importers it preserves snapshots, sibling groups and status
 * verbatim instead of synthesizing them from a source model.
 */
export class CherryTopicImporter implements ConversationImporter {
  readonly name = 'Cherry'
  readonly emoji = '📦'

  validate(fileContent: string): boolean {
    return validateCherryTopicFileContent(fileContent)
  }

  async parse(fileContent: string): Promise<ImportResult> {
    logger.info('Starting Cherry topic import...')
    const file = parseCherryTopicFile(fileContent)
    return {
      conversations: [
        toImportConversation(file, i18n.t('import.cherry.untitled_conversation', { defaultValue: 'Untitled Topic' }))
      ]
    }
  }
}
