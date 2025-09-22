import { AccordionItem } from '@heroui/react'
import { FileText } from 'lucide-react'

import { SimpleFieldInputTool, StringOutputTool, ToolTitle } from './GenericTools'
import type { ReadToolInput as ReadToolInputType, ReadToolOutput as ReadToolOutputType } from './types'

export function ReadTool({ input, output }: { input: ReadToolInputType; output?: ReadToolOutputType }) {
  // 如果有输出，计算统计信息
  const stats = output
    ? {
        lineCount: output.split('\n').length,
        fileSize: new Blob([output]).size,
        formatSize: (bytes: number) => {
          if (bytes < 1024) return `${bytes} B`
          if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
          return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
        }
      }
    : null

  return (
    <AccordionItem
      key="tool"
      aria-label="Read Tool"
      title={
        <ToolTitle
          icon={<FileText className="h-4 w-4" />}
          label="Read File"
          params={input.file_path.split('/').pop()}
          stats={output && stats ? `${stats.lineCount} lines, ${stats.formatSize(stats.fileSize)}` : undefined}
        />
      }>
      <div>
        <SimpleFieldInputTool input={input} label="File Path" fieldName="file_path" />
        {output && (
          <div>
            <StringOutputTool output={output} label="File Content" />
          </div>
        )}
      </div>
    </AccordionItem>
  )
}
