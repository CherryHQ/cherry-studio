import type { FC } from 'react'
import { useMemo } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { CommandContextKeyProvider, CommandProvider } from '@renderer/components/command'
import { DictationShortcutHost } from '@renderer/components/DictationShortcutHost'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'
import { FileEditSessionProvider } from '@renderer/components/FileEditSessionProvider'
import { McpInteractionHost } from '@renderer/components/McpInteractionHost'
import { PopupHost } from '@renderer/components/PopupHost'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import ToastHost from '@renderer/components/ToastHost'
import { VoicePlaybackHost } from '@renderer/components/VoicePlaybackHost'
import { WindowFatalFallback } from '@renderer/components/WindowFatalFallback'
import { useDataChange, useQuery } from '@renderer/data/hooks/useDataApi'
import { useAgentSessionAutoRenameSync } from '@renderer/hooks/agent/useSession'
import { useAutoReadPreferenceSync } from '@renderer/hooks/useAutoReadPreferenceSync'
import { useCustomCss } from '@renderer/hooks/useCustomCss'
import { useLanguageSync } from '@renderer/hooks/useLanguageSync'
import { useSelectionAgents } from '@renderer/hooks/useSelectionAgents'
import { useAppPathSnapshot, useDayjsLocaleSync } from '@renderer/hooks/useWindowRuntime'
import { parseSelectionActions } from '@renderer/utils/selectionAction'
import { type AskAgentSelectionAction, SELECTION_BUILTIN_ACTION_ID } from '@shared/types/selection'

import SelectionAgentWindow from './SelectionAgentWindow'

// Not useWindowRuntime: that one paints the root with the nav background, and this transparent
// window draws its own rounded surface.
function SelectionAgentRuntime(): null {
  useLanguageSync()
  useCustomCss()
  useDayjsLocaleSync()
  useAppPathSnapshot()
  useAutoReadPreferenceSync()
  useAgentSessionAutoRenameSync()
  // A pooled window loads what the compose bar labels while it waits, so a fresh bar shows its
  // agent and workspace at once instead of fallbacks. The agent read must match the bar's own.
  const [actionItems] = usePreference('feature.selection.action_items')
  const askAgentId = useMemo(
    () =>
      parseSelectionActions(actionItems ?? []).find(
        (action): action is AskAgentSelectionAction =>
          action.isBuiltIn && action.id === SELECTION_BUILTIN_ACTION_ID.ASK_AGENT
      )?.agentId ?? null,
    [actionItems]
  )
  useSelectionAgents([askAgentId])
  const { refetch: refetchWorkspaces } = useQuery('/agent-workspaces')
  useDataChange('/agent-workspaces', () => void refetchWorkspaces())
  return null
}

// No TabsProvider and no router: this window must never claim conversation ownership, so
// `navigation.focus_or_open_conversation` keeps landing in the main window.
const SelectionAgentApp: FC = () => {
  return (
    <ErrorBoundary fallbackComponent={WindowFatalFallback}>
      <ThemeProvider>
        <CodeStyleProvider>
          <FileEditSessionProvider>
            <CommandContextKeyProvider>
              <CommandProvider>
                <SelectionAgentRuntime />
                <ErrorBoundary>
                  <SelectionAgentWindow />
                </ErrorBoundary>
                <McpInteractionHost />
                <PopupHost />
                <ToastHost />
                <DictationShortcutHost />
                <VoicePlaybackHost />
              </CommandProvider>
            </CommandContextKeyProvider>
          </FileEditSessionProvider>
        </CodeStyleProvider>
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default SelectionAgentApp
