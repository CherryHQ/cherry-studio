import { useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { CanonicalParamKey, SupportSpec } from '@cherrystudio/provider-registry'
import { Button, RadioGroup, RadioGroupItem, Input, Label, Switch, Tabs, TabsList, TabsTrigger } from '@cherrystudio/ui'
import { useQuery } from '@data/hooks/useDataApi'
import { useModelMutations } from '@renderer/hooks/useModel'
import { toast } from '@renderer/services/toast'
import { imageSizeSelection } from '@shared/ai/imageCanvases'
import { ImageConfigError } from '@shared/ai/ImageConfigError'
import {
  applyImageGenerationConfig,
  imagePresetFamily,
  imagePresetSupportId,
  inferImagePreset,
  visibleImagePresets,
  ImageGenerationConfigSchema,
  type ImageGenerationConfig,
  type ImageOperationConfig
} from '@shared/ai/imageGenerationConfig'

import { ImageParameterOptions } from './ImageParameterOptions'
import { ImageSizingSettings } from './ImageSizingSettings'
import { useImageSettingsAutoSave } from './useImageSettingsAutoSave'

const LABELS: Partial<Record<CanonicalParamKey, string>> = {
  imageResolution: 'paintings.properties.resolution',
  resolution: 'paintings.properties.resolution',
  aspectRatio: 'paintings.aspect_ratio',
  size: 'paintings.image.size',
  quality: 'paintings.quality',
  outputFormat: 'paintings.ppio.output_format',
  background: 'paintings.background',
  moderation: 'paintings.moderation',
  outputCompression: 'paintings.output_compression',
  numImages: 'paintings.number_images',
  addWatermark: 'paintings.watermark',
  maxImages: 'paintings.dmxapi.max_images',
  sequentialImageGeneration: 'paintings.dmxapi.sequential_image_generation'
}
const ORDER = [
  'imageResolution',
  'resolution',
  'aspectRatio',
  'size',
  'quality',
  'outputFormat',
  'background',
  'outputCompression',
  'moderation',
  'numImages'
]
const specDefault = (spec?: SupportSpec) => (spec && 'default' in spec ? spec.default : undefined)
const emptyOperation = (): ImageOperationConfig => ({ defaults: {}, options: {} })

export function ModelImageSettings({
  providerId,
  modelId,
  initialConfig,
  onChange
}: {
  providerId: string
  modelId: string
  initialConfig?: ImageGenerationConfig
  onChange?: (config: ImageGenerationConfig) => void
}) {
  const { t } = useTranslation()
  const uid = useId()
  const [config, setConfig] = useState<ImageGenerationConfig>(
    () => initialConfig ?? ImageGenerationConfigSchema.parse({ preset: inferImagePreset(modelId) })
  )
  const [mode, setMode] = useState<'generate' | 'edit'>('generate')
  const [dirty, setDirty] = useState(false)
  const { updateModel } = useModelMutations()
  const sourceId = config.preset === 'catalog' ? modelId : imagePresetSupportId(config.preset)
  const { data } = useQuery('/providers/:providerId/models/:modelId*/image-generation-support', {
    params: { providerId, modelId: sourceId || '__draft__' },
    query: { catalogOnly: true },
    enabled: Boolean(sourceId)
  })
  const base = data?.modes ? data : undefined
  const settings = mode === 'generate' ? config.generate : (config.edit ?? config.generate)
  const inherited = mode === 'edit' && config.edit === null && Boolean(base?.modes.generate)
  useEffect(() => {
    if (base && !base.modes[mode]) setMode(base.modes.generate ? 'generate' : 'edit')
  }, [base, mode])
  const validation = useMemo(() => {
    if (!base) return { support: undefined, error: undefined }
    try {
      return { support: applyImageGenerationConfig(base, config), error: undefined }
    } catch (error) {
      return { support: undefined, error: error instanceof ImageConfigError ? error.code : 'invalid_config' }
    }
  }, [base, config])
  const definition = validation.support?.modes[mode] ?? base?.modes[mode]
  const change = (next: ImageGenerationConfig) => {
    setConfig(next)
    setDirty(true)
    onChange?.(next)
  }
  const operation = (next: ImageOperationConfig) => change({ ...config, [mode]: next })
  const setDefault = (key: CanonicalParamKey, value: unknown) => {
    const defaults = { ...settings.defaults, [key]: value }
    operation({ ...settings, defaults })
  }
  const optionLabel = (key: string, value: string) => {
    if (key === 'outputFormat') return value.toUpperCase()
    if (value === 'auto') return t('paintings.image_size_options.auto')
    if (key === 'quality') return t(`paintings.quality_options.${value}`, { defaultValue: value })
    if (key === 'background') return t(`paintings.background_options.${value}`, { defaultValue: value })
    if (key === 'moderation') return t(`paintings.moderation_options.${value}`, { defaultValue: value })
    return value
      .replace(/^ASPECT_/, '')
      .replace(/^(\d+)_(\d+)$/, '$1:$2')
      .replace(/k$/, 'K')
  }
  const sizeSelection = imageSizeSelection(validation.support ?? base, mode, settings.defaults)
  const preview = [
    sizeSelection.tier,
    sizeSelection.ratio,
    sizeSelection.pixels
      ? t('paintings.model_parameters.expected_size', { size: sizeSelection.pixels.replace('x', '×') })
      : undefined
  ]
    .filter(Boolean)
    .join(' · ')
  const fields = Object.entries(definition?.supports ?? {}).sort(([a], [b]) => {
    const rank = (key: string) => (ORDER.includes(key) ? ORDER.indexOf(key) : 100)
    return rank(a) - rank(b)
  }) as Array<[CanonicalParamKey, SupportSpec]>
  const countKey = definition?.supports.numImages ? 'numImages' : 'maxImages'
  const count = definition?.supports[countKey]
  const {
    saving,
    error: saveError,
    retry
  } = useImageSettingsAutoSave(
    config,
    dirty && !onChange && Boolean(validation.support),
    (next) => updateModel(providerId, modelId, { imageGenerationConfig: ImageGenerationConfigSchema.parse(next) }),
    () => toast.error(t('common.save_failed'))
  )
  return (
    <section
      aria-label={t('paintings.model_parameters.title')}
      data-saving={saving}
      className="space-y-4 rounded-xl border border-border-subtle p-4">
      <div>
        <h3 className="text-[13px] font-normal">{t('paintings.model_parameters.title')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('paintings.model_parameters.scope_hint')}</p>
      </div>
      <div className="space-y-2">
        <Label className="text-[13px] font-normal" htmlFor={`${uid}-preset`}>
          {t('paintings.properties.preset')}
        </Label>
        <RadioGroup
          aria-label={t('paintings.properties.preset')}
          value={imagePresetFamily(config.preset)}
          onValueChange={(preset) => change({ preset, generate: emptyOperation(), edit: null })}
          className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {visibleImagePresets(config.preset).map((preset) => (
            <label
              key={preset.id}
              className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg border border-border-subtle px-2.5 py-2 text-xs transition-colors hover:bg-muted/50 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5">
              <RadioGroupItem
                value={preset.id}
                onClick={() => {
                  if (!initialConfig && preset.id === config.preset) change(config)
                }}
              />
              <span className="min-w-0 font-normal">{preset.id === 'catalog' ? t('common.default') : preset.name}</span>
            </label>
          ))}
        </RadioGroup>
      </div>
      {imagePresetFamily(config.preset) === 'seedream' && (
        <div className="space-y-2">
          <Label className="text-[13px] font-normal">{t('paintings.model_parameters.api_protocol')}</Label>
          <RadioGroup
            aria-label={t('paintings.model_parameters.api_protocol')}
            value={config.apiProtocol ?? 'doubao'}
            onValueChange={(value) => change({ ...config, apiProtocol: value as 'openai' | 'doubao' })}
            className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(['openai', 'doubao'] as const).map((protocol) => (
              <label
                key={protocol}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-border-subtle p-2.5 text-xs">
                <RadioGroupItem value={protocol} />
                {t(
                  protocol === 'openai' ? 'paintings.model_parameters.api_openai' : 'paintings.model_parameters.api_ark'
                )}
              </label>
            ))}
          </RadioGroup>
          <p className="text-xs text-muted-foreground">{t('paintings.model_parameters.api_protocol_hint')}</p>
        </div>
      )}
      {!base ? (
        <p className="text-xs text-muted-foreground">{t('paintings.model_parameters.preset_required')}</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2" data-testid="image-mode-controls">
            <Tabs className="shrink-0" value={mode} onValueChange={(value) => setMode(value as 'generate' | 'edit')}>
              <TabsList>
                <TabsTrigger className="text-xs font-normal" value="generate" disabled={!base.modes.generate}>
                  {t('paintings.mode.generate')}
                </TabsTrigger>
                <TabsTrigger className="text-xs font-normal" value="edit" disabled={!base.modes.edit}>
                  {t('paintings.mode.edit')}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            {mode === 'edit' && base.modes.generate && (
              <div className="flex min-w-0 items-center gap-2">
                <Label className="text-[13px] font-normal" htmlFor={`${uid}-inherit`}>
                  {t('paintings.properties.inherit')}
                </Label>
                <Switch
                  size="sm"
                  id={`${uid}-inherit`}
                  checked={inherited}
                  onCheckedChange={(checked) =>
                    change({
                      ...config,
                      edit: checked
                        ? null
                        : {
                            ...structuredClone(config.generate),
                            defaults: Object.fromEntries(
                              Object.entries(config.generate.defaults).filter(
                                ([key]) => definition?.supports[key as CanonicalParamKey]
                              )
                            ),
                            options: Object.fromEntries(
                              Object.entries(config.generate.options).filter(
                                ([key]) => definition?.supports[key as CanonicalParamKey]
                              )
                            )
                          }
                    })
                  }
                />
              </div>
            )}
          </div>
          <fieldset disabled={inherited} className="space-y-4 disabled:opacity-60">
            {fields.map(([key, spec]) => {
              if (key === 'size' && definition?.canvases?.length) return null
              if (key === countKey && spec.type === 'range') return null
              const format = settings.defaults.outputFormat ?? specDefault(definition?.supports.outputFormat)
              if (key === 'outputCompression' && !['jpeg', 'webp'].includes(String(format))) return null
              if (!['enum', 'range', 'switch'].includes(spec.type)) return null
              const label = t(LABELS[key] ?? key)
              const value = settings.defaults[key] ?? ('default' in spec ? spec.default : undefined)
              if (spec.type === 'enum') {
                const options = spec.options
                return (
                  <ImageParameterOptions
                    key={`${config.preset}/${mode}/${key}`}
                    label={label}
                    options={options}
                    selected={String(value ?? options[0])}
                    disabled={inherited}
                    format={(option) => optionLabel(key, option)}
                    onSelect={(option) => setDefault(key, option)}
                    onChange={(choices, previous, replacement) => {
                      const defaults = { ...settings.defaults }
                      if (previous === value && replacement) Object.assign(defaults, { [key]: replacement })
                      else if (!choices.includes(String(value))) Object.assign(defaults, { [key]: choices[0] })
                      operation({ ...settings, defaults, options: { ...settings.options, [key]: choices } })
                    }}
                  />
                )
              }
              if (spec.type === 'range')
                return (
                  <div key={key} className="space-y-2">
                    <Label className="text-[13px] font-normal" htmlFor={`${uid}-${key}`}>
                      {label}
                    </Label>
                    <Input
                      id={`${uid}-${key}`}
                      className="h-8 text-[13px] font-normal"
                      type="number"
                      min={spec.min}
                      max={key === 'numImages' || key === 'maxImages' ? (settings.maxImages ?? spec.max) : spec.max}
                      step={spec.step ?? 1}
                      value={typeof value === 'number' ? value : ''}
                      onChange={(event) =>
                        setDefault(key, event.target.value === '' ? undefined : Number(event.target.value))
                      }
                    />
                  </div>
                )
              if (spec.type === 'switch')
                return (
                  <div key={key} className="flex items-center justify-between">
                    <Label className="text-[13px] font-normal" htmlFor={`${uid}-${key}`}>
                      {label}
                    </Label>
                    <Switch
                      id={`${uid}-${key}`}
                      checked={Boolean(value)}
                      disabled={inherited}
                      onCheckedChange={(value) => setDefault(key, value)}
                    />
                  </div>
                )
              return null
            })}
            {count?.type === 'range' && (
              <div
                role="group"
                aria-label={t('paintings.number_images')}
                className="space-y-2 rounded-xl border border-border-subtle p-3">
                <p className="text-[13px] font-normal">{t('paintings.number_images')}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-xs font-normal" htmlFor={`${uid}-${countKey}`}>
                      {t('paintings.properties.default')}
                    </Label>
                    <Input
                      id={`${uid}-${countKey}`}
                      aria-label={t(LABELS[countKey] ?? countKey)}
                      className="h-8 text-xs font-normal"
                      type="number"
                      min={count.min}
                      max={settings.maxImages ?? count.max}
                      step={count.step ?? 1}
                      value={Number(settings.defaults[countKey] ?? count.default ?? count.min)}
                      onChange={(event) =>
                        setDefault(countKey, event.target.value === '' ? undefined : Number(event.target.value))
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs font-normal" htmlFor={`${uid}-count-limit`}>
                      {t('paintings.properties.max_images')}
                    </Label>
                    <Input
                      id={`${uid}-count-limit`}
                      className="h-8 text-xs font-normal"
                      type="number"
                      min={count.min}
                      value={settings.maxImages ?? count.max}
                      onChange={(event) => operation({ ...settings, maxImages: Number(event.target.value) })}
                    />
                  </div>
                </div>
              </div>
            )}
            {definition?.canvases?.length ? (
              <ImageSizingSettings
                definition={definition}
                preview={preview}
                settings={settings}
                onChange={operation}
                disabled={inherited}
              />
            ) : null}
            {mode === 'edit' && definition?.maxInputImages !== undefined && (
              <Label className="space-y-1 text-[13px] font-normal">
                {t('paintings.model_parameters.max_reference_images')}
                <Input
                  aria-label={t('paintings.model_parameters.max_reference_images')}
                  type="number"
                  min={1}
                  value={settings.maxInputImages ?? definition.maxInputImages}
                  onChange={(event) => operation({ ...settings, maxInputImages: Number(event.target.value) })}
                />
              </Label>
            )}
          </fieldset>
          {preview && !definition?.canvases?.length && (
            <p className="text-xs text-muted-foreground">
              {t('paintings.image.size')}: {preview}
            </p>
          )}
        </>
      )}
      {(validation.error || saveError) && (
        <p role="alert" className="text-xs text-destructive">
          {validation.error ? t(`paintings.model_parameters.errors.${validation.error}`) : t('common.save_failed')}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="ghost"

          onClick={() => change({ ...config, generate: emptyOperation(), edit: null })}>
          {t('paintings.properties.reset')}
        </Button>
        {saving && (
          <span role="status" className="text-xs text-muted-foreground">
            {t('paintings.model_parameters.saving')}
          </span>
        )}
        {saveError && (
          <Button type="button" size="sm" variant="ghost" onClick={retry}>
            {t('common.retry')}
          </Button>
        )}
      </div>
    </section>
  )
}
