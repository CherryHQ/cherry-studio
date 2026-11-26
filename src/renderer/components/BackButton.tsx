import { ArrowLeft } from 'lucide-react'
import type { ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { cn } from '@renderer/utils/style'

export function BackButton({ className, ...props }: Omit<ComponentProps<typeof Button>, 'children'>) {
  const { t } = useTranslation()
  return (
    <Button
      variant="ghost"
      aria-label={t('common.back')}
      {...props}
      className={cn(
        'group nodrag h-8 w-auto shrink-0 gap-1.5 rounded-none border-0 bg-transparent px-2.5 text-muted-foreground! text-sm shadow-none [-webkit-app-region:no-drag] hover:bg-transparent hover:text-foreground!',
        className
      )}>
      <ArrowLeft className="size-4 transition-colors group-hover:text-foreground" strokeWidth={1.7} aria-hidden />
      <span>{t('common.back')}</span>
    </Button>
  )
}
