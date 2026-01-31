import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import i18n from '@renderer/i18n'
import type { WebSearchProviderResult } from '@renderer/types'
import { sliceByTokens } from 'tokenx'

import type { CompressionContext, ICompressionStrategy } from '../interfaces'

const logger = loggerService.withContext('CutoffCompressionStrategy')

export class CutoffCompressionStrategy implements ICompressionStrategy {
  readonly name = 'cutoff'

  async compress(results: WebSearchProviderResult[], _context: CompressionContext): Promise<WebSearchProviderResult[]> {
    void _context

    if (results.length === 0) {
      return results
    }

    const cutoffLimit = await preferenceService.get('chat.web_search.compression.cutoff_limit')
    const cutoffUnit = await preferenceService.get('chat.web_search.compression.cutoff_unit')

    if (!cutoffLimit) {
      logger.warn('Cutoff limit is not set, skipping compression')
      window.toast.warning({
        timeout: 5000,
        title: i18n.t('settings.tool.websearch.compression.error.cutoff_limit_not_set')
      })
      return results
    }

    const perResultLimit = Math.max(1, Math.floor(cutoffLimit / results.length))

    return results.map((result) => {
      if (cutoffUnit === 'token') {
        const slicedContent = sliceByTokens(result.content, 0, perResultLimit)
        return {
          ...result,
          content: slicedContent.length < result.content.length ? slicedContent + '...' : slicedContent
        }
      }

      return {
        ...result,
        content:
          result.content.length > perResultLimit ? result.content.slice(0, perResultLimit) + '...' : result.content
      }
    })
  }
}
