import type { ComponentProps } from 'react'

import { AgentWebUiControl } from '@renderer/components/localAgent/AgentWebUiControl'
import { CodeCli } from '@shared/types/codeCli'

import { useManagedLocalAgentDetails } from '../hooks/useManagedLocalAgentDetails'
import { CodeCliDialogs } from './CodeCliDialogs'
import { LocalAgentDetails } from './LocalAgentDirectory'
import { OpenClawStartupErrorAlert } from './OpenClawStartupErrorAlert'

export function ManagedLocalAgentDetails({
  tool,
  ...props
}: ComponentProps<typeof LocalAgentDetails> & {
  tool: CodeCli.DEEPSEEK_HARNESS | CodeCli.OPENCLAW
}) {
  const { modelList, webUi, dialogs } = useManagedLocalAgentDetails(tool)
  return (
    <LocalAgentDetails
      {...props}
      modelList={modelList}
      renderActions={(config, disabled) => (
        <AgentWebUiControl
          disabled={disabled || (!webUi.running && (!config.enabled || !webUi.canLaunch))}
          running={webUi.running}
          pending={webUi.pending}
          onStart={webUi.onLaunch}
          onStop={webUi.canStop ? webUi.onStop : undefined}
          onOpen={webUi.onOpen}
        />
      )}>
      {tool === CodeCli.OPENCLAW && webUi.startupError && (
        <OpenClawStartupErrorAlert
          startupError={webUi.startupError}
          onCopy={() => void webUi.onCopyStartupError?.()}
          onDismiss={() => webUi.onDismissStartupError?.()}
        />
      )}
      <CodeCliDialogs {...dialogs} />
    </LocalAgentDetails>
  )
}
