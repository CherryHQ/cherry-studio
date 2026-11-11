import type { ComponentProps } from 'react'

import { AgentWebUiControl } from '@renderer/components/localAgent/AgentWebUiControl'
import type { CodeCli } from '@shared/types/codeCli'

import { useCodeCliPageViewProps } from '../hooks/useCodeCliPageViewProps'
import { CodeCliDialogs } from './CodeCliPageView'
import { LocalAgentDetails } from './LocalAgentDirectory'

export function ManagedLocalAgentDetails({
  tool,
  ...props
}: ComponentProps<typeof LocalAgentDetails> & {
  tool: CodeCli.DEEPSEEK_HARNESS | CodeCli.OPENCLAW
}) {
  const view = useCodeCliPageViewProps(tool)
  const content = view.contentProps!
  const web = content.versionCard
  return (
    <LocalAgentDetails
      {...props}
      modelList={content.modelList}
      renderActions={(config, disabled) => (
        <AgentWebUiControl
          disabled={disabled || (!web.running && (!config.enabled || !web.canLaunch))}
          running={web.running}
          pending={web.launching || web.stopping}
          onStart={content.onLaunch}
          onStop={web.canStop === false ? undefined : content.onStop}
          onOpen={content.onOpenDashboard}
        />
      )}>
      <CodeCliDialogs {...view} />
    </LocalAgentDetails>
  )
}
