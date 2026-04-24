import { CustomTag } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { getProviderLabel } from '@renderer/i18n/label'
import { type Model, parseUniqueModelId } from '@shared/data/types/model'
import { useNavigate } from '@tanstack/react-router'
import { ArrowUpRight } from 'lucide-react'
import type { FC, MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('FreeTrialModelTag')

interface Props {
  model: Model
  showLabel?: boolean
  onBeforeNavigate?: () => void
}

const CHERRY_TRIAL_PROVIDER_OVERRIDES: Record<string, string> = {
  'Qwen/Qwen3-8B': 'cherryin',
  'Qwen/Qwen3-Next-80B-A3B-Instruct': 'cherryin'
}

function resolveTrialProviderId(model: Model): string {
  const apiModelId = model.apiModelId ?? parseUniqueModelId(model.id).modelId
  return CHERRY_TRIAL_PROVIDER_OVERRIDES[apiModelId] ?? model.providerId
}

/**
 * v2 版 FreeTrialModelTag：替换旧 src/renderer/src/components/FreeTrialModelTag.tsx 中
 * styled-components + antd 依赖；其余业务语义保持一致：
 * - 仅对 provider === 'cherryai' 的模型显示
 * - 特定试用模型 (Qwen/Qwen3-8B, Qwen/Qwen3-Next-80B-A3B-Instruct) 跳转到 cherryin provider
 */
export const FreeTrialModelTag: FC<Props> = ({ model, showLabel = true, onBeforeNavigate }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()

  if (model.providerId !== 'cherryai') {
    return null
  }

  const providerId = resolveTrialProviderId(model)

  const navigateToProvider = () => {
    onBeforeNavigate?.()
    navigate({ to: '/settings/provider', search: { id: providerId } }).catch((error) => {
      logger.error('Failed to navigate to provider settings', error as Error, { providerId })
    })
  }

  const handleTagClick = (event: MouseEvent) => {
    event.stopPropagation()
    navigateToProvider()
  }

  if (!showLabel) {
    return (
      <div className="inline-flex items-center">
        <CustomTag
          color="var(--color-primary)"
          size={11}
          onClick={handleTagClick}
          style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {getProviderLabel(providerId)}
          <ArrowUpRight size={12} />
        </CustomTag>
      </div>
    )
  }

  return (
    <div className="inline-flex flex-row items-center gap-1">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-primary shadow-[0_0_6px_var(--color-primary)]" />
      <span className="text-muted-foreground text-xs">{t('common.powered_by')}</span>
      <button
        type="button"
        className="cursor-pointer border-0 bg-transparent p-0 text-(--color-primary) text-xs hover:underline"
        onClick={navigateToProvider}>
        {getProviderLabel(providerId)}
      </button>
    </div>
  )
}
