import { loggerService } from '@logger'
import AiProvider from '@renderer/aiCore'
import { RefreshIcon } from '@renderer/components/Icons'
import { useProvider } from '@renderer/hooks/useProvider'
import { Model } from '@renderer/types'
import { getErrorMessage } from '@renderer/utils'
import { Button, InputNumber, Space, Tooltip } from 'antd'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

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

  const handleFetchDimension = useCallback(async () => {
    if (!model) {
      logger.warn('Failed to get embedding dimensions: no model')
      window.message.error(t('knowledge.embedding_model_required'))
      return
    }

    if (!provider) {
      logger.warn('Failed to get embedding dimensions: no provider')
      window.message.error(t('knowledge.provider_not_found'))
      return
    }

    setLoading(true)
    try {
      const aiProvider = new AiProvider(provider)
      const dimension = await aiProvider.getEmbeddingDimensions(model)
      // for controlled input
      if (ref?.current) {
        ref.current.value = dimension.toString()
      }
      onChange?.(dimension)
    } catch (error) {
      logger.error(t('message.error.get_embedding_dimensions'), error as Error)
      window.message.error(t('message.error.get_embedding_dimensions') + '\n' + getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [model, provider, t, onChange, ref])

  return (
    <Space.Compact style={{ width: '100%', ...style }}>
      <InputNumber
        ref={ref}
        min={1}
        style={{ flex: 1 }}
        placeholder={t('knowledge.dimensions_size_placeholder')}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
      <Tooltip title={t('knowledge.dimensions_auto_set')}>
        <Button
          role="button"
          aria-label="Get embedding dimension"
          disabled={disabled || loading}
          onClick={handleFetchDimension}
          icon={<RefreshIcon size={16} className={loading ? 'animation-rotate' : ''} />}
        />
      </Tooltip>
    </Space.Compact>
  )
}

export default memo(InputEmbeddingDimension)
