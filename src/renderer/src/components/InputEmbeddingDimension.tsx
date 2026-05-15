import { Button, Input, Tooltip } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import { RefreshIcon } from '@renderer/components/Icons'
import { useProvider } from '@renderer/hooks/useProvider'
import type { Model } from '@renderer/types'
import { getErrorMessage } from '@renderer/utils'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AiProvider } from '../aiCore'
import { getRotatedApiKey } from '../services/ApiService'

const logger = loggerService.withContext('DimensionsInput')

interface InputEmbeddingDimensionProps {
  value?: number | null
  onChange?: (value: number | null) => void
  model?: Model
  disabled?: boolean
  style?: React.CSSProperties
}

const InputEmbeddingDimension = ({
  ref,
  value,
  onChange,
  model,
  disabled: _disabled,
  style
}: InputEmbeddingDimensionProps & { ref?: React.RefObject<HTMLInputElement> | null }) => {
  const { t } = useTranslation()
  const { provider } = useProvider(model?.provider ?? '')
  const [loading, setLoading] = useState(false)

  const disabled = useMemo(() => _disabled || !model || !provider, [_disabled, model, provider])

  const handleDimensionChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const { value: nextValue, valueAsNumber } = event.currentTarget
      onChange?.(nextValue === '' || Number.isNaN(valueAsNumber) ? null : valueAsNumber)
    },
    [onChange]
  )

  const handleFetchDimension = useCallback(async () => {
    if (!model) {
      logger.warn('Failed to get embedding dimensions: no model')
      window.toast.error(t('knowledge.embedding_model_required'))
      return
    }

    if (!provider) {
      logger.warn('Failed to get embedding dimensions: no provider')
      window.toast.error(t('knowledge.provider_not_found'))
      return
    }

    setLoading(true)
    try {
      const providerWithRotatedKey = {
        ...provider,
        apiKey: getRotatedApiKey(provider)
      }
      const aiProvider = new AiProvider(providerWithRotatedKey)
      const dimension = await aiProvider.getEmbeddingDimensions(model)
      // for controlled input
      if (ref?.current) {
        ref.current.value = dimension.toString()
      }
      onChange?.(dimension)
    } catch (error) {
      logger.error(t('message.error.get_embedding_dimensions'), error as Error)
      window.toast.error(t('message.error.get_embedding_dimensions') + '\n' + getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [model, provider, t, onChange, ref])

  return (
    <div className="flex w-full" style={style}>
      <Input
        ref={ref}
        type="number"
        min={1}
        className="min-w-0 flex-1 rounded-r-none"
        placeholder={t('knowledge.dimensions_size_placeholder')}
        value={value ?? ''}
        onChange={handleDimensionChange}
        disabled={disabled}
      />
      <Tooltip content={t('knowledge.dimensions_auto_set')}>
        <Button
          role="button"
          aria-label={t('common.get_embedding_dimension')}
          disabled={disabled || loading}
          onClick={handleFetchDimension}
          className={cn('-ml-px rounded-l-none', loading && 'opacity-80')}
          size="icon-sm">
          <RefreshIcon size={16} className={loading ? 'animation-rotate' : ''} />
        </Button>
      </Tooltip>
    </div>
  )
}

export default memo(InputEmbeddingDimension)
