import type { CollapseProps } from 'antd'
import { Bot } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'

import { truncateTextOutputArray } from '../shared/truncateOutput'
import { SkeletonValue, ToolTitle, TruncatedIndicator } from './GenericTools'
import type { TaskToolInput as TaskToolInputType, TaskToolOutput as TaskToolOutputType } from './types'

export function TaskTool({
  input,
  output
}: {
  input?: TaskToolInputType
  output?: TaskToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const hasOutput = Array.isArray(output) && output.length > 0
  const { outputs: truncatedOutputs, isTruncated, originalLength } = truncateTextOutputArray(output)

  return {
    key: 'tool',
    label: (
      <ToolTitle
        icon={<Bot className="h-4 w-4" />}
        label={t('message.tools.labels.task')}
        params={<SkeletonValue value={input?.description} width="150px" />}
      />
    ),
    children: (
      <div className="flex flex-col gap-3">
        {/* Prompt 输入区域 */}
        {input?.prompt && (
          <div>
            <div className="mb-1 font-medium text-muted-foreground text-xs">{t('message.tools.sections.prompt')}</div>
            <div className="max-h-40 overflow-y-auto rounded-md bg-muted/50 p-2 text-sm">
              <Markdown>{input.prompt}</Markdown>
            </div>
          </div>
        )}

        {/* Output 输出区域 */}
        {hasOutput ? (
          <div>
            <div className="mb-1 font-medium text-muted-foreground text-xs">{t('message.tools.sections.output')}</div>
            <div className="rounded-md bg-muted/30 p-2">
              {truncatedOutputs.map((item, index) => (
                <div key={`${item.type}-${index}`}>
                  {item.type === 'text' ? <Markdown>{item.text}</Markdown> : <div>{item.text}</div>}
                </div>
              ))}
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
