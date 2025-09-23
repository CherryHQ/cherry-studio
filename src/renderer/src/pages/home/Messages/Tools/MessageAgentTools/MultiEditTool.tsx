import { AccordionItem } from '@heroui/react'
import { FileText } from 'lucide-react'

import { renderCodeBlock } from './EditTool'
import { ToolTitle } from './GenericTools'
import type { MultiEditToolInput, MultiEditToolOutput } from './types'
import { AgentToolsType } from './types'

export function MultiEditTool({ input }: { input: MultiEditToolInput; output?: MultiEditToolOutput }) {
  return (
    <AccordionItem
      key={AgentToolsType.MultiEdit}
      aria-label="MultiEdit Tool"
      title={<ToolTitle icon={<FileText className="h-4 w-4" />} label="MultiEdit" params={input.file_path} />}>
      {input.edits.map((edit, index) => (
        <div key={index}>
          {renderCodeBlock(edit.old_string, 'old')}
          {renderCodeBlock(edit.new_string, 'new')}
        </div>
      ))}
    </AccordionItem>
  )
}
