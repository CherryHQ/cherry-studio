import { useState } from 'react'

import { usePreference } from '@data/hooks/usePreference'
import { preferenceService } from '@data/PreferenceService'
import { useAvailableTerminals } from '@renderer/hooks/agent/useAvailableTerminals'
import { toast } from '@renderer/services/toast'
import { codeCliForLocalAgent } from '@renderer/utils/agent/codeCliForLocalAgent'
import type { LocalAgentPreset } from '@shared/ai/localAgent'

import { AgentTerminalDialog } from './AgentTerminalDialog'

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
  const [configs, setConfigs] = usePreference('feature.code_cli.configs')
  const key = codeCliForLocalAgent(preset.id) ?? preset.id
  const saved = configs[key]
  const terminals = useAvailableTerminals(open)
  const [chosenDirectory, setDirectory] = useState<string>()
  const [chosenTerminal, setTerminal] = useState<string>()
  const [launching, setLaunching] = useState(false)
  const directory = chosenDirectory ?? saved?.directory
  const terminal = chosenTerminal ?? saved?.terminal ?? terminals[0]?.id
  const directoryHistory = saved?.directoryHistory ?? (saved?.directory ? [saved.directory] : [])
  const close = () => {
    setDirectory(undefined)
    setTerminal(undefined)
    onClose()
  }
  const selectFolder = async () => {
    try {
      const selected = await window.api.file.selectFolder({ defaultPath: directory })
      if (selected) setDirectory(selected)
    } catch (error) {
      toast.error(String(error))
    }
  }
  const launch = async () => {
    if (!directory || launching) return
    setLaunching(true)
    try {
      const latest = await preferenceService.get('feature.code_cli.configs')
      const previous = latest[key]
      const history = previous?.directoryHistory ?? (previous?.directory ? [previous.directory] : [])
      await setConfigs({
        ...latest,
        [key]: {
          providers: {},
          current: null,
          ...previous,
          directory,
          terminal,
          directoryHistory: [directory, ...history.filter((path) => path !== directory)]
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
      const latest = await preferenceService.get('feature.code_cli.configs')
      const previous = latest[key]
      const history = previous?.directoryHistory ?? (previous?.directory ? [previous.directory] : [])
      await setConfigs({
        ...latest,
        [key]: {
          providers: {},
          current: null,
          ...previous,
          directoryHistory: history.filter((entry) => entry !== path)
        }
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
      directoryHistory={directoryHistory}
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
