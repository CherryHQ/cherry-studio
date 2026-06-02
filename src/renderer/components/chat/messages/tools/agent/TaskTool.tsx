import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Streamdown } from 'streamdown'

import type { ToolDisclosureItem } from '../shared/ToolDisclosure'
import { truncateOutput } from '../shared/truncateOutput'
import { SkeletonValue, ToolHeader, TruncatedIndicator } from './GenericTools'
import {
  AgentToolsType,
  type TaskToolInput as TaskToolInputType,
  type TaskToolOutput as TaskToolOutputType
} from './types'

export function TaskTool({
  input,
  output,
  toolName = AgentToolsType.Task
}: {
  input?: TaskToolInputType
  output?: TaskToolOutputType
  toolName?: typeof AgentToolsType.Agent | typeof AgentToolsType.Task
}): ToolDisclosureItem {
  const { t } = useTranslation()

  const { truncatedText, isTruncated, originalLength } = useMemo(() => {
    const result = truncateOutput(output)
    return { truncatedText: result.data, isTruncated: result.isTruncated, originalLength: result.originalLength }
  }, [output])

  const hasOutput = truncatedText.length > 0

  return {
    key: toolName,
    label: (
      <ToolHeader
        toolName={toolName}
        args={input}
        params={<SkeletonValue value={input?.description} width="150px" />}
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: (
      <div className="flex flex-col gap-3">
        {/* Prompt 输入区域 */}
        {input?.prompt && (
          <div>
            <div className="mb-1 font-medium text-muted-foreground text-xs">{t('message.tools.sections.prompt')}</div>
            <div className="max-h-40 overflow-y-auto rounded-md bg-muted/50 p-2 text-sm">
              <Streamdown mode="static">{input.prompt}</Streamdown>
            </div>
          </div>
        )}

        {/* Output 输出区域 */}
        {hasOutput ? (
          <div>
            <div className="mb-1 font-medium text-muted-foreground text-xs">{t('message.tools.sections.output')}</div>
            <div className="rounded-md bg-muted/30 p-2">
              <Streamdown mode="static">{truncatedText}</Streamdown>
              {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
            </div>
          </div>
        ) : (
          <SkeletonValue value={null} width="100%" fallback={null} />
        )}
      </div>
    )
  }
}
