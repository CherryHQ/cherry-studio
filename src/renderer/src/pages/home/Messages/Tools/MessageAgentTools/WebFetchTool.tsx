import { AccordionItem } from '@heroui/react'
import { Globe } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type { WebFetchToolInput, WebFetchToolOutput } from './types'

export function WebFetchTool({ input, output }: { input: WebFetchToolInput; output?: WebFetchToolOutput }) {
  return (
    <AccordionItem
      key="tool"
      aria-label="Web Fetch Tool"
      title={<ToolTitle icon={<Globe className="h-4 w-4" />} label="Web Fetch" params={input.url} />}
      subtitle={input.prompt}>
      {output}
    </AccordionItem>
  )
}
