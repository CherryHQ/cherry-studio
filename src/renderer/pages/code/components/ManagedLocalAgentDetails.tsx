import { FileCode2 } from 'lucide-react'
import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
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
  const { t } = useTranslation()
  const view = useCodeCliPageViewProps(tool)
  const content = view.contentProps!
  const web = content.versionCard
  return (
    <LocalAgentDetails
      {...props}
      modelList={content.modelList}
      cliConfigEntry={
        <Tooltip content={t('code.tool_parameters')} asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0 rounded-lg"
            aria-label={t('code.tool_parameters')}
            disabled={content.modelList.disabled || !content.onConfigureCurrent}
            onClick={content.onConfigureCurrent}>
            <FileCode2 className="lucide-custom size-3.5 text-muted-foreground" />
          </Button>
        </Tooltip>
      }
      renderActions={(config, disabled) => (
        <AgentWebUiControl
          disabled={disabled || (!web.running && (!config.enabled || !web.canLaunch))}
          running={web.running}
          pending={web.launching || web.stopping}
          onStart={content.onLaunch}
          onStop={content.onStop}
          onOpen={content.onOpenDashboard}
        />
      )}>
      <CodeCliDialogs {...view} />
    </LocalAgentDetails>
  )
}
