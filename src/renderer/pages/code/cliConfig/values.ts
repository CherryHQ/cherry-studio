import { createUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import type { ApiKeyEntry } from '@shared/data/types/provider'

import { CHERRY_PROVIDER_PREFIX } from './constants'

export { sanitizeProviderName } from '@shared/utils/provider'

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

export function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {}
}

/** Drop every key in `record` whose name starts with `prefix`. */
export function omitKeysByPrefix<T>(record: Record<string, T>, prefix: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith(prefix)))
}

/** True when a model entry was injected by Cherry Studio (its `envKey` starts with `CHERRY_`). */
export function isCherryManagedModel(item: unknown): boolean {
  return Boolean(
    item &&
      typeof item === 'object' &&
      typeof (item as any).envKey === 'string' &&
      (item as any).envKey.startsWith('CHERRY_')
  )
}

/** Find the provider key Cherry Studio manages (prefixed with `CHERRY_PROVIDER_PREFIX`). */
export function findCherryProviderKey(providers: Record<string, any>): string | undefined {
  return Object.keys(providers).find((key) => key.startsWith(CHERRY_PROVIDER_PREFIX))
}

/** Delete `target.features.goals`, dropping the whole `features` object if it becomes empty. */
export function dropFeatureGoalsIfEmpty(target: Record<string, any>): void {
  if (!target.features || typeof target.features !== 'object') return
  const features = { ...(target.features as Record<string, any>) }
  delete features.goals
  if (Object.keys(features).length === 0) delete target.features
  else target.features = features
}

/** Delete `target.security.auth.selectedType`, dropping `auth`/`security` when they become empty. */
export function dropSecurityAuthSelectedTypeIfEmpty(target: Record<string, any>): void {
  if (!target.security || typeof target.security !== 'object') return
  const security = { ...(target.security as Record<string, any>) }
  if (security.auth && typeof security.auth === 'object') {
    const auth = { ...(security.auth as Record<string, any>) }
    delete auth.selectedType
    if (Object.keys(auth).length === 0) delete security.auth
    else security.auth = auth
  }
  if (Object.keys(security).length === 0) delete target.security
  else target.security = security
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function normalizeUrl(value: string | undefined): string {
  return value ? value.trim().replace(/\/+$/, '') : ''
}
