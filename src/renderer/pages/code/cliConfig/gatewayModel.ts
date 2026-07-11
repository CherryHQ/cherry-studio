import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import { formatGatewayModelId } from '@shared/types/apiGateway'

/**
 * The gateway-addressed model string ("providerId:apiModelId") for a stored real `UniqueModelId`,
 * used by the connection-match sides so the value they compare against a written config is identical
 * to what {@link resolveContext} writes. Pass the model's `apiModelId` (from the model record) when
 * available; falls back to the raw model id. Returns `undefined` for a missing/invalid id or a
 * non-gateway-routable model, so the matcher simply skips the model check rather than throwing.
 */
export function gatewayExpectedModel(
  uniqueModelId: string | null | undefined,
  apiModelId?: string
): string | undefined {
  if (!uniqueModelId || !isUniqueModelId(uniqueModelId)) return undefined
  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  try {
    return formatGatewayModelId(providerId, apiModelId ?? modelId)
  } catch {
    return undefined
  }
}
