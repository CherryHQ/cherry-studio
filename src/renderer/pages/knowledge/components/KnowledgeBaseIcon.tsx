import { cn } from '@cherrystudio/ui/lib/utils'
import knowledgeBaseIcon from '@renderer/assets/images/knowledge-base.png'

const KnowledgeBaseIcon = ({ className }: { className?: string }) => {
  return (
    <span
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-950/30',
        className
      )}>
      <img src={knowledgeBaseIcon} alt="" className="size-6 object-contain" />
    </span>
  )
}

export default KnowledgeBaseIcon
