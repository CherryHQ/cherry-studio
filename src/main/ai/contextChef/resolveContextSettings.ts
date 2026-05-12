/**
 * Pure helper that collapses the three-layer context settings model
 * (globals -> assistant -> topic) into a fully resolved object the
 * request pipeline can consume.
 *
 * The compression model has its own resolution chain:
 *   topic.compress.modelId
 *     -> assistant.compress.modelId
 *     -> globals.compress.modelId
 *     -> topicNamingModelId (user's chosen fast model)
 *     -> null
 *
 * Caller responsibilities:
 *   - Read prefs (`chat.context_settings.*`) and assemble `globals`
 *     (or pass DEFAULT_CONTEXT_SETTINGS when prefs are unavailable).
 *   - Pass `topic.naming.model_id` separately as `topicNamingModelId`;
 *     the helper does not touch preferences itself so it stays pure
 *     and trivially testable.
 */

import { loggerService } from '@logger'
import type { ContextSettingsOverride, EffectiveContextSettings } from '@shared/data/types/contextSettings'

const logger = loggerService.withContext('resolveContextSettings')

export interface ResolveContextSettingsInput {
  /** Per-topic override (from topic.contextSettings). null/undefined = no override. */
  topic?: ContextSettingsOverride | null
  /** Per-assistant override (from assistant.settings.contextSettings). undefined = no override. */
  assistant?: ContextSettingsOverride
  /**
   * Fully resolved global defaults (from prefs `chat.context_settings.*`).
   * Caller is responsible for reading prefs and assembling this object.
   * Caller should pass `DEFAULT_CONTEXT_SETTINGS` (from contextSettings.ts) if prefs unavailable.
   */
  globals: EffectiveContextSettings
  /**
   * User's topic-naming model id (from preference `topic.naming.model_id`).
   * Used as fallback for compression model when no explicit modelId at any layer.
   */
  topicNamingModelId?: string | null
}

export function resolveContextSettings(input: ResolveContextSettingsInput): EffectiveContextSettings {
  const { topic, assistant, globals, topicNamingModelId } = input

  const enabled = topic?.enabled ?? assistant?.enabled ?? globals.enabled
  const truncateThreshold = topic?.truncateThreshold ?? assistant?.truncateThreshold ?? globals.truncateThreshold

  const compressEnabled = topic?.compress?.enabled ?? assistant?.compress?.enabled ?? globals.compress.enabled

  // Explicit modelId from any layer wins over the topic-naming fallback.
  // `??` treats null/undefined the same: see file header for rationale —
  // users disable compression via `compress.enabled = false`, not by
  // setting modelId to null.
  const explicitModelId = topic?.compress?.modelId ?? assistant?.compress?.modelId ?? globals.compress.modelId
  let resolvedModelId: string | null
  if (explicitModelId != null) {
    resolvedModelId = explicitModelId
  } else if (topicNamingModelId != null) {
    resolvedModelId = topicNamingModelId
    logger.debug('compression modelId fell back to topic-naming model', { topicNamingModelId })
  } else {
    resolvedModelId = null
  }

  if (compressEnabled && resolvedModelId === null) {
    logger.debug('compression enabled but no modelId available (no explicit pick, no topic-naming fallback)')
  }

  return {
    enabled,
    truncateThreshold,
    compress: {
      enabled: compressEnabled,
      modelId: resolvedModelId
    }
  }
}
