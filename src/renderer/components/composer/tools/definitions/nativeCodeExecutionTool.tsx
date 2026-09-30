import type { FC } from 'react'
import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import { defineTool, type ToolLauncherApi } from '@renderer/components/composer/tools/types'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useProviderById } from '@renderer/hooks/useProvider'
import { isNativeCodeExecutionAvailable } from '@shared/utils/provider'

import { NATIVE_CODE_EXECUTION_TOOLBAR_MANIFEST } from '../toolbarManifests'

const NativeCodeExecutionRuntime: FC<{ assistantId: string; launcher: ToolLauncherApi }> = ({
  assistantId,
  launcher
}) => {
  const { t } = useTranslation()
  const { assistant, model, updateAssistant } = useAssistant(assistantId)
  const { provider } = useProviderById(model?.providerId)
  const enabled = assistant?.settings.enableNativeCodeExecution === true
  const available = isNativeCodeExecutionAvailable(model, provider)
  // Always let the user turn off a persisted toggle after switching models.
  const disabled = !enabled && !available
  const handleToggle = useCallback(() => {
    if (!assistant || disabled) return
    void updateAssistant({ settings: { enableNativeCodeExecution: !enabled } })
  }, [assistant, disabled, enabled, updateAssistant])

  useEffect(
    () =>
      launcher.registerLaunchers([
        {
          ...NATIVE_CODE_EXECUTION_TOOLBAR_MANIFEST.toolbar,
          sources: ['popover'],
          label: t('chat.input.native_code_execution'),
          description: t('chat.input.native_code_execution.description'),
          searchAliases: getQuickPanelSearchAliases(t, 'chat.input.native_code_execution', ['code execution']),
          disabledReason: disabled ? t('chat.input.native_code_execution.unavailable') : undefined,
          disabled,
          active: enabled && available,
          action: handleToggle
        }
      ]),
    [available, disabled, enabled, handleToggle, launcher, t]
  )
  return null
}

export default defineTool({
  key: 'native_code_execution',
  label: NATIVE_CODE_EXECUTION_TOOLBAR_MANIFEST.label,
  visibleInScopes: NATIVE_CODE_EXECUTION_TOOLBAR_MANIFEST.visibleInScopes,
  composer: {
    runtime: ({ context }) => (
      <NativeCodeExecutionRuntime assistantId={context.assistant!.id} launcher={context.launcher} />
    )
  }
})
