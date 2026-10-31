import {
  BookOpen,
  Bot,
  Brain,
  Code,
  Cpu,
  Database,
  FileText,
  Palette,
  Sparkles,
  Terminal,
  Workflow,
  Wrench
} from 'lucide-react'

import type { MarketplaceSkill } from '@shared/types/skillMarketplace'

const icons = {
  bot: Bot,
  brain: Brain,
  code: Code,
  cpu: Cpu,
  database: Database,
  'file-text': FileText,
  'book-open': BookOpen,
  palette: Palette,
  sparkles: Sparkles,
  terminal: Terminal,
  workflow: Workflow,
  wrench: Wrench
}

export function MarketplaceSkillIcon({ skill, large = false }: { skill: MarketplaceSkill; large?: boolean }) {
  const Icon = skill.icon && Object.hasOwn(icons, skill.icon) ? icons[skill.icon as keyof typeof icons] : Sparkles
  return (
    <div
      className={`flex shrink-0 items-center justify-center border border-border-subtle bg-background text-muted-foreground ${large ? 'size-14 rounded-2xl shadow-sm' : 'size-10 rounded-xl'}`}>
      <Icon className={large ? 'size-7' : 'size-5'} strokeWidth={1.5} aria-hidden="true" />
    </div>
  )
}
