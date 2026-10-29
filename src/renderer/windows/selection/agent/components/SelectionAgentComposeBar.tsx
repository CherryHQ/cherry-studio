import { Bot, CircleSlash, Folder, X } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, NormalTooltip, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import ComposerSurface, { type ComposerSurfaceActions } from '@renderer/components/composer/ComposerSurface'
import { ComposerToolRuntimeProvider } from '@renderer/components/composer/ComposerToolRuntime'
import {
  QUOTE_TOOLTIP_BODY_CLASS_NAME,
  QUOTE_TOOLTIP_CONTENT_CLASS_NAME
} from '@renderer/components/composer/quoteToken'
import type { ComposerDraftToken, ComposerSerializedDraft } from '@renderer/components/composer/tokens'
import { createQuoteToken } from '@renderer/components/composer/variants/shared/composerQuote'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { ClaudeCodeDownloadStatus } from '@renderer/pages/agents/ClaudeCodeDownloadStatus'
import { useClaudeCodeBinary } from '@renderer/pages/agents/useClaudeCodeBinary'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { getAgentAvatarFromConfiguration } from '@renderer/utils/agent'
import { resolveSendShortcut } from '@renderer/utils/input'
import { isMac } from '@renderer/utils/platform'
import { getSelectionAgentIssue, SELECTION_AGENT_ISSUE_HINT_KEYS } from '@renderer/utils/selectionAction'
import { cn } from '@renderer/utils/style'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'

import type { SelectionAgentTarget } from '../selectionAgentSession'
import { SelectionAgentCloseButton } from './SelectionAgentHeader'

const UNMANAGED_TOKEN_KINDS = [] as const
// The bar mounts no composer tools, so nothing calls these.
const NO_TOOL_ACTIONS = { addNewTopic: () => undefined, onTextChange: () => undefined }
const SELECTION_SETTINGS_PATH = '/settings/selection-assistant'

/** Puts the quote ahead of the instruction, as if it were the first token in the editor. */
function prependQuoteToken(draft: ComposerSerializedDraft, quote: ComposerDraftToken): ComposerSerializedDraft {
  const prefix = `${quote.promptText ?? ''}\n`
  return {
    text: prefix + draft.text,
    tokens: [
      { ...quote, index: 0, textOffset: 0 },
      ...draft.tokens.map((token) => ({
        ...token,
        index: token.index + 1,
        textOffset: token.textOffset + prefix.length
      }))
    ]
  }
}

interface SelectionAgentComposeBarProps {
  selectedText: string
  programName?: string
  /** Where the instruction goes, as bound in the selection settings. */
  target: SelectionAgentTarget
  sending: boolean
  /** A send failure shown under the input, e.g. a workspace that no longer exists. */
  error: string | null
  onSend: (draft: ComposerSerializedDraft) => void
}

/** The compose bar shown before the session exists: the quoted selection, an instruction, and where to run it. */
export const SelectionAgentComposeBar: FC<SelectionAgentComposeBarProps> = ({
  selectedText,
  programName,
  target,
  sending,
  error,
  onSend
}) => {
  const { t } = useTranslation()
  const [fontSize] = usePreference('chat.message.font_size')
  const [enableSpellCheck] = usePreference('app.spell_check.enabled')
  const [storedSendShortcut] = usePreference('chat.input.send_message_shortcut')
  const [text, setText] = useState('')
  const [hasQuote, setHasQuote] = useState(Boolean(selectedText))
  const focusedRef = useRef(false)
  const focusOnce = useCallback((actions: ComposerSurfaceActions) => {
    if (focusedRef.current) return
    focusedRef.current = true
    actions.focus('end')
  }, [])

  const { agents, isLoading: agentsLoading } = useAgents()
  const agent = target.agentId
    ? agents.find((candidate) => candidate.id === target.agentId)
    : agents.find((candidate) => candidate.configuration?.builtin_role === BUILTIN_AGENT_ROLE.ASSISTANT)
  // A missing Cherry Assistant is recreated on send, so only a bound agent can be unavailable here.
  const issue = agentsLoading || (!target.agentId && !agent) ? null : getSelectionAgentIssue(agent)
  const binary = useClaudeCodeBinary(agent?.type === 'claude-code')
  const { data: workspaces, refetch: refetchWorkspaces } = useQuery('/agent-workspaces')
  useDataChange('/agent-workspaces', () => void refetchWorkspaces())
  const workspaceId = target.workspace.type === AGENT_WORKSPACE_TYPE.USER ? target.workspace.workspaceId : null
  const workspace = workspaceId ? workspaces?.find((candidate) => candidate.id === workspaceId) : undefined
  const workspaceUnavailable = Boolean(workspaceId && workspaces && !workspace)

  const handleSendDraft = (draft: ComposerSerializedDraft) => {
    if (!hasQuote) return onSend(draft)
    const quote = createQuoteToken(selectedText, t('selection.action.builtin.quote'))
    const source = programName ? `\n${t('selection.agent.source', { app: programName })}` : ''
    onSend(prependQuoteToken(draft, { ...quote, promptText: `${quote.promptText}${source}` }))
  }
  const selectionLines = selectedText.trim().split('\n').length
  const selectionSize =
    selectionLines > 1
      ? t('selection.agent.line_count', { lines: selectionLines })
      : t('selection.agent.char_count', { length: selectedText.length })

  const blockedReason = issue
    ? t(SELECTION_AGENT_ISSUE_HINT_KEYS[issue])
    : workspaceUnavailable
      ? t('selection.agent.workspace_unavailable_hint')
      : undefined

  const controls = (
    <div className="flex min-w-0 items-center gap-1">
      <SelectionTargetLabel
        icon={
          agent ? (
            <span
              aria-hidden="true"
              className="inline-flex size-4.5 shrink-0 items-center justify-center rounded-sm bg-muted text-[11px] leading-none">
              {getAgentAvatarFromConfiguration(agent.configuration)}
            </span>
          ) : (
            <Bot className="size-3.5 text-muted-foreground" />
          )
        }
        label={agent?.name ?? t('chat.default.name')}
        unavailable={Boolean(issue)}
      />
      <SelectionTargetLabel
        icon={
          workspaceId === null ? (
            <CircleSlash className="size-3.5 text-muted-foreground" />
          ) : (
            <Folder className="size-3.5 text-muted-foreground" />
          )
        }
        label={
          workspaceId === null
            ? t('agent.session.workspace_selector.no_project')
            : workspaceUnavailable
              ? t('selection.agent.workspace_unavailable')
              : (workspace?.name ?? '')
        }
        unavailable={workspaceUnavailable}
      />
    </div>
  )

  return (
    <ComposerToolRuntimeProvider actions={NO_TOOL_ACTIONS}>
      <div className="flex flex-col pb-1">
        <div
          className={cn(
            'flex h-11 items-center gap-2.5 pr-2 [-webkit-app-region:drag]',
            isMac ? 'pl-[78px]' : 'pl-3.5'
          )}>
          <div className="min-w-0 flex-1">
            {hasQuote && <SelectionQuote text={selectedText} onRemove={() => setHasQuote(false)} />}
          </div>
          {hasQuote && (
            <span className="shrink-0 text-muted-foreground text-xs">
              {[programName, selectionSize].filter(Boolean).join(' · ')}
            </span>
          )}
          {!isMac && (
            <div className="[-webkit-app-region:no-drag]">
              <SelectionAgentCloseButton />
            </div>
          )}
        </div>
        {binary.blocked && <ClaudeCodeDownloadStatus status={binary.status} onRetry={binary.retry} />}
        <ComposerSurface
          text={text}
          onTextChange={setText}
          tokens={[]}
          draftTokens={[]}
          managedTokenKinds={UNMANAGED_TOKEN_KINDS}
          onTokensChange={() => undefined}
          placeholder={t('selection.agent.compose_placeholder')}
          sendMessageShortcut={resolveSendShortcut(storedSendShortcut)}
          sendDisabled={sending || binary.blocked || Boolean(blockedReason)}
          sendBlockedReason={blockedReason}
          isLoading={false}
          onSendDraft={handleSendDraft}
          onPause={() => undefined}
          supportedExts={[]}
          setFiles={() => undefined}
          filesCount={0}
          isExpanded={false}
          onExpandedChange={() => undefined}
          quickPanelEnabled={false}
          enableDragDrop={false}
          enableSpellCheck={enableSpellCheck}
          // The instruction is the bar's main content, so it reads a step above chat text.
          fontSize={fontSize + 4}
          narrowMode={false}
          embedded
          onActionsChange={focusOnce}
          renderLeftControls={() => controls}
          sendAccessory={<span className="text-muted-foreground text-xs">{t('selection.agent.saved_hint')}</span>}
        />
        {error ? (
          <div className="px-4 pb-3 text-error text-xs">{error}</div>
        ) : (
          blockedReason && <div className="px-4 pb-3 text-warning text-xs">{blockedReason}</div>
        )}
      </div>
    </ComposerToolRuntimeProvider>
  )
}

interface SelectionTargetLabelProps {
  icon: ReactNode
  label: string
  unavailable: boolean
}

/** Shows where the instruction goes; a click opens the selection settings, where it is changed. */
const SelectionTargetLabel: FC<SelectionTargetLabelProps> = ({ icon, label, unavailable }) => {
  const { t } = useTranslation()
  return (
    <Tooltip content={t('selection.agent.change_in_settings')} delay={300} asChild>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn('max-w-48 px-2 font-normal shadow-none', unavailable && 'text-warning hover:text-warning')}
        onClick={() => openSettingsTab(SELECTION_SETTINGS_PATH)}>
        {icon}
        <span className="truncate">{label}</span>
      </Button>
    </Tooltip>
  )
}

interface SelectionQuoteProps {
  text: string
  onRemove: () => void
}

/** The selection on one line in the reference colors; hover shows it whole and reveals the remove button. */
const SelectionQuote: FC<SelectionQuoteProps> = ({ text, onRemove }) => {
  const { t } = useTranslation()
  return (
    <div className="group/quote flex min-w-0 items-center gap-1 [-webkit-app-region:no-drag]">
      <NormalTooltip
        content={<div className={QUOTE_TOOLTIP_BODY_CLASS_NAME}>{text}</div>}
        side="bottom"
        sideOffset={6}
        delayDuration={300}
        showArrow={false}
        contentProps={{ className: QUOTE_TOOLTIP_CONTENT_CLASS_NAME }}
        triggerProps={{ tabIndex: 0, 'aria-label': t('selection.action.builtin.quote') }}>
        <div className="min-w-0 truncate text-sm">
          <mark className="box-decoration-clone rounded-xs bg-(--reference) px-0.75 py-0.5 text-(--reference-foreground)">
            {text.replace(/\s+/g, ' ').trim()}
          </mark>
        </div>
      </NormalTooltip>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={t('common.delete')}
        onClick={onRemove}
        className="size-5 shrink-0 rounded-full text-muted-foreground opacity-0 shadow-none group-hover/quote:opacity-100 focus-visible:opacity-100">
        <X className="size-3" />
      </Button>
    </div>
  )
}
