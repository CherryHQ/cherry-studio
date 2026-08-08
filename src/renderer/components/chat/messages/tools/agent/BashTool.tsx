import { useTranslation } from 'react-i18next'

import {
  AgentToolsType,
  type BashToolInput as BashToolInputType,
  type BashToolOutput as BashToolOutputType,
  type PowerShellToolInput,
  type PowerShellToolOutput
} from '../shared/agentToolTypes'
import { SkeletonValue, ToolHeader, TruncatedIndicator } from '../shared/GenericTools'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { truncateOutput } from '../shared/truncateOutput'
import { TerminalOutput } from './TerminalOutput'

interface TerminalToolProps {
  input?: BashToolInputType | PowerShellToolInput
  output?: BashToolOutputType | PowerShellToolOutput
  toolName: typeof AgentToolsType.Bash | typeof AgentToolsType.PowerShell
}

function TerminalTool({ input, output, toolName }: TerminalToolProps): ToolDisclosureItem {
  const { t } = useTranslation()
  const command = input?.command
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: toolName,
    label: <ToolHeader toolName={toolName} args={input} variant="collapse-label" showStatus={false} />,
    children: (
      <div className="flex flex-col gap-3">
        {/* Command 输入区域 */}
        {command && (
          <div>
            <div className="mb-1 font-medium text-muted-foreground text-xs">{t('message.tools.sections.command')}</div>
            <TerminalOutput content={command} commandMode maxHeight="10rem" />
          </div>
        )}

        {/* Output 输出区域 */}
        {truncatedOutput ? (
          <div>
            <div className="mb-1 font-medium text-muted-foreground text-xs">{t('message.tools.sections.output')}</div>
            <TerminalOutput content={truncatedOutput} maxHeight="15rem" />
            {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
          </div>
        ) : (
          <SkeletonValue value={null} width="100%" fallback={null} />
        )}
      </div>
    )
  }
}

export function BashTool(props: { input?: BashToolInputType; output?: BashToolOutputType }): ToolDisclosureItem {
  return TerminalTool({ ...props, toolName: AgentToolsType.Bash })
}

export function PowerShellTool(props: {
  input?: PowerShellToolInput
  output?: PowerShellToolOutput
}): ToolDisclosureItem {
  return TerminalTool({ ...props, toolName: AgentToolsType.PowerShell })
}
