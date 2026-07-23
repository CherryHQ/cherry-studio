import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { toast } from '@renderer/services/toast'
import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { PrivacyPolicyDialog } from './PrivacyPolicyDialog'

const PESSIMISTIC_PREFERENCE_OPTIONS = { optimistic: false } as const

export function PrivacyPolicyUpdateGate() {
  const { t } = useTranslation()
  const [policyVersion, setPolicyVersion] = usePreference('app.privacy.policy_version', PESSIMISTIC_PREFERENCE_OPTIONS)
  const [showPolicy, setShowPolicy] = useState(false)
  const [isAcknowledging, setIsAcknowledging] = useState(false)
  const open = policyVersion !== LATEST_PRIVACY_POLICY_VERSION

  const acknowledge = useCallback(async () => {
    setIsAcknowledging(true)
    try {
      await setPolicyVersion(LATEST_PRIVACY_POLICY_VERSION)
    } catch {
      toast.error(t('privacy_policy_update.acknowledge_failed'))
    } finally {
      setIsAcknowledging(false)
    }
  }, [setPolicyVersion, t])

  return (
    <>
      <Dialog open={open && !showPolicy}>
        <DialogContent
          showCloseButton={false}
          closeOnOverlayClick={false}
          className="sm:max-w-[460px]"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}>
          <DialogHeader>
            <DialogTitle>{t('privacy_policy_update.title')}</DialogTitle>
            <DialogDescription className="leading-6">
              {t('privacy_policy_update.description_before_link')}
              <Button
                type="button"
                variant="link"
                className="h-auto px-1 py-0 align-baseline"
                onClick={() => setShowPolicy(true)}>
                {t('privacy_policy_update.policy')}
              </Button>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" loading={isAcknowledging} onClick={() => void acknowledge()}>
              {t('common.i_know')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <PrivacyPolicyDialog
        open={open && showPolicy}
        onAccept={acknowledge}
        isPending={isAcknowledging}
        acceptButtonText={t('common.i_know')}
      />
    </>
  )
}
