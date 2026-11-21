import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { ApiKeyEntry } from '@shared/data/types/provider'
import { CLI_API_GATEWAY_PROVIDER_NAME, isApiGatewayProviderId } from '@shared/types/codeCli'
import { sanitizeProviderName } from '@shared/utils/provider'

import { CHERRY_PROVIDER_PREFIX } from './constants'

export { sanitizeProviderName }

/**
 * The provider-name segment Cherry writes into CLI provider keys (`cherry-<name>`) and
 * per-tool provider display fields. Real providers derive it from their sanitized display
 * name; the synthetic API gateway uses the fixed {@link CLI_API_GATEWAY_PROVIDER_NAME} so
 * the key is a clean `cherry-gateway` instead of the `Cherry-` its localized title sanitizes to.
 */
export function cliProviderKeyName(provider: { id: string; name: string }): string {
  return isApiGatewayProviderId(provider.id)
    ? CLI_API_GATEWAY_PROVIDER_NAME
    : sanitizeProviderName(provider.name, provider.id)
}

/**
 * Non-throwing `createUniqueModelId` for render/event paths fed by user input
 * (raw config files, Claude detailed env values): empty parts or reserved
 * route characters yield `undefined` instead of a render-time throw.
 */
export function safeCreateUniqueModelId(providerId: string, modelId: string): UniqueModelId | undefined {
  try {
    return createUniqueModelId(providerId, modelId)
  } catch {
    return undefined
  }
}

export function firstApiKey(keys: ApiKeyEntry[] | undefined): string {
  return keys?.find((k) => k.isEnabled)?.key ?? ''
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- JSON, TOML and user-edited sections share this container check; foreign field values remain unvalidated.
export function asRecord(value: unknown): Record<string, unknown> {
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: Only the object container is checked; callers validate consumed fields or retain their parser-owned value contract.
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** Drop every key in `record` whose name starts with `prefix`. */
export function omitKeysByPrefix<T>(record: Record<string, T>, prefix: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith(prefix)))
}

/** True when a model entry was injected by Cherry Studio (its `envKey` starts with `CHERRY_`). */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Existing CLI model arrays contain user-authored entries; check a string envKey before deciding which Cherry-managed entries may be replaced.
export function isCherryManagedModel(item: unknown): boolean {
  return Boolean(
    item &&
    typeof item === 'object' &&
    'envKey' in item &&
    typeof item.envKey === 'string' &&
    item.envKey.startsWith('CHERRY_')
  )
}

/** Find the provider key Cherry Studio manages (prefixed with `CHERRY_PROVIDER_PREFIX`). */
export function findCherryProviderKey<T>(providers: Record<string, T>): string | undefined {
  return Object.keys(providers).find((key) => key.startsWith(CHERRY_PROVIDER_PREFIX))
}

/** Delete `target.features.goals`, dropping the whole `features` object if it becomes empty. */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This deletion helper preserves all foreign file values; it only removes the named feature key after checking its container.
export function dropFeatureGoalsIfEmpty(target: Record<string, unknown>): void {
  if (!target.features || typeof target.features !== 'object') return
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: The object container is checked; spreading retains its unvalidated enumerable values before deleting goals.
  const features = { ...(target.features as Record<string, unknown>) }
  delete features.goals
  if (Object.keys(features).length === 0) delete target.features
  else target.features = features
}

/** Delete `target.security.auth.selectedType`, dropping `auth`/`security` when they become empty. */
// oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- This deletion helper preserves foreign security settings and removes only the managed auth selector.
export function dropSecurityAuthSelectedTypeIfEmpty(target: Record<string, unknown>): void {
  if (!target.security || typeof target.security !== 'object') return
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: The security container is checked; its other native values are copied without interpretation.
  const security = { ...(target.security as Record<string, unknown>) }
  if (security.auth && typeof security.auth === 'object') {
    // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- SAFETY: The auth container is checked; only selectedType is deleted from its copied fields.
    const auth = { ...(security.auth as Record<string, unknown>) }
    delete auth.selectedType
    if (Object.keys(auth).length === 0) delete security.auth
    else security.auth = auth
  }
  if (Object.keys(security).length === 0) delete target.security
  else target.security = security
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- CLI env, model and provider fields come from user-edited config; only nonblank strings may become normalized settings.
export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- CLI numeric fields come from user-edited config; reject non-numbers and nonfinite values before producing typed settings.
export function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function normalizeUrl(value: string | undefined): string {
  return value ? value.trim().replace(/\/+$/, '') : ''
}
