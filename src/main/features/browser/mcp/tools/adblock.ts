import { application } from '@application'
import { BlockAdsSchema } from '@main/ai/mcp/browserToolDefinitions'

import type { BrowserController } from '../browserController'
import { logger } from '../types'
import { errorResponse, successResponse } from './utils'

/**
 * Persists an ad-blocking rule the agent derived from the page it is looking
 * at. The service owns validation and compilation; this handler only maps the
 * tool arguments onto that API.
 */
export async function handleBlockAds(_controller: BrowserController, args: unknown) {
  try {
    const input = BlockAdsSchema.parse(args)
    if (!input.css && !input.urlFilter) {
      return errorResponse('Provide css or urlFilter')
    }
    const service = application.get('AdblockService')
    if (!service.isAiRuleWritingEnabled()) {
      return errorResponse('AI ad rules are turned off in Settings → Browser.')
    }
    const result = await service.addCustomRule({
      domain: input.domain,
      kind: input.css ? 'cosmetic' : 'network',
      value: input.css ?? input.urlFilter!,
      note: input.note,
      source: 'ai'
    })
    return successResponse(
      JSON.stringify({
        id: result.rule.id,
        domain: result.rule.domain,
        kind: result.rule.kind,
        value: result.rule.value,
        applied: true,
        updated: result.existing
      })
    )
  } catch (error) {
    logger.error('Block ads failed', { error })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
