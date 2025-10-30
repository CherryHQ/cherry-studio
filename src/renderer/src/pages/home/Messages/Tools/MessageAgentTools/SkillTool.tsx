import { AccordionItem } from '@heroui/react'

import { ToolTitle } from './GenericTools'
import type { SkillToolInput, SkillToolOutput } from './types'

export function SkillTool({ input, output }: { input: SkillToolInput; output?: SkillToolOutput }) {
  return (
    <AccordionItem
      key="tool"
      aria-label="Skill Tool"
      title={<ToolTitle icon={null} label="Skill" params={input.command} />}>
      {output}
    </AccordionItem>
  )
}
