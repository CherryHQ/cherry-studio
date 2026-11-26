import { useState } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { preferenceService } from '@data/PreferenceService'
import { AgentTerminalDialog } from '@renderer/components/localAgent/AgentTerminalDialog'
import { useAvailableTerminals } from '@renderer/hooks/agent/useAvailableTerminals'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { codeCliForLocalAgent } from '@renderer/utils/agent/codeCliForLocalAgent'
import type { LocalAgentPreset } from '@shared/ai/localAgent'
import type { CodeCliConfigs, CodeCliWorkspace } from '@shared/data/preference/preferenceTypes'
import { AbsoluteFilePathSchema } from '@shared/types/file'

const workspacePreferences = {
  configs: 'feature.code_cli.configs',
  workspace: 'feature.code_cli.workspace'
} as const

function resolveWorkspace(configs: CodeCliConfigs, key: string, workspace: CodeCliWorkspace) {
  if (workspace.directoryHistory !== undefined) {
    return { directory: workspace.directory, directoryHistory: workspace.directoryHistory }
  }

  const legacy = [configs[key], ...Object.values(configs)].filter((config) => config !== undefined)
  return {
    directory: legacy.find((config) => config.directory)?.directory,
    directoryHistory: [
      ...new Set(
        legacy.flatMap(({ directory, directoryHistory }) => directoryHistory ?? (directory ? [directory] : []))
      )
    ]
  }
}

export function LocalAgentTerminalDialog({
  open,
  preset,
  name,
  onClose,
  onLaunch
}: {
  open: boolean
  preset: LocalAgentPreset
  name: string
  onClose: () => void
  onLaunch: (options: { directory: string; terminal?: string }) => Promise<boolean>
}) {
  const [configs] = usePreference('feature.code_cli.configs')
  const [workspace, setWorkspace] = usePreference('feature.code_cli.workspace')
  const key = codeCliForLocalAgent(preset.id) ?? preset.id
  const saved = configs[key]
  const terminals = useAvailableTerminals(open)
  const [chosenDirectory, setDirectory] = useState<string>()
  const [chosenTerminal, setTerminal] = useState<string>()
  const [launching, setLaunching] = useState(false)
  const shared = resolveWorkspace(configs, key, workspace)
  const directory = chosenDirectory ?? shared.directory
  const terminal = chosenTerminal ?? saved?.terminal ?? terminals[0]?.id
  const close = () => {
    setDirectory(undefined)
    setTerminal(undefined)
    onClose()
  }
  const selectFolder = async () => {
    try {
      const selected = await ipcApi.request('file.select_folder', {
        defaultPath: AbsoluteFilePathSchema.safeParse(directory).data
      })
      if (selected) setDirectory(selected)
    } catch (error) {
      toast.error(String(error))
    }
  }
  const launch = async () => {
    if (!directory || launching) return
    setLaunching(true)
    try {
      const latest = await preferenceService.getMultiple(workspacePreferences)
      const { directoryHistory } = resolveWorkspace(latest.configs, key, latest.workspace)
      await preferenceService.setMultiple({
        'feature.code_cli.configs': {
          ...latest.configs,
          [key]: { providers: {}, current: null, ...latest.configs[key], terminal }
        },
        'feature.code_cli.workspace': {
          directory,
          directoryHistory: [directory, ...directoryHistory.filter((path) => path !== directory)]
        }
      })
      if (await onLaunch({ directory, terminal })) close()
    } catch (error) {
      toast.error(String(error))
    } finally {
      setLaunching(false)
    }
  }
  const removeDirectory = async (path: string) => {
    try {
      const latest = await preferenceService.getMultiple(workspacePreferences)
      const shared = resolveWorkspace(latest.configs, key, latest.workspace)
      await setWorkspace({
        ...shared,
        directoryHistory: shared.directoryHistory.filter((entry) => entry !== path)
      })
    } catch (error) {
      toast.error(String(error))
    }
  }
  return (
    <AgentTerminalDialog
      open={open}
      toolName={name}
      directory={directory}
      directoryHistory={shared.directoryHistory}
      onSelectDirectory={setDirectory}
      onRemoveDirectory={(path) => void removeDirectory(path)}
      terminals={terminals}
      selectedTerminal={terminal}
      launching={launching}
      onClose={close}
      onSelectFolder={() => void selectFolder()}
      onSelectTerminal={setTerminal}
      onLaunch={() => void launch()}
    />
  )
}
