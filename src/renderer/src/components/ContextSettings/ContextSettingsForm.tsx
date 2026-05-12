import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Badge,
  Button,
  ColFlex,
  EditableNumber,
  InfoTooltip,
  RowFlex,
  Switch
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { ModelSelector } from '@renderer/components/ModelSelector'
import { useModels } from '@renderer/hooks/useModels'
import {
  type ContextSettingsCompressOverride,
  type ContextSettingsOverride,
  DEFAULT_CONTEXT_SETTINGS,
  type EffectiveContextSettings
} from '@shared/data/types/contextSettings'
import type { UniqueModelId } from '@shared/data/types/model'
import { ChevronsUpDown } from 'lucide-react'
import { useCallback, useId, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('ContextSettingsForm')

const MIN_TRUNCATE_THRESHOLD = 1000
const MAX_TRUNCATE_THRESHOLD = 50000
const TRUNCATE_STEP = 500

export type ContextSettingsFormScope = 'global' | 'assistant' | 'topic'

export interface ContextSettingsFormProps {
  /**
   * Current value. Global scope: pass `EffectiveContextSettings`. Assistant/topic:
   * pass the override (may be `undefined`/`null` = no override yet).
   */
  value: ContextSettingsOverride | EffectiveContextSettings | undefined | null
  /**
   * Called with the next value. For `global` scope, receives a fully-resolved
   * `EffectiveContextSettings`. For `assistant`/`topic`, receives a
   * `ContextSettingsOverride`, or `undefined` once every field is inherited.
   */
  onChange: (next: ContextSettingsOverride | EffectiveContextSettings | undefined) => void
  /** Determines inheritance + UI affordances. */
  scope: ContextSettingsFormScope
  /**
   * Settings that would apply if every field on this layer were inherited.
   * Required for `assistant` and `topic` scopes (drives the "Inherit (X)"
   * hints). Optional for `global` (defaults to `DEFAULT_CONTEXT_SETTINGS`).
   */
  inheritedDefaults?: EffectiveContextSettings
  /**
   * The user's chosen topic-naming model (`UniqueModelId`), if any. Used for
   * the compression model picker fallback hint.
   */
  topicNamingModelId?: string | null
  /** Optional className passthrough for the outer container. */
  className?: string
}

const isOverrideEmpty = (override: ContextSettingsOverride): boolean =>
  override.enabled === undefined && override.truncateThreshold === undefined && override.compress === undefined

/**
 * Shared form for context-chef integration. Renders the master toggle,
 * truncate threshold, and compression accordion (toggle + model picker).
 *
 * Mounts at three scopes:
 *   - `global`    — owns the effective settings; no inherit affordances.
 *   - `assistant` — emits a partial override; per-field "Inherit" badges fall
 *                   back to the global layer.
 *   - `topic`     — emits a partial override; per-field "Inherit" badges fall
 *                   back to the assistant layer (or global if assistant is
 *                   inheriting).
 *
 * Pure presentation: all data flows through props. The parent owns reads from
 * Preference / DataApi and writes back through `onChange`.
 */
export const ContextSettingsForm = ({
  value,
  onChange,
  scope,
  inheritedDefaults,
  topicNamingModelId,
  className
}: ContextSettingsFormProps) => {
  const { t } = useTranslation()
  const { models } = useModels()
  const ids = {
    enabled: useId(),
    truncate: useId(),
    compressEnabled: useId(),
    compressModel: useId()
  }

  const isGlobal = scope === 'global'
  // Global owns the effective state; for global scope, fall back to DEFAULT to
  // be defensive when callers pass in a partial value during initial render.
  const inherited = inheritedDefaults ?? DEFAULT_CONTEXT_SETTINGS

  // Treat `value` uniformly as a partial — for global scope every field is
  // in fact present, but reading through `?.` is harmless and keeps the
  // resolution logic uniform.
  const override = (value ?? undefined) as ContextSettingsOverride | undefined

  // Effective values shown in the editors. For global, this is the source of
  // truth; for overrides, undefined fields fall through to `inherited`.
  const effEnabled = override?.enabled ?? inherited.enabled
  const effTruncate = override?.truncateThreshold ?? inherited.truncateThreshold
  const effCompressEnabled = override?.compress?.enabled ?? inherited.compress.enabled
  // Compression modelId is nullable at every layer (null = "no explicit
  // pick"); for the override layer, `undefined` = inherit, `null`/string =
  // explicit pick. Plain `string` here mirrors the schema — see the note in
  // `contextSettings.ts` explaining why it's not `UniqueModelId`.
  const overrideCompressModelId = override?.compress?.modelId
  const effCompressModelId: string | null =
    overrideCompressModelId !== undefined ? overrideCompressModelId : inherited.compress.modelId

  // Per-field "is currently inheriting?" — only meaningful for assistant/topic.
  const enabledInherits = !isGlobal && override?.enabled === undefined
  const truncateInherits = !isGlobal && override?.truncateThreshold === undefined
  const compressEnabledInherits = !isGlobal && override?.compress?.enabled === undefined
  const compressModelInherits = !isGlobal && override?.compress?.modelId === undefined

  const emit = useCallback(
    (nextOverride: ContextSettingsOverride) => {
      try {
        if (isGlobal) {
          // For global the override is fully populated by construction;
          // promote it to EffectiveContextSettings so the parent gets the
          // expected shape.
          const effective: EffectiveContextSettings = {
            enabled: nextOverride.enabled ?? inherited.enabled,
            truncateThreshold: nextOverride.truncateThreshold ?? inherited.truncateThreshold,
            compress: {
              enabled: nextOverride.compress?.enabled ?? inherited.compress.enabled,
              modelId: nextOverride.compress?.modelId ?? null
            }
          }
          onChange(effective)
          return
        }
        // Override scopes: collapse to undefined when nothing remains.
        if (isOverrideEmpty(nextOverride)) {
          onChange(undefined)
          return
        }
        onChange(nextOverride)
      } catch (error) {
        logger.error('Failed to emit context settings change', error as Error)
      }
    },
    [inherited, isGlobal, onChange]
  )

  const onToggleEnabled = useCallback(
    (checked: boolean) => {
      emit({
        ...(override ?? {}),
        enabled: checked
      })
    },
    [emit, override]
  )

  const onChangeTruncate = useCallback(
    (next: number | null) => {
      if (next == null) return
      const clamped = Math.max(MIN_TRUNCATE_THRESHOLD, Math.min(MAX_TRUNCATE_THRESHOLD, next))
      emit({
        ...(override ?? {}),
        truncateThreshold: clamped
      })
    },
    [emit, override]
  )

  const onToggleCompress = useCallback(
    (checked: boolean) => {
      const nextCompress: ContextSettingsCompressOverride = {
        enabled: checked,
        // Preserve any explicit modelId pick across the toggle. `undefined`
        // = inherit; `null` = explicitly cleared.
        ...(override?.compress?.modelId !== undefined ? { modelId: override?.compress?.modelId } : {})
      }
      emit({
        ...(override ?? {}),
        compress: nextCompress
      })
    },
    [emit, override]
  )

  const onSelectCompressModel = useCallback(
    (modelId: UniqueModelId | undefined) => {
      const nextCompress: ContextSettingsCompressOverride = {
        // Picking a model implies "compression on" at this layer; if the
        // current override has compression off explicitly, keep that as the
        // user's choice but write the model anyway.
        enabled: override?.compress?.enabled ?? inherited.compress.enabled,
        modelId: modelId ?? null
      }
      emit({
        ...(override ?? {}),
        compress: nextCompress
      })
    },
    [emit, inherited.compress.enabled, override]
  )

  // ── Inherit-toggle handlers (assistant/topic only) ────────────────────
  const inheritEnabled = useCallback(() => {
    if (isGlobal) return
    const next = { ...(override ?? {}) }
    delete next.enabled
    emit(next)
  }, [emit, isGlobal, override])

  const overrideEnabled = useCallback(() => {
    // Start from the inherited value so the editor shows something sensible.
    emit({
      ...(override ?? {}),
      enabled: inherited.enabled
    })
  }, [emit, inherited.enabled, override])

  const inheritTruncate = useCallback(() => {
    if (isGlobal) return
    const next = { ...(override ?? {}) }
    delete next.truncateThreshold
    emit(next)
  }, [emit, isGlobal, override])

  const overrideTruncate = useCallback(() => {
    emit({
      ...(override ?? {}),
      truncateThreshold: inherited.truncateThreshold
    })
  }, [emit, inherited.truncateThreshold, override])

  const inheritCompress = useCallback(() => {
    if (isGlobal) return
    const next = { ...(override ?? {}) }
    // Drop the entire compress sub-object so all of its fields inherit.
    delete next.compress
    emit(next)
  }, [emit, isGlobal, override])

  const overrideCompress = useCallback(() => {
    emit({
      ...(override ?? {}),
      compress: {
        enabled: inherited.compress.enabled
      }
    })
  }, [emit, inherited.compress.enabled, override])

  const inheritCompressModel = useCallback(() => {
    if (isGlobal) return
    const currentCompress = override?.compress
    if (!currentCompress) return
    // Strip just the modelId, keep the explicit `enabled` choice.
    const nextCompress: ContextSettingsCompressOverride = {
      enabled: currentCompress.enabled
    }
    emit({
      ...(override ?? {}),
      compress: nextCompress
    })
  }, [emit, isGlobal, override])

  // ── Compression model picker hint ─────────────────────────────────────
  const selectedCompressModel = useMemo(
    () => (effCompressModelId ? models.find((m) => m.id === effCompressModelId) : undefined),
    [effCompressModelId, models]
  )
  const namingModel = useMemo(
    () => (topicNamingModelId ? models.find((m) => m.id === topicNamingModelId) : undefined),
    [models, topicNamingModelId]
  )
  const namingModelLabel = namingModel?.name ?? topicNamingModelId ?? ''

  const compressTriggerLabel =
    selectedCompressModel?.name ?? effCompressModelId ?? t('settings.context_settings.compression.placeholder')

  // ── Renderers ─────────────────────────────────────────────────────────
  const renderInheritBadge = (inheriting: boolean, onInherit: () => void, onOverride: () => void, hint: string) => {
    if (isGlobal) return null
    return (
      <Badge
        asChild
        variant={inheriting ? 'secondary' : 'outline'}
        className="cursor-pointer select-none px-2 py-0.5 font-medium text-[11px]">
        <button
          type="button"
          onClick={inheriting ? onOverride : onInherit}
          aria-pressed={!inheriting}
          title={
            inheriting
              ? t('settings.context_settings.inherit.click_to_override')
              : t('settings.context_settings.inherit.click_to_inherit')
          }>
          {inheriting
            ? t('settings.context_settings.inherit.label_with_value', { value: hint })
            : t('settings.context_settings.inherit.override_label')}
        </button>
      </Badge>
    )
  }

  const enabledHint = inherited.enabled
    ? t('settings.context_settings.inherit.value_on')
    : t('settings.context_settings.inherit.value_off')
  const truncateHint = String(inherited.truncateThreshold)
  const compressEnabledHint = inherited.compress.enabled
    ? t('settings.context_settings.inherit.value_on')
    : t('settings.context_settings.inherit.value_off')
  const compressModelHint = inherited.compress.modelId
    ? (models.find((m) => m.id === inherited.compress.modelId)?.name ?? inherited.compress.modelId)
    : t('settings.context_settings.inherit.value_unset')

  return (
    <ColFlex className={cn('gap-4', className)}>
      {/* Master toggle */}
      <RowFlex className="justify-between gap-3">
        <RowFlex className="items-center gap-2">
          <label className="cursor-pointer text-sm" htmlFor={ids.enabled}>
            {t('settings.context_settings.label')}
          </label>
          <InfoTooltip content={t('settings.context_settings.help')} />
          {renderInheritBadge(enabledInherits, inheritEnabled, overrideEnabled, enabledHint)}
        </RowFlex>
        {!enabledInherits && <Switch id={ids.enabled} checked={effEnabled} onCheckedChange={onToggleEnabled} />}
      </RowFlex>

      {effEnabled && (
        <>
          {/* Truncate threshold */}
          <RowFlex className="justify-between gap-3">
            <RowFlex className="items-center gap-2">
              <label className="text-sm" htmlFor={ids.truncate}>
                {t('settings.context_settings.truncate_threshold')}
              </label>
              <InfoTooltip content={t('settings.context_settings.truncate_threshold_help')} />
              {renderInheritBadge(truncateInherits, inheritTruncate, overrideTruncate, truncateHint)}
            </RowFlex>
            {!truncateInherits && (
              <EditableNumber
                min={MIN_TRUNCATE_THRESHOLD}
                max={MAX_TRUNCATE_THRESHOLD}
                step={TRUNCATE_STEP}
                precision={0}
                value={effTruncate}
                onChange={onChangeTruncate}
                changeOnBlur
                style={{ width: 120 }}
              />
            )}
          </RowFlex>

          {/* Compression accordion */}
          <Accordion type="single" collapsible defaultValue={effCompressEnabled ? 'compression' : undefined}>
            <AccordionItem value="compression">
              <AccordionTrigger className="text-sm">
                {t('settings.context_settings.compression.section')}
              </AccordionTrigger>
              <AccordionContent>
                <ColFlex className="gap-3 pt-1">
                  {/* Compress toggle */}
                  <RowFlex className="justify-between gap-3">
                    <RowFlex className="items-center gap-2">
                      <label className="cursor-pointer text-sm" htmlFor={ids.compressEnabled}>
                        {t('settings.context_settings.compression.toggle')}
                      </label>
                      <InfoTooltip content={t('settings.context_settings.compression.toggle_help')} />
                      {renderInheritBadge(
                        compressEnabledInherits,
                        inheritCompress,
                        overrideCompress,
                        compressEnabledHint
                      )}
                    </RowFlex>
                    {!compressEnabledInherits && (
                      <Switch
                        id={ids.compressEnabled}
                        checked={effCompressEnabled}
                        onCheckedChange={onToggleCompress}
                      />
                    )}
                  </RowFlex>

                  {/* Compression model picker — visible whenever compression is on
                      (or, for overrides, the field isn't inheriting). */}
                  {effCompressEnabled && (
                    <ColFlex className="gap-2">
                      <RowFlex className="items-center justify-between gap-3">
                        <RowFlex className="items-center gap-2">
                          <label className="text-sm" htmlFor={ids.compressModel}>
                            {t('settings.context_settings.compression.model')}
                          </label>
                          {/* The model field's "inherit" only matters when the
                              parent compress object is itself overridden. */}
                          {!compressEnabledInherits &&
                            renderInheritBadge(
                              compressModelInherits,
                              inheritCompressModel,
                              () =>
                                onSelectCompressModel(
                                  (inherited.compress.modelId ?? undefined) as UniqueModelId | undefined
                                ),
                              compressModelHint
                            )}
                        </RowFlex>
                        <ModelSelector
                          multiple={false}
                          selectionType="id"
                          value={(effCompressModelId ?? undefined) as UniqueModelId | undefined}
                          onSelect={onSelectCompressModel}
                          trigger={
                            <Button
                              id={ids.compressModel}
                              variant="outline"
                              size="sm"
                              className="min-w-[220px] justify-between gap-2 text-left">
                              <span className="truncate">{compressTriggerLabel}</span>
                              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
                            </Button>
                          }
                        />
                      </RowFlex>

                      {/* Fallback hints when picker is empty. */}
                      {!effCompressModelId && topicNamingModelId && (
                        <p className="text-muted-foreground text-xs">
                          {t('settings.context_settings.compression.fallback_to_topic_naming', {
                            name: namingModelLabel
                          })}
                        </p>
                      )}
                      {!effCompressModelId && !topicNamingModelId && (
                        <p className="text-warning text-xs">
                          {t('settings.context_settings.compression.no_model_warning')}
                        </p>
                      )}
                      {effCompressModelId && (
                        <p className="text-muted-foreground text-xs">
                          {t('settings.context_settings.compression.help')}
                        </p>
                      )}
                    </ColFlex>
                  )}
                </ColFlex>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </>
      )}
    </ColFlex>
  )
}

export default ContextSettingsForm
