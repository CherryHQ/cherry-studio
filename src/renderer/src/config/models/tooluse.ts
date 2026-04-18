import type { Model } from '@renderer/types'
import { isUserSelectedModelType } from '@renderer/utils'
import { isFunctionCallingModel as sharedIsFunctionCallingModel } from '@shared/utils/model'

import { toSharedCompatModel } from './_bridge'

/**
 * Function-calling / tool-use check.
 *
 * Reads shared's `FUNCTION_CALL` capability — populated by the registry /
 * bridge from `inferFunctionCallingFromModelId`. The capability already
 * encodes exclusions (embedding / rerank / text-to-image SKUs don't match
 * the regex), so no extra guardrails are needed at the call site.
 */
export function isFunctionCallingModel(model?: Model): boolean {
  if (!model) return false
  const override = isUserSelectedModelType(model, 'function_calling')
  if (override !== undefined) return override
  return sharedIsFunctionCallingModel(toSharedCompatModel(model))
}
