import { AccordionItem } from '@heroui/react'
import { FileEdit } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type { EditToolInput, EditToolOutput } from './types'
import { AgentToolsType } from './types'

// 处理多行文本显示
export const renderCodeBlock = (content: string, variant: 'old' | 'new') => {
  const lines = content.split('\n')
  const textColorClass =
    variant === 'old' ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'

  return (
    // 删除线
    <pre className={`whitespace-pre-wrap font-mono text-xs ${textColorClass}`}>
      {lines.map((line, idx) => (
        <div key={idx} className="flex hover:bg-default-100/50 dark:hover:bg-default-900/50">
          <span className="mr-3 min-w-[2rem] select-none text-right opacity-50">
            {variant === 'old' && '-'}
            {variant === 'new' && '+'}
            {idx + 1}
          </span>
          <span className={`flex-1 ${variant === 'old' && 'line-through'}`}>{line || ' '}</span>
        </div>
      ))}
    </pre>
  )
}

export function EditTool({ input, output }: { input: EditToolInput; output?: EditToolOutput }) {
  return (
    <AccordionItem
      key={AgentToolsType.Edit}
      aria-label="Edit Tool"
      title={<ToolTitle icon={<FileEdit className="h-4 w-4" />} label="Edit" params={input.file_path} />}>
      {/* Diff View */}
      {/* Old Content */}
      {renderCodeBlock(input.old_string, 'old')}
      {/* New Content */}
      {renderCodeBlock(input.new_string, 'new')}
      {/* Output */}
      {output}
    </AccordionItem>
  )
}
