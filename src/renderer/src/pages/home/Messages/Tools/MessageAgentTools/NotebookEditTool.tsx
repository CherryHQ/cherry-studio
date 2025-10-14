import { AccordionItem } from '@heroui/react'
import { FileText } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

import { ToolTitle } from './GenericTools'
import type { NotebookEditToolInput, NotebookEditToolOutput } from './types'
import { AgentToolsType } from './types'

export function NotebookEditTool({ input, output }: { input: NotebookEditToolInput; output?: NotebookEditToolOutput }) {
  return (
    <AccordionItem
      key={AgentToolsType.NotebookEdit}
      aria-label="NotebookEdit Tool"
      title={<ToolTitle icon={<FileText className="h-4 w-4" />} label="NotebookEdit" />}
      subtitle={input.notebook_path}>
      <ReactMarkdown>{output}</ReactMarkdown>
    </AccordionItem>
  )
}
