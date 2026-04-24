import { Button } from '@cherrystudio/ui'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BaseNavigatorFooterProps } from './types'

const BaseNavigatorFooter = ({ onCreateBase }: BaseNavigatorFooterProps) => {
  const { t } = useTranslation()

  return (
    <div className="shrink-0 border-border/30 border-t px-2 py-1.5">
      <Button
        type="button"
        variant="ghost"
        className="h-7.25 min-h-7.25 w-full rounded-lg border border-border/40 border-dashed py-1.25 font-medium text-[0.6875rem] text-muted-foreground shadow-none hover:border-border/70 hover:bg-accent/60 hover:text-foreground"
        onClick={() => onCreateBase()}>
        <Plus className="size-3" />
        {t('knowledge_v2.add.title')}
      </Button>
    </div>
  )
}

export default BaseNavigatorFooter
