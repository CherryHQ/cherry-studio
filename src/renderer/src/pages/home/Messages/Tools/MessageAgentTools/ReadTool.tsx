import { AccordionItem } from '@heroui/react'
import { FileText } from 'lucide-react'
import { useMemo } from 'react'
import ReactMarkdown from 'react-markdown'

import { ToolTitle } from './GenericTools'
import type { ReadToolInput as ReadToolInputType, ReadToolOutput as ReadToolOutputType, TextOutput } from './types'
import { AgentToolsType } from './types'

export function ReadTool({ input, output }: { input: ReadToolInputType; output?: ReadToolOutputType }) {
  // 将 output 统一转换为字符串
  const outputString = useMemo(() => {
    if (!output) return null

    // 如果是 TextOutput[] 类型，提取所有 text 内容
    if (Array.isArray(output)) {
      return output
        .filter((item): item is TextOutput => item.type === 'text')
        .map((item) => item.text)
        .join('')
    }

    // 如果是字符串，直接返回
    return output
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

  return (
    <AccordionItem
      key={AgentToolsType.Read}
      aria-label="Read Tool"
      title={
        <ToolTitle
          icon={<FileText className="h-4 w-4" />}
          label="Read File"
          params={input.file_path.split('/').pop()}
          stats={stats ? `${stats.lineCount} lines, ${stats.formatSize(stats.fileSize)}` : undefined}
        />
      }>
      {outputString ? <ReactMarkdown>{outputString}</ReactMarkdown> : null}
    </AccordionItem>
  )
}
