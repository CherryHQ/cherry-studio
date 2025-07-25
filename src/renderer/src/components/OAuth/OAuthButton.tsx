import { getProviderLabel } from '@renderer/i18n/label'
import { Provider } from '@renderer/types'
import { oauthWithAihubmix, oauthWithPPIO, oauthWithSiliconFlow, oauthWithTokenFlux } from '@renderer/utils/oauth'
import { Button, ButtonProps } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props extends ButtonProps {
  provider: Provider
  onSuccess?: (key: string) => void
}

const OAuthButton: FC<Props> = ({ provider, onSuccess, ...buttonProps }) => {
  const { t } = useTranslation()

  const onAuth = () => {
    const handleSuccess = (key: string) => {
      if (key.trim()) {
        onSuccess?.(key)
        window.message.success({ content: t('auth.get_key_success'), key: 'auth-success' })
      }
    }

    if (provider.id === 'silicon') {
      oauthWithSiliconFlow(handleSuccess)
    }

    if (provider.id === 'aihubmix') {
      oauthWithAihubmix(handleSuccess)
    }

    if (provider.id === 'ppio') {
      oauthWithPPIO(handleSuccess)
    }

    if (provider.id === 'tokenflux') {
      oauthWithTokenFlux()
    }
  }

  return (
    <Button type="primary" onClick={onAuth} shape="round" {...buttonProps}>
      {t('settings.provider.oauth.button', { provider: getProviderLabel(provider.id) })}
    </Button>
  )
}

export default OAuthButton
