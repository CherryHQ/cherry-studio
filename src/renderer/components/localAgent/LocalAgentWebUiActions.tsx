import { ExternalLink, Loader2, Play, Square } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { useSharedCacheValue } from '@data/hooks/useCache'
import { useHermesDashboardController } from '@renderer/hooks/agent/useHermesDashboardController'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { codeCliForLocalAgent } from '@renderer/utils/agent/codeCliForLocalAgent'
import { cliTabIcon } from '@renderer/utils/tabIcons'
import { LOCAL_AGENT_PRESETS, type LocalAgentConfiguration } from '@shared/ai/localAgent'
import { CodeCli } from '@shared/types/codeCli'
import { LOCAL_AGENT_WEB_UI_IDS, type LocalAgentWebUiId } from '@shared/types/managedTool'

import { CodeBuddyWebUiActions } from './CodeBuddyWebUiActions'

interface Props {
  config: LocalAgentConfiguration
  disabled: boolean
}

export function LocalAgentWebUiActions(props: Props) {
  if (props.config.presetId === 'codebuddy-code') return <CodeBuddyWebUiActions {...props} />
  if (props.config.presetId === 'hermes') return <HermesWebUiActions disabled={props.disabled} />
  const id = LOCAL_AGENT_WEB_UI_IDS.find((id) => id === props.config.presetId)
  return id ? <ManagedWebUiActions key={id} {...props} id={id} /> : null
}

function HermesWebUiActions({ disabled }: { disabled: boolean }) {
  const controller = useHermesDashboardController(CodeCli.HERMES)
  return (
    <WebUiButtons
      disabled={disabled}
      running={controller.running}
      pending={controller.launching || controller.starting || controller.stopping}
      onStart={controller.onLaunch}
      onStop={() => void controller.onStop()}
      onOpen={controller.onOpenDashboard}
    />
  )
}

function ManagedWebUiActions({ config, disabled, id }: Props & { id: LocalAgentWebUiId }) {
  const { t } = useTranslation()
  const { openSmartMiniApp } = useMiniAppPopup()
  const statuses = useSharedCacheValue('feature.local_agent.web_ui.status')
  const [pending, setPending] = useState(false)
  const status = statuses?.[id]
  const open = (url: string) =>
    openSmartMiniApp({
      appId: `local-agent-web-${id}`,
      logo: cliTabIcon(codeCliForLocalAgent(id) ?? id),
      name: LOCAL_AGENT_PRESETS.find((preset) => preset.id === id)!.name,
      url
    })
  const run = async (stop: boolean) => {
    if (pending) return
    setPending(true)
    try {
      if (stop) await ipcApi.request('ai.local_agents.web_stop', { presetId: id })
      else {
        const result = await ipcApi.request('ai.local_agents.web_start', config)
        if (result.url) open(result.url)
      }
    } catch {
      toast.error(t(stop ? 'code.web_ui.stop_failed' : 'code.launch.error'))
    } finally {
      setPending(false)
    }
  }
  return (
    <WebUiButtons
      disabled={disabled}
      running={status?.status === 'running'}
      pending={pending || status?.status === 'starting'}
      onStart={() => void run(false)}
      onStop={() => void run(true)}
      onOpen={() => {
        if (status?.url) open(status.url)
      }}
    />
  )
}

function WebUiButtons({
  disabled,
  running,
  pending,
  onStart,
  onStop,
  onOpen
}: {
  disabled: boolean
  running: boolean
  pending: boolean
  onStart: () => void
  onStop: () => void
  onOpen: () => void
}) {
  const { t } = useTranslation()
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="h-8 rounded-lg border-border-subtle text-xs shadow-none"
        disabled={disabled || pending}
        onClick={running ? onStop : onStart}>
        {pending ? (
          <Loader2 className="lucide-custom size-3.5 animate-spin text-muted-foreground" />
        ) : running ? (
          <Square className="lucide-custom size-3.5 text-muted-foreground" />
        ) : (
          <Play className="lucide-custom size-3.5 text-muted-foreground" />
        )}
        {t(running ? 'code.stop' : 'code.launch.label')}
      </Button>
      {running && (
        <Button
          variant="outline"
          size="sm"
          className="h-8 rounded-lg border-border-subtle text-xs shadow-none"
          disabled={disabled || pending}
          onClick={onOpen}>
          <ExternalLink className="lucide-custom size-3.5 text-muted-foreground" />
          {t('code.open_web_ui')}
        </Button>
      )}
    </>
  )
}
