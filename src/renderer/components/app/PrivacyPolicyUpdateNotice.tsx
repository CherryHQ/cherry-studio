import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import PrivacyPopup from '@renderer/components/Popups/PrivacyPopup'
import { useTopViewClose } from '@renderer/components/Popups/useTopViewClose'
import { TopView } from '@renderer/components/TopView'
import { LATEST_PRIVACY_POLICY_VERSION } from '@renderer/config/constant'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  resolve: (data: Record<string, never>) => void
}

const TopViewKey = 'PrivacyPolicyUpdateNotice'

const PopupContainer: FC<Props> = ({ resolve }) => {
  const { t } = useTranslation()
  const [, setEnableDataCollection] = usePreference('app.privacy.data_collection.enabled')
  const [, setPrivacyPolicyVersion] = usePreference('app.privacy.policy_version')
  const [open, setOpen] = useState(true)
  const close = useTopViewClose({ resolve, setOpen, topViewKey: TopViewKey })

  const acknowledgeLatestPrivacyPolicy = useCallback(() => {
    void setPrivacyPolicyVersion(LATEST_PRIVACY_POLICY_VERSION)
    void setEnableDataCollection(true)
    void window.api.config.set('enableDataCollection', true)
  }, [setEnableDataCollection, setPrivacyPolicyVersion])

  const handleShowPrivacyPolicy = useCallback(() => {
    close({})
    void PrivacyPopup.show({
      acceptButtonText: t('common.i_know'),
      force: true,
      modal: true,
      onAccepted: acknowledgeLatestPrivacyPolicy,
      quitOnDecline: false,
      showDeclineButton: false
    })
  }, [acknowledgeLatestPrivacyPolicy, close, t])

  const handleAcknowledge = useCallback(() => {
    acknowledgeLatestPrivacyPolicy()
    close({})
  }, [acknowledgeLatestPrivacyPolicy, close])

  PrivacyPolicyUpdateNotice.hide = () => close({})

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && close({})}>
      <DialogContent
        className="sm:max-w-[520px]"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('privacy_policy_update.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm leading-6">
          {t('privacy_policy_update.description_before_link')}
          <Button className="h-auto px-0 text-sm" variant="link" onClick={handleShowPrivacyPolicy}>
            {t('privacy_policy_update.policy')}
          </Button>
        </p>
        <DialogFooter>
          <Button onClick={handleAcknowledge}>{t('common.i_know')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default class PrivacyPolicyUpdateNotice {
  static hide() {
    TopView.hide(TopViewKey)
  }

  static show() {
    return new Promise<Record<string, never>>((resolve) => {
      TopView.show(<PopupContainer resolve={resolve} />, TopViewKey)
    })
  }
}
