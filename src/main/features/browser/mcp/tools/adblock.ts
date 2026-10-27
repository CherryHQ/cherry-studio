import { application } from '@application'
import { BlockAdsSchema } from '@main/ai/mcp/browserToolDefinitions'
import { isAllowedScope, normalizeDomain } from '@main/services/adblock'

import type { BrowserController } from '../browserController'
import { logger } from '../types'
import { errorResponse, successResponse } from './utils'

/** Host of the page the controller is looking at, or `undefined` when it has no http(s) page. */
async function currentHostname(
  controller: BrowserController,
  privateMode: boolean | undefined,
  tabId: string | undefined
): Promise<string | undefined> {
  const { session } = await controller.getSession(privateMode, tabId)
  const url = session.guest.getURL()
  if (!/^https?:/i.test(url)) return undefined
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

/**
 * Persists an ad-blocking rule the agent derived from the page it is looking
 * at. The service owns validation and compilation; this handler also binds the
 * saved scope to the page the controller actually shows, so a model-supplied
 * domain cannot widen a rule to another site.
 */
export async function handleBlockAds(controller: BrowserController, args: unknown) {
  try {
    const input = BlockAdsSchema.parse(args)
    if (!input.css && !input.urlFilter) {
      return errorResponse('Provide css or urlFilter')
    }
    const service = application.get('AdblockService')
    if (!service.isAiRuleWritingEnabled()) {
      return errorResponse('AI ad rules are turned off in Settings → Browser.')
    }
    const onPage = await currentHostname(controller, input.privateMode, input.tabId)
    if (!onPage) {
      return errorResponse('The current browser tab has no http(s) page to scope the rule to.')
    }
    const domain = normalizeDomain(input.domain)
    if (!isAllowedScope(onPage, domain)) {
      return errorResponse(`Domain ${domain} is not the current page (${onPage}) or its registrable domain.`)
    }
    const result = await service.addCustomRule({
      domain,
      kind: input.css ? 'cosmetic' : 'network',
      value: input.css ?? input.urlFilter!,
      note: input.note,
      source: 'ai'
    })
    // The rule is stored either way, but both layers that consume it are gated
    // by the master switch, so an inactive service means "saved, not yet live".
    const applied = service.isActive()
    return successResponse(
      JSON.stringify({
        id: result.rule.id,
        domain: result.rule.domain,
        kind: result.rule.kind,
        value: result.rule.value,
        applied,
        status: applied ? 'completed' : 'deferred',
        ...(applied
          ? {}
          : { message: 'Rule saved, but ad blocking is off. Turn it on in Settings → Browser to apply it.' }),
        updated: result.existing
      })
    )
  } catch (error) {
    logger.error('Block ads failed', { error })
    return errorResponse(error instanceof Error ? error : String(error))
  }
}
