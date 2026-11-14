import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ScrollArea } from '@cherrystudio/ui'

import { useRightPanelActions } from '../Shell'

/** The profile pane has no title bar: a blank strip holds only the close button above the scrolling content. */
export function ProfilePaneFrame({ children }: { children?: ReactNode }) {
  const { t } = useTranslation()
  const actions = useRightPanelActions()
  const closeLabel = t('common.close_sidebar')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-(--navbar-height) shrink-0 items-center justify-end px-2.5 [-webkit-app-region:no-drag]">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={closeLabel}
          onClick={actions.close}
          className="size-8 rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
          <X className="size-4" />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1" viewportProps={{ className: 'overflow-x-hidden' }}>
        <div className="flex flex-col gap-5 px-4 pt-0 pb-6">{children}</div>
      </ScrollArea>
    </div>
  )
}
