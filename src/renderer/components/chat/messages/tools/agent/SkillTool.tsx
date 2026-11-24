import { useTranslation } from 'react-i18next'

import { AgentToolsType } from '../shared/agentToolTypes'
import { SkeletonValue, ToolHeader, TruncatedIndicator } from '../shared/GenericTools'
import { readToolStringArgument } from '../shared/toolArgumentObject'
import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import type { ToolDisplayProps } from '../shared/toolDisplay'
import { truncateOutput } from '../shared/truncateOutput'

export function SkillTool({ input, output }: ToolDisplayProps): ToolDisclosureItem {
  const { t } = useTranslation()
  const skillName = readToolStringArgument(input, 'skill') ?? readToolStringArgument(input, 'name')
  const args = readToolStringArgument(input, 'args')
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(output)

  return {
    key: AgentToolsType.Skill,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Skill}
        args={input}
        params={<SkeletonValue value={skillName} width="150px" />}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div className="flex flex-col gap-3">
        {/* Args 输入区域 */}
        {args && (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">{t('message.tools.sections.args')}</div>
            <div className="max-h-40 overflow-y-auto rounded-md bg-muted/50 p-2">
              <code className="font-mono text-xs break-all whitespace-pre-wrap">{args}</code>
            </div>
          </div>
        )}

        {/* Output 输出区域 */}
        {truncatedOutput ? (
          <div>
            <div className="mb-1 text-xs font-medium text-muted-foreground">{t('message.tools.sections.output')}</div>
            <div className="max-h-60 overflow-y-auto rounded-md bg-muted/30 p-2">
              <pre className="font-mono text-xs whitespace-pre-wrap">{truncatedOutput}</pre>
            </div>
            {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
          </div>
        ) : (
          <SkeletonValue value={null} width="100%" fallback={null} />
        )}
      </div>
    )
  }
}
