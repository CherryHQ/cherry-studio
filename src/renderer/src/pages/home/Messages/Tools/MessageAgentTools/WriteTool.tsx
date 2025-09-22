import { AccordionItem } from '@heroui/react'
import { FileText } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type { WriteToolInput, WriteToolOutput } from './types'

export function WriteTool({ input }: { input: WriteToolInput; output?: WriteToolOutput }) {
  return (
    <AccordionItem
      key="tool"
      aria-label="Write Tool"
      title={<ToolTitle icon={<FileText className="h-4 w-4" />} label="Write" params={input.file_path} />}>
      <div>{input.content}</div>
    </AccordionItem>
  )
}
