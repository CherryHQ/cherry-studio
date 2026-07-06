import type { Model } from '@shared/data/types/model'
import { isFunctionCallingModel as sharedIsFunctionCallingModel } from '@shared/utils/model'

/**
 * Function-calling / tool-use check.
 *
 * Reads shared's `FUNCTION_CALL` capability. v2 `Model.capabilities` is
 * authoritative — registry inference plus baked-in user overrides
 * (`userOverrides`) are merged by `ModelService`, so there is no separate
 * renderer-side override branch. The capability already encodes exclusions
 * (embedding / rerank / text-to-image SKUs don't match), so no extra
 * guardrails are needed at the call site.
 */
export function isFunctionCallingModel(model?: Model): boolean {
  if (!model) return false
  return sharedIsFunctionCallingModel(model)
}
