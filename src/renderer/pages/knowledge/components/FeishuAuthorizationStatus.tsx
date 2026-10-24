import { ExternalLink, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, DialogFooter, InfoTooltip } from '@cherrystudio/ui'

interface FeishuAuthorizationStatusProps {
  userCode: string
  verificationUri: string
  onCancel: () => void
}

const FeishuAuthorizationStatus = ({ userCode, verificationUri, onCancel }: FeishuAuthorizationStatusProps) => {
  const { t } = useTranslation()

  return (
    <>
      <p role="status" className="flex items-center gap-2 text-sm font-medium">
        <LoaderCircle className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden />
        {t('knowledge.external.wizard.authorizing')}
      </p>
      <DialogFooter className="shrink-0 flex-row flex-wrap items-center justify-between gap-3 border-t pt-4 sm:justify-between">
        <div className="text-muted-foreground flex max-w-full min-w-0 items-center gap-1 text-xs">
          <p className="wrap-anywhere select-text">
            {t('knowledge.external.wizard.verification_code', { code: userCode })}
          </p>
          <InfoTooltip content={t('knowledge.external.wizard.authorization_help')} portalContainer={document.body} />
        </div>
        <div className="ml-auto flex max-w-full flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="emphasis" onClick={() => void window.api.shell.openExternal(verificationUri)}>
            {t('knowledge.external.wizard.open_authorization_page')}
            <ExternalLink className="size-3.5" aria-hidden />
          </Button>
        </div>
      </DialogFooter>
    </>
  )
}

export default FeishuAuthorizationStatus
