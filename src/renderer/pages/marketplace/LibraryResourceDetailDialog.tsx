import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Markdown, Spinner } from '@cherrystudio/ui'
import { useDataChange, useQuery } from '@data/hooks/useDataApi'

export function LibraryResourceDetailDialog({
  id,
  onClose,
  onReturnFocus
}: {
  id: string
  onClose: () => void
  onReturnFocus: () => void
}) {
  const { t } = useTranslation()
  const prompt = useQuery('/prompts/:id', { params: { id } })
  useDataChange('/prompts', () => void prompt.refetch())
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-[85vh] max-h-[calc(100vh-3rem)] flex-col overflow-hidden rounded-3xl p-8 sm:max-w-4xl sm:p-10"
        overlayClassName="backdrop-blur-sm"
        closeLabel={t('common.close')}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onReturnFocus()
        }}>
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5 shrink-0" />
            <span className="break-all">{prompt.data?.title ?? t('marketplace.type.prompt')}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 space-y-8 overflow-y-auto text-sm">
          {prompt.error ? (
            <div role="alert">
              {t('common.error')}{' '}
              <Button variant="outline" onClick={() => void prompt.refetch().catch(() => undefined)}>
                {t('common.retry')}
              </Button>
            </div>
          ) : prompt.isLoading ? (
            <Spinner text={t('common.loading')} />
          ) : prompt.data ? (
            <>
              <div className="space-y-5">
                <h3 className="text-xs text-muted-foreground">{t('settings.prompts.scopeLabel')}</h3>
                <p>
                  {t(
                    prompt.data.visibility === 'global'
                      ? 'settings.prompts.visibility.global.badge'
                      : 'settings.prompts.visibility.restricted.badge'
                  )}
                </p>
              </div>
              <div className="space-y-5">
                <h3 className="text-xs text-muted-foreground">{t('settings.prompts.contentLabel')}</h3>
                <Markdown id={`library-prompt-${id}`}>{prompt.data.content}</Markdown>
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
