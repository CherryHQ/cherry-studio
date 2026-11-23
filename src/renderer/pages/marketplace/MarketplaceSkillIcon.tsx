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

import { Avatar, AvatarFallback, AvatarImage } from '@cherrystudio/ui'
import type { MarketplaceSkill } from '@shared/types/skillMarketplace'
import { parseSkillSourceUrl } from '@shared/utils/skillMarketplace'

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

export function MarketplaceSkillIcon({
  skill,
  large = false
}: {
  skill: Pick<MarketplaceSkill, 'icon' | 'sourceUrl'>
  large?: boolean
}) {
  const Icon = skill.icon && Object.hasOwn(icons, skill.icon) ? icons[skill.icon as keyof typeof icons] : Sparkles
  const source = skill.sourceUrl ? parseSkillSourceUrl(skill.sourceUrl) : null

  if (!skill.icon && (source?.sourceRegistry === 'skills.sh' || source?.sourceRegistry === 'claude-plugins.dev')) {
    const owner = source.installSource.slice(source.installSource.indexOf(':') + 1).split('/')[0]

    return (
      <Avatar className={large ? 'size-14 rounded-2xl shadow-sm' : 'size-10 rounded-xl'} aria-hidden="true">
        <AvatarImage src={`https://github.com/${owner}.png?size=96`} alt="" />
        <AvatarFallback className="rounded-[inherit] bg-background-subtle text-muted-foreground">
          <Icon className={large ? 'size-7' : 'size-5'} strokeWidth={1.5} />
        </AvatarFallback>
      </Avatar>
    )
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center border border-border-subtle bg-background text-muted-foreground ${large ? 'size-14 rounded-2xl shadow-sm' : 'size-10 rounded-xl'}`}>
      <Icon className={large ? 'size-7' : 'size-5'} strokeWidth={1.5} aria-hidden="true" />
    </div>
  )
}
