import PrivacyPopup from '@renderer/components/Popups/PrivacyPopup'
import { TopView } from '@renderer/components/TopView'
import { LATEST_PRIVACY_POLICY_VERSION } from '@renderer/config/constant'
import { useAppDispatch } from '@renderer/store'
import { setEnableDataCollection, setPrivacyPolicyVersion } from '@renderer/store/settings'
import { Button, Modal } from 'antd'
import type { FC } from 'react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  resolve: (data: any) => void
}

const PopupContainer: FC<Props> = ({ resolve }) => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [open, setOpen] = useState(true)

  const acknowledgeLatestPrivacyPolicy = useCallback(() => {
    dispatch(setPrivacyPolicyVersion(LATEST_PRIVACY_POLICY_VERSION))
    // Special Note (Regarding This Policy Update): Due to adjustments in our data collection architecture associated with this update, all related toggles under [Settings] - [General Settings] - [Privacy Settings] will be reset to their default ON state upon activation of the new version.
    // If you wish to maintain your previous OFF settings, please revisit the privacy settings page to make the necessary adjustments after upgrading. We apologize for any inconvenience this may cause and appreciate your understanding.
    if (String(LATEST_PRIVACY_POLICY_VERSION) === '20260531') {
      dispatch(setEnableDataCollection(true))
      void window.api.config.set('enableDataCollection', true)
    }
  }, [dispatch])

  const handleShowPrivacyPolicy = useCallback(() => {
    setOpen(false)
    void PrivacyPopup.show({
      acceptButtonText: t('common.i_know'),
      force: true,
      modal: true,
      onAccepted: acknowledgeLatestPrivacyPolicy,
      quitOnDecline: false,
      showDeclineButton: false
    })
  }, [acknowledgeLatestPrivacyPolicy, t])

  const handleAcknowledge = useCallback(() => {
    acknowledgeLatestPrivacyPolicy()
    setOpen(false)
  }, [acknowledgeLatestPrivacyPolicy])

  const onClose = () => {
    resolve({})
  }

  PrivacyPolicyUpdateNotice.hide = () => setOpen(false)

  return (
    <Modal
      title={t('privacy_policy_update.title')}
      open={open}
      afterClose={onClose}
      transitionName="animation-move-down"
      centered
      closable={false}
      keyboard={false}
      maskClosable={false}
      footer={
        <Button type="primary" onClick={handleAcknowledge}>
          {t('common.i_know')}
        </Button>
      }>
      <div>
        {t('privacy_policy_update.description_before_link')}
        <Button type="link" onClick={handleShowPrivacyPolicy} style={{ padding: 0, height: 'auto' }}>
          {t('privacy_policy_update.policy')}
        </Button>
      </div>
    </Modal>
  )
}

const TopViewKey = 'PrivacyPolicyUpdateNotice'

export default class PrivacyPolicyUpdateNotice {
  static hide() {
    TopView.hide(TopViewKey)
  }

  static show() {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
