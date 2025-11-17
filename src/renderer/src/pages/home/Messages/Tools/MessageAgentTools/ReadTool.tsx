import type { CollapseProps } from 'antd'
import { FileText } from 'lucide-react'
import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'

import { ToolTitle } from './GenericTools'
import type { ReadToolInput as ReadToolInputType, ReadToolOutput as ReadToolOutputType, TextOutput } from './types'
import { AgentToolsType } from './types'

export function ReadTool({
  input,
  output
}: {
  input: ReadToolInputType
  output?: ReadToolOutputType
}): NonNullable<CollapseProps['items']>[number] {
  // 移除 system-reminder 标签及其内容的辅助函数
  const removeSystemReminderTags = (text: string): string => {
    // 使用正则表达式匹配 <system-reminder> 标签及其内容，包括换行符
    return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
  }

  // 将 output 统一转换为字符串
  const outputString = useMemo(() => {
    if (!output) return null

    let processedOutput: string

    // 如果是 TextOutput[] 类型，提取所有 text 内容
    if (Array.isArray(output)) {
      processedOutput = output
        .filter((item): item is TextOutput => item.type === 'text')
        .map((item) => removeSystemReminderTags(item.text))
        .join('')
    } else {
      // 如果是字符串，直接使用
      processedOutput = output
    }

    // 移除 system-reminder 标签及其内容
    return removeSystemReminderTags(processedOutput)
  }, [output])

  // 如果有输出，计算统计信息
  const stats = useMemo(() => {
    if (!outputString) return null

    const bytes = new Blob([outputString]).size
    const formatSize = (bytes: number) => {
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    return {
      lineCount: outputString.split('\n').length,
      fileSize: bytes,
      formatSize
    }
  }, [outputString])

  return {
    key: AgentToolsType.Read,
    label: (
      <ToolTitle
        icon={<FileText className="h-4 w-4" />}
        label="Read File"
        params={input.file_path.split('/').pop()}
        stats={stats ? `${stats.lineCount} lines, ${stats.formatSize(stats.fileSize)}` : undefined}
      />
    ),
    children: outputString ? <ReactMarkdown>{outputString}</ReactMarkdown> : null
  }
}
