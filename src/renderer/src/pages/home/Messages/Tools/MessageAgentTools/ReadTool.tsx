import type { CollapseProps } from 'antd'
import { FileText } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

import { ToolTitle } from './GenericTools'
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

  if (typeof output === 'string') {
    return removeSystemReminderTags(output)
  }

  return null
}

const getOutputStats = (outputString: string | null) => {
  if (!outputString) return null

  const bytes = new Blob([outputString]).size
  const formatSize = (size: number) => {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  return {
    lineCount: outputString.split('\n').length,
    fileSize: bytes,
    formatSize
  }
}

export function ReadTool({
  input,
  output
}: {
  input?: ReadToolInputType
  output?: ReadToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  const outputString = normalizeOutputString(output)
  const stats = getOutputStats(outputString)

  return {
    key: AgentToolsType.Read,
    label: (
      <ToolTitle
        icon={<FileText className="h-4 w-4" />}
        label="Read File"
        params={input?.file_path?.split('/').pop()}
        stats={stats ? `${stats.lineCount} lines, ${stats.formatSize(stats.fileSize)}` : undefined}
      />
    ),
    children: outputString ? <ReactMarkdown>{outputString}</ReactMarkdown> : null
  }
}
