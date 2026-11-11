import type { FC } from 'react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { InfoTooltip, InputNumber } from '@cherrystudio/ui'
import { useProviderById } from '@renderer/hooks/useProvider'
import { supportsImageRequestTimeout } from '@renderer/utils/imageGenerationTimeout'
import { DEFAULT_IMAGE_REQUEST_TIMEOUT_MS } from '@shared/ai/imageGenerationTimeout'

import { type BaseConfigItem, isOptionsConfigItem } from '../form/baseConfigItem'
import { imageGenerationToFields } from '../form/imageGenerationToFields'
import { PaintingFieldRenderer } from '../form/PaintingFieldRenderer'
import { useImageGenerationSupport } from '../hooks/useImageGenerationSupport'
import type { PaintingData } from '../model/types/paintingData'
import { resolveImageRequestTimeoutMs } from '../utils/imageGenerationTimeout'
import { tabToImageGenerationMode } from '../utils/paintingProviderMode'
import PaintingSectionTitle from './PaintingSectionTitle'

function resolveItemOptions(item: BaseConfigItem, painting: Record<string, unknown>) {
  if (!isOptionsConfigItem(item)) return []
  return typeof item.options === 'function' ? item.options(item, painting) : (item.options ?? [])
}

/** Seconds; the upper bound matches the image-generation job's 30-minute budget. */
const REQUEST_TIMEOUT_MIN_SECONDS = 10
const REQUEST_TIMEOUT_MAX_SECONDS = 30 * 60

function shouldRenderConfigItem(item: BaseConfigItem, painting: Record<string, unknown>) {
  if (item.condition && !item.condition(painting)) {
    return false
  }
  if (item.type === 'sizeChips' && resolveItemOptions(item, painting).length === 0) {
    return false
  }
  return true
}

export interface PaintingSettingsProps {
  painting: PaintingData
  inputImageCount?: number
  onConfigChange: (updates: Partial<PaintingData>) => void
  onGenerateRandomSeed?: (key: string) => void
}

const PaintingSettings: FC<PaintingSettingsProps> = ({
  painting,
  inputImageCount = 0,
  onConfigChange,
  onGenerateRandomSeed
}) => {
  const { t } = useTranslation()
  // The form's reads/writes target `painting.params` — the canonical-name bag
  // that `canonicalGenerate` partitions into AI SDK args vs provider bag at
  // request time. Top-level PaintingData fields are not visible to the wire.
  const paintingParams = painting.params ?? {}
  const requestTimeoutSeconds = painting.requestTimeoutMs == null ? null : painting.requestTimeoutMs / 1000
  const { provider, error } = useProviderById(painting.providerId)
  const effectiveTimeoutMs = resolveImageRequestTimeoutMs(
    painting.providerId,
    painting.requestTimeoutMs,
    provider?.settings.imageRequestTimeoutMs
  )
  // The override only reaches transports that apply it; hide it where the value would be inert.
  const requestTimeoutSupported = supportsImageRequestTimeout(painting.providerId)
  const registrySupport = useImageGenerationSupport(painting.providerId, painting.model)
  const configItems = useMemo(
    () =>
      imageGenerationToFields(registrySupport, {
        mode: tabToImageGenerationMode(painting.mode, inputImageCount)
      }),
    [registrySupport, painting.mode, inputImageCount]
  )

  return (
    <>
      {configItems
        .filter((item) => shouldRenderConfigItem(item, paintingParams))
        .map((item) => (
          <div key={item.key ?? `${item.type}-${item.title ?? ''}`}>
            {item.title && (
              <PaintingSectionTitle>
                {t(item.title)}
                {/* range fields (e.g. numImages) interpolate their actual {{min}}-{{max}} */}
                {item.tooltip && (
                  <InfoTooltip
                    content={t(item.tooltip, item.type === 'slider' ? { min: item.min, max: item.max } : undefined)}
                  />
                )}
              </PaintingSectionTitle>
            )}
            <PaintingFieldRenderer
              item={item}
              painting={paintingParams}
              onChange={(updates) => onConfigChange({ params: { ...paintingParams, ...updates } })}
              onGenerateRandomSeed={onGenerateRandomSeed}
            />
          </div>
        ))}
      {requestTimeoutSupported && (
        <div>
          <PaintingSectionTitle>
            {t('paintings.request_timeout')}
            <InfoTooltip content={t('paintings.request_timeout_tip')} />
          </PaintingSectionTitle>
          <InputNumber
            aria-label={t('paintings.request_timeout')}
            className="w-28"
            min={REQUEST_TIMEOUT_MIN_SECONDS}
            max={REQUEST_TIMEOUT_MAX_SECONDS}
            step={10}
            value={requestTimeoutSeconds}
            onBlur={(value) => onConfigChange({ requestTimeoutMs: value === null ? undefined : value * 1000 })}
          />
          <div aria-live="polite">
            {provider
              ? t('paintings.request_timeout_effective', {
                  seconds: (effectiveTimeoutMs ?? DEFAULT_IMAGE_REQUEST_TIMEOUT_MS) / 1000
                })
              : error
                ? t('common.unknown')
                : t('common.loading')}
          </div>
        </div>
      )}
    </>
  )
}

export default PaintingSettings
