import type { FC } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { loggerService } from '@logger'
import { getQuickPanelSearchAliases } from '@renderer/components/composer/quickPanel'
import { defineTool, type ToolLauncherApi } from '@renderer/components/composer/tools/types'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useProviderById } from '@renderer/hooks/useProvider'
import { isNativeCodeExecutionAvailable } from '@shared/ai/nativeCodeExecution'

import { NATIVE_CODE_EXECUTION_TOOLBAR_MANIFEST } from '../toolbarManifests'

const logger = loggerService.withContext('NativeCodeExecutionRuntime')

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
  const toggleQueue = useRef({ assistantId, enabled, persisted: enabled, pending: 0, tail: Promise.resolve() })
  useEffect(() => {
    if (toggleQueue.current.assistantId !== assistantId) {
      toggleQueue.current = { assistantId, enabled, persisted: enabled, pending: 0, tail: Promise.resolve() }
    } else if (toggleQueue.current.pending === 0) {
      toggleQueue.current.enabled = enabled
      toggleQueue.current.persisted = enabled
    }
  }, [assistantId, enabled])

  const handleToggle = useCallback(() => {
    if (!assistant || disabled) return
    const queue = toggleQueue.current
    const next = !queue.enabled
    // Advance synchronously so another invocation of this closure sees the new
    // intent, and persist in order so slower writes cannot reverse the clicks.
    queue.enabled = next
    queue.pending += 1
    queue.tail = queue.tail
      .then(async () => {
        await updateAssistant({ settings: { enableNativeCodeExecution: next } })
        queue.persisted = next
      })
      .catch((error) => {
        if (queue.pending === 1) queue.enabled = queue.persisted
        logger.error('Failed to update native code execution setting', error)
      })
      .finally(() => {
        queue.pending -= 1
      })
  }, [assistant, disabled, updateAssistant])

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
      <NativeCodeExecutionRuntime
        key={context.assistant!.id}
        assistantId={context.assistant!.id}
        launcher={context.launcher}
      />
    )
  }
})
