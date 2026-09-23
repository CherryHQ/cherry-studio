import { useTranslation } from 'react-i18next'

import type { ImageGenerationSupport } from '@cherrystudio/provider-registry'
import { Button, Input, Label, Switch } from '@cherrystudio/ui'
import { resolveImageCanvasParams } from '@shared/ai/imageCanvases'
import type { ImageOperationConfig } from '@shared/ai/imageGenerationConfig'

export function ImageSizingSettings({
  definition,
  preview,
  settings,
  onChange,
  disabled
}: {
  definition: NonNullable<ImageGenerationSupport['modes']['generate']>
  preview?: string
  settings: ImageOperationConfig
  onChange: (value: ImageOperationConfig) => void
  disabled: boolean
}) {
  const { t } = useTranslation()
  const fallback = (key: 'imageResolution' | 'aspectRatio') => {
    const spec = definition.supports[key]
    return spec && 'default' in spec ? String(spec.default ?? '') : ''
  }
  const resolution = settings.defaults.imageResolution ?? fallback('imageResolution')
  const ratio = settings.defaults.aspectRatio ?? fallback('aspectRatio')
  if (!resolution || !ratio || resolution === 'auto' || ratio === 'auto') return null
  const known = definition.canvases?.filter((c) => c.resolution === resolution) ?? []
  const fallbackRule = {
    longEdge: known.length
      ? Math.max(...known.flatMap((c) => c.size.split('x').map(Number)))
      : (Number.parseFloat(resolution) || 2) * 1024,
    maxPixels: known.length
      ? Math.max(
          ...known.map((c) =>
            c.size
              .split('x')
              .map(Number)
              .reduce((a, b) => a * b)
          )
        )
      : undefined,
    multiple: 16
  }
  const rule = settings.sizeRules?.[resolution]
  const setRule = (next: typeof fallbackRule | undefined) => {
    const rules = { ...settings.sizeRules }
    if (next) rules[resolution] = next
    else delete rules[resolution]
    onChange({ ...settings, sizeRules: rules })
  }
  const selected = settings.canvases?.find((c) => c.resolution === resolution && c.aspectRatio === ratio)
  let size = selected?.size ?? known.find((c) => c.aspectRatio === ratio)?.size ?? ''
  if (!selected && rule) {
    try {
      size =
        resolveImageCanvasParams(
          { modes: { generate: { ...definition, sizeRules: settings.sizeRules } } },
          'generate',
          { imageResolution: resolution, aspectRatio: ratio }
        ).size ?? ''
    } catch {
      size = ''
    }
  }
  const dimensions = size.split('x')
  const setDimension = (index: number, value: string) => {
    const parts = [...dimensions]
    parts[index] = value
    const canvases = (settings.canvases ?? []).filter((c) => c.resolution !== resolution || c.aspectRatio !== ratio)
    onChange({
      ...settings,
      canvases: [...canvases, { resolution, aspectRatio: ratio, size: `${parts[0] || 0}x${parts[1] || 0}` }]
    })
  }
  return (
    <div className="space-y-2 rounded-xl border border-border-subtle p-3">
      <details>
        <summary className="cursor-pointer text-[13px]">
          {t('paintings.model_parameters.sizing_rules')} · {resolution} · {ratio}
        </summary>
        <fieldset disabled={disabled} className="mt-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">{t('paintings.model_parameters.long_edge_rule')}</Label>
            <Switch
              aria-label={t('paintings.model_parameters.long_edge_rule')}
              checked={Boolean(rule)}
              onCheckedChange={(checked) => setRule(checked ? fallbackRule : undefined)}
            />
          </div>
          {rule && (
            <div className="grid grid-cols-3 gap-2">
              <Label className="space-y-1 text-xs">
                {t('paintings.model_parameters.long_edge')}
                <Input
                  aria-label={t('paintings.model_parameters.long_edge')}
                  className="h-8 text-xs"
                  type="number"
                  min={1}
                  value={rule.longEdge}
                  onChange={(event) =>
                    setRule({ ...rule, maxPixels: rule.maxPixels, longEdge: Number(event.target.value) })
                  }
                />
              </Label>
              <Label className="space-y-1 text-xs">
                {t('paintings.model_parameters.pixel_budget')}
                <Input
                  aria-label={t('paintings.model_parameters.pixel_budget')}
                  className="h-8 text-xs"
                  type="number"
                  min={1}
                  value={rule.maxPixels ?? ''}
                  onChange={(event) =>
                    setRule({ ...rule, maxPixels: event.target.value ? Number(event.target.value) : undefined })
                  }
                />
              </Label>
              <Label className="space-y-1 text-xs">
                {t('paintings.model_parameters.multiple')}
                <Input
                  aria-label={t('paintings.model_parameters.multiple')}
                  className="h-8 text-xs"
                  type="number"
                  min={1}
                  value={rule.multiple}
                  onChange={(event) =>
                    setRule({ ...rule, maxPixels: rule.maxPixels, multiple: Number(event.target.value) })
                  }
                />
              </Label>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('paintings.model_parameters.dimensions_hint')}</p>
          <div className="grid grid-cols-2 gap-2">
            <Label className="space-y-1 text-xs">
              {t('paintings.generate.width')}
              <Input
                aria-label={t('paintings.generate.width')}
                className="h-8 text-xs"
                type="number"
                min={1}
                value={dimensions[0] || ''}
                onChange={(event) => setDimension(0, event.target.value)}
              />
            </Label>
            <Label className="space-y-1 text-xs">
              {t('paintings.generate.height')}
              <Input
                aria-label={t('paintings.generate.height')}
                className="h-8 text-xs"
                type="number"
                min={1}
                value={dimensions[1] || ''}
                onChange={(event) => setDimension(1, event.target.value)}
              />
            </Label>
          </div>
          {selected && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange({ ...settings, canvases: settings.canvases?.filter((c) => c !== selected) })}>
              {t('common.reset')}
            </Button>
          )}
        </fieldset>
      </details>
      {preview && (
        <p className="text-xs text-muted-foreground">
          {t('paintings.image.size')}: {preview}
        </p>
      )}
    </div>
  )
}
