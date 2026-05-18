import { Button, Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { Check, XIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { CodeToolMeta } from './types'

export type CodeToolDialogLaunchStatus = 'idle' | 'launching' | 'success'

interface CodeToolDialogProps {
  open: boolean
  tool: CodeToolMeta
  canLaunch: boolean
  status: CodeToolDialogLaunchStatus
  onClose: () => void
  onLaunch: () => void
  children?: ReactNode
}

export function CodeToolDialog({ open, tool, canLaunch, status, onClose, onLaunch, children }: CodeToolDialogProps) {
  const { t } = useTranslation()
  const launching = status === 'launching'
  const launched = status === 'success'

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/50"
        className="gap-0 overflow-hidden rounded-3xl border-0 bg-background p-0 shadow-xl sm:max-w-[560px]"
        aria-describedby={undefined}>
        <DialogHeader className="flex-row items-center justify-between gap-4 px-8 py-6 text-left">
          <div className="min-w-0">
            <DialogTitle className="font-semibold text-2xl leading-8">{tool.label}</DialogTitle>
          </div>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.close')}
              className="size-8 shrink-0 rounded-md text-muted-foreground shadow-none hover:bg-accent hover:text-foreground">
              <XIcon size={20} />
            </Button>
          </DialogClose>
        </DialogHeader>

        <div className="max-h-[min(68vh,720px)] overflow-y-auto px-8 py-7">
          <div className="flex flex-col gap-6">{children}</div>
        </div>

        <DialogFooter className="px-8 py-5 sm:justify-end">
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="lg"
              disabled={launching}
              className="rounded-lg text-muted-foreground shadow-none hover:bg-secondary hover:text-foreground">
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button
            variant="default"
            size="lg"
            onClick={onLaunch}
            loading={launching}
            disabled={!canLaunch || launching}
            className="rounded-lg shadow-none">
            {launched ? (
              <>
                <Check size={14} />
                <span>{t('code.launch.launched')}</span>
              </>
            ) : launching ? (
              <span>{t('code.launching')}</span>
            ) : (
              <span>{t('code.launch.label')}</span>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
