import { AccordionItem } from '@heroui/react'
import { Brain } from 'lucide-react'

import { ToolTitle } from './GenericTools'
import type { SkillToolInput, SkillToolOutput } from './types'

export function SkillTool({ input, output }: { input: SkillToolInput; output?: SkillToolOutput }) {
  return (
    <AccordionItem
      key="tool"
      aria-label="Skill Tool"
      title={<ToolTitle icon={<Brain className="h-4 w-4" />} label="Skill" params={input.command} />}>
      {output}
    </AccordionItem>
  )
}
