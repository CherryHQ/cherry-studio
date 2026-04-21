import type { LucideIcon } from 'lucide-react'
import type { FC } from 'react'

interface Props {
  icon: LucideIcon
  title: string
  description: string
}

const PlaceholderSection: FC<Props> = ({ icon: Icon, title, description }) => (
  <div className="flex h-full flex-col items-center justify-center py-20 text-center">
    <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xs bg-accent/30">
      <Icon size={24} strokeWidth={1.2} className="text-muted-foreground/25" />
    </div>
    <p className="mb-1 text-[13px] text-muted-foreground/50">{title}</p>
    <p className="text-[10px] text-muted-foreground/35">{description}</p>
  </div>
)

export default PlaceholderSection
