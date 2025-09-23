import { AccordionItem } from '@heroui/react'
import { DoorOpen } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

import { ToolTitle } from './GenericTools'
import type { ExitPlanModeToolInput, ExitPlanModeToolOutput } from './types'
import { AgentToolsType } from './types'

export function ExitPlanModeTool({ input, output }: { input: ExitPlanModeToolInput; output?: ExitPlanModeToolOutput }) {
  return (
    <AccordionItem
      key={AgentToolsType.ExitPlanMode}
      aria-label="ExitPlanMode Tool"
      title={
        <ToolTitle
          icon={<DoorOpen className="h-4 w-4" />}
          label="ExitPlanMode"
          stats={`${input.plan.split('\n\n').length} plans`}
        />
      }>
      {<ReactMarkdown>{input.plan + '\n\n' + (output ?? '')}</ReactMarkdown>}
    </AccordionItem>
  )
}
