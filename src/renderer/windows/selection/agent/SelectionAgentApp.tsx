import type { FC } from 'react'

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
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { useAgentSessionAutoRenameSync } from '@renderer/hooks/agent/useSession'
import { useAutoReadPreferenceSync } from '@renderer/hooks/useAutoReadPreferenceSync'
import { useCustomCss } from '@renderer/hooks/useCustomCss'
import { useLanguageSync } from '@renderer/hooks/useLanguageSync'
import { useAppPathSnapshot, useDayjsLocaleSync } from '@renderer/hooks/useWindowRuntime'

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
  // agent and workspace at once instead of fallbacks.
  useAgents()
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
