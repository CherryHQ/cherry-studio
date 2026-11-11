import { ScanLine } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { createComposerUserMessageParts } from '@renderer/components/composer/composerDraft'
import ComposerSurface, { type ComposerSurfaceProps } from '@renderer/components/composer/ComposerSurfaceRuntime'
import {
  ComposerPinnedToolsProvider,
  ComposerToolDerivedStateProvider,
  ComposerToolRuntimeHost,
  ComposerToolRuntimeProvider,
  useComposerTokenReconcile,
  useComposerToolDispatch,
  useComposerToolLauncherController,
  useComposerToolLauncherVersion,
  useComposerToolState
} from '@renderer/components/composer/ComposerToolRuntime'
import { ComposerPanelSymbol } from '@renderer/components/composer/quickPanel'
import type { ComposerSerializedDraft } from '@renderer/components/composer/tokens'
import { isMcpToolbarActive } from '@renderer/components/composer/tools/definitions/mcpToolbarState'
import { ComposerToolbarControls } from '@renderer/components/composer/variants/shared/ComposerControlScaffolding'
import { ComposerDictationButton } from '@renderer/components/composer/variants/shared/ComposerDictationButton'
import {
  emptyActions,
  type ProviderActionHandlers
} from '@renderer/components/composer/variants/shared/composerProviderActions'
import {
  fileToComposerToken,
  getComposerTokenIds,
  knowledgeBaseToComposerToken,
  composerFileTokenId
} from '@renderer/components/composer/variants/shared/composerTokens'
import {
  ComposerToolbarShortcuts,
  type ComposerToolbarCustomTool
} from '@renderer/components/composer/variants/shared/ComposerToolbarShortcuts'
import { useComposerFileCapabilities } from '@renderer/components/composer/variants/shared/useComposerFileCapabilities'
import { useComposerKnowledgeBaseScope } from '@renderer/components/composer/variants/shared/useComposerKnowledgeBaseScope'
import { useComposerToolbarPinnedTools } from '@renderer/components/composer/variants/shared/useComposerToolbarPinnedTools'
import { useScreenshotChat } from '@renderer/components/composer/variants/shared/useScreenshotChat'
import { McpLogo } from '@renderer/components/icons/SvgIcon'
import {
  ModelSpeedControl,
  resolveSupportedReasoningEffort,
  resolveSupportedServiceTier
} from '@renderer/components/ModelSpeedControl'
import { QuickPanelProvider, type QuickPanelListItem } from '@renderer/components/QuickPanel'
import { ResourceEditDialogEventHost } from '@renderer/components/resourceCatalog/dialogs/ResourceEditDialogEventHost'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { useAssistant } from '@renderer/hooks/useAssistant'
import { useKnowledgeBases } from '@renderer/hooks/useKnowledgeBase'
import { useModelById } from '@renderer/hooks/useModel'
import { readSideChatComposerDraft, useSideChats, writeSideChatComposerDraft } from '@renderer/hooks/useSideChats'
import { useTopicById } from '@renderer/hooks/useTopic'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { TopicType } from '@renderer/types/topic'
import { getErrorMessage } from '@renderer/utils/error'
import { buildFilePartsForAttachments, withComposerFilePartMeta } from '@renderer/utils/file/buildFileParts'
import { blobToDataUrl } from '@renderer/utils/image'
import type { ComposerAttachment } from '@renderer/utils/message/composerAttachment'
import { DEFAULT_ASSISTANT_SETTINGS, type Assistant } from '@shared/data/types/assistant'
import type { CherryMessagePart, FileUIPart, Message } from '@shared/data/types/message'
import type { Model } from '@shared/data/types/model'
import type { SideChatTurnSettings } from '@shared/data/types/sideChat'
import { withKnowledgeScopePart } from '@shared/data/types/uiParts'
import { createFilePathHandle, toFileUrl } from '@shared/utils/file'

import { useSideChatContext } from './SideChatContext'
import { SideChatToolControls } from './SideChatToolControls'

const EMPTY_MODELS: Model[] = []

type Props = Omit<ComposerSurfaceProps, 'onSendDraft'> & {
  temporary: boolean
  onSendDraft: (
    draft: ComposerSerializedDraft,
    parts: CherryMessagePart[],
    turnOptions: Message['data']['turnOptions']
  ) => Promise<boolean>
}

export function SideChatComposer(props: Props) {
  const context = useSideChatContext()!
  const [initialDraft] = useState(() =>
    context.selectedId ? readSideChatComposerDraft(context.selectedId) : undefined
  )
  return (
    <QuickPanelProvider>
      <ComposerToolRuntimeProvider
        initialState={{ files: initialDraft?.files ?? [] }}
        actions={{
          addNewTopic: () => undefined,
          onTextChange: (next) => props.onTextChange(typeof next === 'function' ? next(props.text) : next)
        }}>
        <SideChatComposerInput {...props} draftTokens={props.draftTokens ?? initialDraft?.tokens} />
      </ComposerToolRuntimeProvider>
    </QuickPanelProvider>
  )
}

function SideChatComposerInput({ temporary, onSendDraft, ...props }: Props) {
  const { t } = useTranslation()
  const context = useSideChatContext()!
  const [initialDraft] = useState(() =>
    context.selectedId ? readSideChatComposerDraft(context.selectedId) : undefined
  )
  const { topic } = useTopicById(context.agentId ? undefined : context.sourceTopicId)
  const loaded = useAssistant(topic?.assistantId, { loadDefaultModel: false })
  const { agent } = useAgent(context.agentId ?? null)
  const { model } = useModelById(context.modelId)
  const assistant = useMemo<Assistant | undefined>(() => {
    if (!agent) return loaded.assistant
    const disabled = new Set((agent.disabledTools ?? []).map((name) => name.replace(/^mcp__cherry-tools__/, '')))
    return {
      id: agent.id,
      name: agent.name,
      prompt: '',
      emoji: '💬',
      description: '',
      modelId: context.modelId ?? null,
      modelName: null,
      groupId: null,
      orderKey: '',
      createdAt: '',
      updatedAt: '',
      mcpServerIds: agent.mcps ?? [],
      knowledgeBaseIds: agent.knowledgeBaseIds ?? [],
      settings: {
        ...DEFAULT_ASSISTANT_SETTINGS,
        mcpMode: 'manual',
        enableWebSearch: !disabled.has('web_search') && !disabled.has('web_fetch'),
        enableGenerateImage: !disabled.has('generate_image')
      }
    }
  }, [agent, context.modelId, loaded.assistant])
  const views = useSideChats(context.sourceTopicId)
  const [turnOptions, setTurnOptions] = useState<NonNullable<Message['data']['turnOptions']>>(() => ({
    sideChat: views
      .find((view) => view.topicId === context.selectedId)
      ?.messages.findLast((message) => message.role === 'user')?.data.turnOptions?.sideChat
  }))
  const handlePermissionModeChange = useCallback((permissionMode: SideChatTurnSettings['permissionMode']) => {
    setTurnOptions((current) => ({ ...current, sideChat: { permissionMode, skills: [] } }))
  }, [])
  const reasoningEffort =
    turnOptions.reasoningEffort ??
    agent?.configuration?.reasoning_effort ??
    assistant?.settings.reasoning_effort ??
    'default'
  const serviceTier =
    turnOptions.serviceTier ?? agent?.configuration?.service_tier ?? assistant?.settings.service_tier ?? 'standard'
  const session = useMemo(() => (context.agentId ? { agentId: context.agentId } : undefined), [context.agentId])
  const { files, selectedKnowledgeBases } = useComposerToolState()
  const { setFiles, setSelectedKnowledgeBases, toolsRegistry } = useComposerToolDispatch()
  const { getLaunchers, dispatchLauncher } = useComposerToolLauncherController()
  const version = useComposerToolLauncherVersion()
  const reconcile = useComposerTokenReconcile({ scope: TopicType.Chat, assistant, model })
  const capabilities = useComposerFileCapabilities({ models: EMPTY_MODELS, fallbackModel: model })
  const { bases, isLoading } = useKnowledgeBases()
  const knowledge = useComposerKnowledgeBaseScope({
    configuredKnowledgeBaseIds: assistant?.knowledgeBaseIds,
    allKnowledgeBases: bases,
    isKnowledgeBasesLoading: isLoading,
    scopeKey: context.sourceTopicId ?? '',
    selectedKnowledgeBases,
    setSelectedKnowledgeBases,
    initialKnowledgeBaseIds: initialDraft?.knowledgeBaseIds ?? []
  })
  const pinned = useComposerToolbarPinnedTools('chat.input.toolbar.pinned_tools')
  const actions = useRef<ProviderActionHandlers>({ ...emptyActions })
  const [draftTokens, setDraftTokens] = useState(props.draftTokens)
  useEffect(() => {
    if (!context.selectedId) return
    writeSideChatComposerDraft(context.selectedId, {
      text: props.text,
      tokens: [...(draftTokens ?? [])],
      files,
      knowledgeBaseIds: knowledge.selectedKnowledgeBasesInScope.map((base) => base.id)
    })
  }, [context.selectedId, props.text, draftTokens, files, knowledge.selectedKnowledgeBasesInScope])
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const storedFiles = useRef(new WeakMap<ComposerAttachment, FileUIPart>())
  const { screenshotEnabled, startScreenshot } = useScreenshotChat({
    scopeKey: `side-chat:${context.selectedId ?? context.sourceTopicId}`,
    active: true,
    registerOnMount: false,
    actionsRef: actions,
    setFiles,
    isBlocked: () => sendingRef.current || props.isLoading
  })
  const rootPanelLeadingItems = useMemo<QuickPanelListItem[]>(
    () =>
      screenshotEnabled
        ? [
            {
              id: 'composer:screenshot',
              label: t('settings.shortcuts.screenshot_capture'),
              icon: <ScanLine size={16} />,
              action: startScreenshot
            }
          ]
        : [],
    [screenshotEnabled, startScreenshot, t]
  )
  useEffect(
    () => toolsRegistry.registerLaunchers('composer-toolbar-settings', [], [pinned.customizeFooterAction]),
    [toolsRegistry, pinned.customizeFooterAction]
  )
  const customTools: ComposerToolbarCustomTool[] = [
    {
      id: ComposerPanelSymbol.McpStatus,
      label: 'MCP',
      icon: <McpLogo width={18} height={18} />,
      active: isMcpToolbarActive({ scope: context.agentId ? TopicType.Session : TopicType.Chat, assistant, agent }),
      onSelect: ({ unifiedPanelControl }) =>
        unifiedPanelControl?.open({ launcherId: ComposerPanelSymbol.McpStatus, searchText: 'MCP' })
    },
    ...(screenshotEnabled
      ? [
          {
            id: 'composer:screenshot',
            label: t('settings.shortcuts.screenshot_capture'),
            icon: <ScanLine size={18} />,
            requiresPanel: false,
            availableWithoutModel: true,
            onSelect: startScreenshot
          }
        ]
      : [])
  ]
  const send = async (draft: ComposerSerializedDraft) => {
    if (sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    try {
      const tokenIds = getComposerTokenIds(draft.tokens)
      const attachments = files.filter((file) => tokenIds.has(composerFileTokenId(file)))
      if (attachments.length !== files.length) return
      const fileParts = temporary
        ? await Promise.all(
            attachments.map(async (file) => {
              const metadata = file.path
                ? await ipcApi.request('file.get_metadata', createFilePathHandle(file.path))
                : null
              const url = file.blob ? await blobToDataUrl(file.blob) : file.path ? toFileUrl(file.path) : undefined
              if (!url) throw new Error('Attachment has no readable source')
              return withComposerFilePartMeta(
                {
                  type: 'file',
                  mediaType:
                    file.blob?.type || (metadata?.kind === 'file' ? metadata.mime : 'application/octet-stream'),
                  url,
                  filename: file.origin_name || file.name
                },
                file
              )
            })
          )
        : await Promise.all(
            attachments.map(async (file) => {
              const cached = storedFiles.current.get(file)
              if (cached) return cached
              const [part] = await buildFilePartsForAttachments([file])
              storedFiles.current.set(file, part)
              return part
            })
          )
      const parts = withKnowledgeScopePart(
        [...createComposerUserMessageParts(draft), ...fileParts],
        knowledge.selectedKnowledgeBasesInScope.map((base) => base.id)
      )
      if (
        await onSendDraft(draft, parts, {
          reasoningEffort: model ? resolveSupportedReasoningEffort(model, reasoningEffort) : reasoningEffort,
          serviceTier: model ? resolveSupportedServiceTier(model, serviceTier) : serviceTier,
          fastMode: model?.supportsFastMode === true && turnOptions.fastMode === true,
          sideChat: {
            permissionMode: turnOptions.sideChat?.permissionMode ?? 'default',
            skills: draft.tokens
              .filter((token) => token.kind === 'skill')
              .map((token) => token.id.slice('skill:'.length))
          }
        })
      ) {
        setFiles([])
        setDraftTokens([])
        actions.current.replaceDraft({ text: '', tokens: [] })
      }
    } catch (cause) {
      toast.error(getErrorMessage(cause))
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }
  return (
    <ComposerToolDerivedStateProvider
      couldAddImageFile={capabilities.canAddImageFile}
      extensions={capabilities.supportedExts}
      selectableKnowledgeBases={knowledge.selectableKnowledgeBases}>
      <ComposerToolRuntimeHost
        scope={TopicType.Chat}
        menuScope={TopicType.Session}
        assistant={assistant}
        model={model}
        session={session}
      />
      <ResourceEditDialogEventHost />
      <ComposerPinnedToolsProvider value={pinned.pinnedIds}>
        <ComposerSurface
          {...props}
          tokens={[
            ...files.map(fileToComposerToken),
            ...knowledge.selectedKnowledgeBasesInScope.map(knowledgeBaseToComposerToken)
          ]}
          managedTokenKinds={knowledge.isKnowledgeBaseDraftHydrated ? ['file', 'knowledge'] : ['file']}
          onTokensChange={(tokens) => {
            reconcile(tokens)
            setDraftTokens([...tokens])
            props.onTokensChange(tokens)
          }}
          resolveKnowledgeBaseMarker={knowledge.resolveKnowledgeBaseMarker}
          supportedExts={capabilities.supportedExts}
          setFiles={setFiles}
          filesCount={files.length}
          quickPanelEnabled
          enableDragDrop
          editable={!sending && props.editable !== false}
          sendDisabled={sending || props.sendDisabled || (!props.text.trim() && files.length === 0)}
          onSendDraft={send}
          getToolLaunchers={getLaunchers}
          toolLaunchersVersion={version}
          onToolLauncherSelect={dispatchLauncher}
          onActionsChange={(value) => {
            Object.assign(actions.current, value)
            props.onActionsChange?.(value)
          }}
          rootPanelLeadingItems={rootPanelLeadingItems}
          renderLeftControls={(inputAdapter, unifiedPanelControl) => (
            <ComposerToolbarControls
              inputAdapter={inputAdapter}
              unifiedPanelControl={unifiedPanelControl}
              renderContextControls={() => (
                <SideChatToolControls
                  sourceTopicId={context.sourceTopicId!}
                  agentId={context.agentId}
                  permissionMode={turnOptions.sideChat?.permissionMode ?? 'default'}
                  onPermissionModeChange={handlePermissionModeChange}
                  unifiedPanelControl={unifiedPanelControl}
                  disabled={sending || props.isLoading || props.editable === false}
                />
              )}
              leading={
                <ComposerToolbarShortcuts
                  scope={TopicType.Chat}
                  menuScope={TopicType.Session}
                  pinnedIds={pinned.pinnedIds}
                  onPinnedIdsChange={pinned.setPinnedIds}
                  onResetPinnedIds={pinned.resetPinnedIds}
                  isDefault={pinned.isDefault}
                  customizeOpen={pinned.customizeOpen}
                  onCustomizeOpenChange={pinned.setCustomizeOpen}
                  customTools={customTools}
                  isModelUnavailable={!model}
                  inputAdapter={inputAdapter}
                  unifiedPanelControl={unifiedPanelControl}
                />
              }
            />
          )}
          sendAccessory={(inputAdapter) => (
            <>
              {model && (
                <ModelSpeedControl
                  model={model}
                  reasoningEffort={reasoningEffort}
                  serviceTier={serviceTier}
                  fastMode={turnOptions.fastMode}
                  onReasoningEffortChange={(reasoningEffort) =>
                    setTurnOptions((current) => ({ ...current, reasoningEffort }))
                  }
                  onServiceTierChange={(serviceTier) => setTurnOptions((current) => ({ ...current, serviceTier }))}
                  onFastModeChange={(fastMode) => setTurnOptions((current) => ({ ...current, fastMode }))}
                />
              )}
              <ComposerDictationButton inputAdapter={inputAdapter} />
            </>
          )}
        />
      </ComposerPinnedToolsProvider>
    </ComposerToolDerivedStateProvider>
  )
}
