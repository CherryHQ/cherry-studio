import { getProviderLabel, hasProviderLabel } from '@renderer/i18n/label'
import type { TFunction } from 'i18next'

export const UNGROUPED_MODEL_GROUP_KEY = '__ungrouped__'

/**
 * Known provider-style aliases that appear as model ID prefixes on multi-tenant
 * platforms (e.g. OpenRouter).  Lower-case keys for case-insensitive lookup.
 *
 * NOTE: These are intentionally separate from `providerKeyMap` in the i18n layer.
 * `providerKeyMap` maps *app-registered* provider IDs (e.g. "openai", "anthropic")
 * to i18n keys, while these aliases cover *sub-tenant prefixes* on external
 * platforms that don't correspond to app provider IDs.  Keep this map colocated
 * with the lookup logic here to avoid divergent label sources.
 */
const MODEL_GROUP_DISPLAY_ALIASES: Record<string, string> = {
  'black-forest-labs': 'Black Forest Labs',
  'deepseek-ai': 'DeepSeek',
  cartesia: 'Cartesia',
  google: 'Google',
  hexgrad: 'Hexgrad',
  mistralai: 'Mistral AI',
  qwen: 'Qwen',
  'x-ai': 'xAI',
  xai: 'xAI',
  meta: 'Meta',
  nvidia: 'NVIDIA'
}

/**
 * Return a human-friendly display label for a model group name.
 *
 * 1. If the group is a known provider ID → localised provider label.
 * 2. If the group matches a known provider-style alias → the alias.
 * 3. Otherwise → the original group name unchanged.
 */
export function getModelGroupDisplayName(group: string): string {
  const trimmedGroup = group.trim()

  if (!trimmedGroup) {
    return ''
  }

  // Prefer the i18n provider label when the group happens to be a provider ID.
  if (hasProviderLabel(trimmedGroup)) {
    return getProviderLabel(trimmedGroup)
  }

  // Fallback to known provider-style aliases (e.g. "deepseek-ai" → "DeepSeek").
  const alias = MODEL_GROUP_DISPLAY_ALIASES[trimmedGroup.toLowerCase()]
  if (alias) {
    return alias
  }

  return trimmedGroup
}

export function normalizeModelGroupName(group: string | null | undefined, fallback?: string): string {
  const normalizedGroup = group?.trim()
  if (normalizedGroup && normalizedGroup.toLowerCase() !== 'undefined') {
    return normalizedGroup
  }

  const normalizedFallback = fallback?.trim()
  if (normalizedFallback && normalizedFallback.toLowerCase() !== 'undefined') {
    return normalizedFallback
  }

  return UNGROUPED_MODEL_GROUP_KEY
}

export function getModelGroupLabel(groupName: string, displayName?: (group: string) => string, t?: TFunction): string {
  if (groupName === UNGROUPED_MODEL_GROUP_KEY) {
    return t ? t('assistants.tags.untagged') : groupName
  }
  return displayName ? displayName(groupName) : groupName
}
