import { Button } from '@cherrystudio/ui'
import { BookOpenText, FolderPlus, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BaseNavigatorHeaderProps } from './types'

const BaseNavigatorHeader = ({ baseCount, onCreateGroup, onCreateBase }: BaseNavigatorHeaderProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex h-11 shrink-0 items-center justify-between px-3.5">
      <div className="flex min-w-0 items-center gap-1.5 text-sm leading-5">
        <BookOpenText className="size-3 text-foreground" />
        <span className="truncate text-foreground">{t('knowledge_v2.title')}</span>
        <span className="ml-0.5 text-muted-foreground/50">{baseCount}</span>
      </div>

      <div className="flex items-center gap-0.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-5 min-h-5 min-w-5 rounded p-0 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
          onClick={onCreateGroup}
          aria-label={t('knowledge_v2.groups.add')}>
          <FolderPlus className="size-3" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-5 min-h-5 min-w-5 rounded p-0 text-muted-foreground shadow-none hover:bg-accent hover:text-foreground"
          onClick={onCreateBase}
          aria-label={t('knowledge_v2.add.title')}>
          <Plus className="size-3" />
        </Button>
      </div>
    </div>
  )
}

export default BaseNavigatorHeader
