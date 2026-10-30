import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useChatLayoutMode } from '@renderer/components/chat/layout/ChatLayoutModeContext'
import { useConversationTopBarPortalLayout } from '@renderer/components/chat/shell/ConversationTopBarPortal'
import ComposerSurface, { type ComposerSurfaceActions } from '@renderer/components/composer/ComposerSurface'
import {
  ComposerToolDerivedStateProvider,
  ComposerToolRuntimeProvider,
  useComposerToolDispatch,
  useComposerToolLauncherActions,
  useComposerToolLauncherVersion,
  useComposerToolState
} from '@renderer/components/composer/ComposerToolRuntime'
import { getComposerToolConfig } from '@renderer/components/composer/tools/registry'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { toast } from '@renderer/services/toast'
import { TopicType } from '@renderer/types/topic'
import { resolveSendShortcut } from '@renderer/utils/input'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'

import { AGENT_MANAGED_TOKEN_KINDS } from '../agentComposerTokens'
import { emptyActions, type ProviderActionHandlers } from '../shared/composerProviderActions'
import { renderAgentToolbarControls } from './agentComposerControls'

type MissingAgentHomeComposerProps = {
  onAgentChange?: (agentId: string | null) => void | Promise<void>
  agentChanging?: boolean
}

type MissingAgentHomeComposerInnerProps = MissingAgentHomeComposerProps & {
  actionsRef: React.RefObject<ProviderActionHandlers>
}

const MissingAgentHomeComposerInner = ({
  onAgentChange,
  agentChanging,
  actionsRef
}: MissingAgentHomeComposerInnerProps) => {
  const config = getComposerToolConfig(TopicType.Session)
  const { files, isExpanded } = useComposerToolState()
  const { setFiles, setIsExpanded } = useComposerToolDispatch()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherActions()
  const toolLaunchersVersion = useComposerToolLauncherVersion()
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [fontSize] = usePreference('chat.message.font_size')
  const [storedSendShortcut] = usePreference('chat.input.send_message_shortcut')
  const sendMessageShortcut = resolveSendShortcut(storedSendShortcut)
  const [narrowMode] = usePreference('chat.narrow_mode')
  // Yield the same rail gutter as the message column so the composer stays aligned.
  const { railGutterPx } = useChatLayoutMode()
  const { available: topBarPortalAvailable, iconOnly: topBarPortalIconOnly } = useConversationTopBarPortalLayout()
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const selectAgentMessage = t('chat.alerts.select_agent')
  const handleSurfaceActionsChange = useCallback(
    (actions: ComposerSurfaceActions) => {
      Object.assign(actionsRef.current, actions)
    },
    [actionsRef]
  )
  const handleAgentChange = useCallback(
    async (nextAgentId: string | null) => {
      if (!nextAgentId) return
      await onAgentChange?.(nextAgentId)
    },
    [onAgentChange]
  )
  const handleBlockedSend = useCallback(() => {
    toast.error(selectAgentMessage)
  }, [selectAgentMessage])
  const placeholderText = t('agent.input.placeholder')
  const controlSlots = renderAgentToolbarControls({
    agent: undefined,
    selectAgentLabel: selectAgentMessage,
    model: undefined,
    selectModelLabel: t('button.select_model'),
    selectWorkspaceLabel: t('agent.session.workspace_selector.placeholder'),
    workspace: undefined,
    workspaceId: null,
    agentChanging,
    agentTriggerMode: 'selector',
    shouldAutoSelectCreatedAgent: true,
    topBarPortalAvailable,
    topBarPortalIconOnly,
    canChangeModel: false,
    onAgentChange: handleAgentChange,
    onModelSelect: () => undefined,
    // The workspace selector stays disabled until an agent creates a real session.
    onWorkspaceChange: undefined
  })

  return (
    <ComposerToolDerivedStateProvider couldAddImageFile={false} extensions={[]}>
      <ComposerSurface
        showAiDisclaimer
        text={text}
        onTextChange={setText}
        tokens={[]}
        draftTokens={[]}
        managedTokenKinds={AGENT_MANAGED_TOKEN_KINDS}
        onTokensChange={() => undefined}
        placeholder={placeholderText}
        sendMessageShortcut={sendMessageShortcut}
        sendDisabled
        sendBlockedReason={selectAgentMessage}
        isLoading={false}
        onSendDraft={handleBlockedSend}
        onPause={() => undefined}
        supportedExts={[]}
        setFiles={setFiles}
        filesCount={files.length}
        isExpanded={isExpanded}
        onExpandedChange={setIsExpanded}
        quickPanelEnabled={config.enableQuickPanel ?? true}
        enableDragDrop={false}
        enableSpellCheck={enableSpellCheck}
        fontSize={fontSize}
        narrowMode={narrowMode}
        railGutterPx={railGutterPx}
        onActionsChange={handleSurfaceActionsChange}
        getToolLaunchers={() => getLaunchers()}
        toolLaunchersVersion={toolLaunchersVersion}
        onToolLauncherSelect={(launcher, options) => dispatchLauncher(launcher, options)}
        deferQuickPanel
        {...controlSlots}
      />
    </ComposerToolDerivedStateProvider>
  )
}

export const MissingAgentHomeComposer = (props: MissingAgentHomeComposerProps) => {
  const initialState = useMemo(
    () => ({
      mentionedModels: [],
      selectedKnowledgeBases: [],
      files: [] as ComposerAttachment[],
      isExpanded: false,
      couldAddImageFile: false,
      extensions: [] as string[]
    }),
    []
  )
  const actionsRef = useRef<ProviderActionHandlers>({ ...emptyActions })

  return (
    <ComposerToolRuntimeProvider
      initialState={initialState}
      actions={{
        onTextChange: (updater) => actionsRef.current.onTextChange(updater),
        addNewTopic: () => undefined
      }}>
      <MissingAgentHomeComposerInner {...props} actionsRef={actionsRef} />
    </ComposerToolRuntimeProvider>
  )
}
