import { formatFileSize } from '@renderer/utils/file'
import type { CollapseProps } from 'antd'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'

import { truncateOutput } from '../shared/truncateOutput'
import { SkeletonValue, ToolHeader, TruncatedIndicator } from './GenericTools'
import type { ReadToolInput as ReadToolInputType, ReadToolOutput as ReadToolOutputType, TextOutput } from './types'
import { AgentToolsType } from './types'

const removeSystemReminderTags = (text: string): string => {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
}

const normalizeOutputString = (output?: ReadToolOutputType): string | null => {
  if (!output) return null

  const toText = (item: TextOutput) => removeSystemReminderTags(item.text)

  if (Array.isArray(output)) {
    return output
      .filter((item): item is TextOutput => item.type === 'text')
      .map(toText)
      .join('')
  }

  return removeSystemReminderTags(output)
}

const getOutputStats = (outputString: string | null) => {
  if (!outputString) return null

  return {
    lineCount: outputString.split('\n').length,
    fileSize: new Blob([outputString]).size
  }
}

export function ReadTool({
  input,
  output
}: {
  input?: ReadToolInputType
  output?: ReadToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  const { t } = useTranslation()
  const outputString = normalizeOutputString(output)
  const stats = getOutputStats(outputString)
  const filename = input?.file_path?.split('/').pop()
  const { data: truncatedOutput, isTruncated, originalLength } = truncateOutput(outputString)

  return {
    key: AgentToolsType.Read,
    label: (
      <ToolHeader
        toolName={AgentToolsType.Read}
        params={<SkeletonValue value={filename} width="120px" />}
        stats={
          stats
            ? `${stats.lineCount} ${t(stats.lineCount === 1 ? 'message.tools.units.line' : 'message.tools.units.lines')}, ${formatFileSize(stats.fileSize)}`
            : undefined
        }
        variant="collapse-label"
        showStatus={false}
      />
    ),
    children: truncatedOutput ? (
      <div>
        <ReactMarkdown>{truncatedOutput}</ReactMarkdown>
        {isTruncated && <TruncatedIndicator originalLength={originalLength} />}
      </div>
    ) : (
      <SkeletonValue value={null} width="100%" fallback={null} />
    )
  }
}
