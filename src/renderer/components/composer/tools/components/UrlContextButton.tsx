import { Tooltip } from '@cherrystudio/ui'
import ActionIconButton from '@renderer/components/ActionIconButton'
import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import type { ToolLauncherApi } from '@renderer/components/composer/tools/types'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useProvider } from '@renderer/hooks/useProvider'
import { toast } from '@renderer/services/toast'
import { getEffectiveMcpMode } from '@renderer/utils/mcpMode'
import {
  isAnthropicModel,
  isFunctionCallingModel,
  isGemini3Model,
  isGeminiModel,
  isPureGenerateImageModel
} from '@shared/utils/model'
import { isSupportUrlContextProvider } from '@shared/utils/provider'
import { Link2 } from 'lucide-react'
import type { FC, MouseEventHandler } from 'react'
import { memo, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  assistantId: string
  launcher: ToolLauncherApi
}

const useUrlContextToolController = ({ assistantId, launcher }: Props) => {
  const { t } = useTranslation()
  const { assistant, model, updateAssistant } = useAssistant(assistantId)
  const { provider: modelProvider } = useProvider(model?.providerId ?? '')

  const enableUrlContext = assistant?.settings.enableUrlContext ?? false
  // Mirrors the main-process gate (`resolveCapabilities`): the provider must
  // natively serve url-context (`serverTools`) and the model must be a
  // Gemini/Anthropic-family SKU.
  const supported = Boolean(
    model &&
      modelProvider &&
      isSupportUrlContextProvider(modelProvider) &&
      !isPureGenerateImageModel(model) &&
      (isGeminiModel(model) || isAnthropicModel(model))
  )
  const hasGeminiFunctionToolConflict = Boolean(
    assistant &&
      model &&
      isGeminiModel(model) &&
      !isGemini3Model(model) &&
      isFunctionCallingModel(model) &&
      getEffectiveMcpMode(assistant) !== 'disabled'
  )
  const disabledReason =
    !enableUrlContext && hasGeminiFunctionToolConflict ? t('chat.mcp.warning.url_context') : undefined
  // Keep it actionable while already on (so a switch to an unsupported model can
  // still be turned off), but block turning it on where it wouldn't apply.
  const isDisabled = !enableUrlContext && (!supported || Boolean(disabledReason))

  useEffect(() => {
    if (!enableUrlContext || !hasGeminiFunctionToolConflict) return
    toast.warning(t('chat.mcp.warning.url_context'))
    void updateAssistant({ settings: { enableUrlContext: false } })
  }, [enableUrlContext, hasGeminiFunctionToolConflict, t, updateAssistant])

  const onClick = useCallback(() => {
    if (!assistant || !model) {
      toast.error(t('error.model.not_exists'))
      return
    }
    if (isDisabled) return
    void updateAssistant({ settings: { enableUrlContext: !enableUrlContext } })
  }, [assistant, enableUrlContext, isDisabled, model, t, updateAssistant])

  const ariaLabel = enableUrlContext ? t('common.close') : t('chat.input.url_context')
  const icon = useMemo(() => <Link2 />, [])

  useEffect(() => {
    return launcher.registerLaunchers([
      {
        id: 'url-context',
        kind: 'command',
        sources: ['popover'],
        order: 31,
        label: t('chat.input.url_context'),
        description: '',
        searchAliases: getQuickPanelSearchAliases(t, 'chat.input.url_context', ['url']),
        icon,
        active: enableUrlContext,
        disabled: isDisabled,
        disabledReason,
        action: () => onClick()
      }
    ])
  }, [disabledReason, enableUrlContext, icon, isDisabled, launcher, onClick, t])

  return { ariaLabel, enableUrlContext, icon, isDisabled, onClick, tooltipTitle: disabledReason ?? ariaLabel }
}

export const UrlContextToolRuntime: FC<Props> = (props) => {
  useUrlContextToolController(props)
  return null
}

const UrlContextButton: FC<Props> = (props) => {
  const { ariaLabel, enableUrlContext, icon, isDisabled, onClick, tooltipTitle } = useUrlContextToolController(props)
  const handleClick = useCallback<MouseEventHandler<HTMLButtonElement>>(() => {
    onClick()
  }, [onClick])

  return (
    <Tooltip placement="top" content={tooltipTitle}>
      <ActionIconButton
        onClick={handleClick}
        active={enableUrlContext}
        aria-label={ariaLabel}
        aria-pressed={enableUrlContext}
        disabled={isDisabled}
        icon={icon}
      />
    </Tooltip>
  )
}

export default memo(UrlContextButton)
