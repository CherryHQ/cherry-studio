import { AccordionItem } from '@heroui/react'
import { FolderSearch } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type { GlobToolInput as GlobToolInputType, GlobToolOutput as GlobToolOutputType } from './types'

export function GlobTool({ input, output }: { input: GlobToolInputType; output?: GlobToolOutputType }) {
  // 如果有输出，计算文件数量
  const fileCount = output ? output.split('\n').filter((line) => line.trim()).length : 0

  return (
    <AccordionItem
      key="tool"
      aria-label="Glob Tool"
      title={
        <ToolTitle
          icon={<FolderSearch className="h-4 w-4" />}
          label="Glob"
          params={input.pattern}
          stats={output ? `${fileCount} found` : undefined}
        />
      }>
      <div>{output}</div>
    </AccordionItem>
  )
}
