import { Provider } from '@renderer/types'
import { oauthWithAihubmix, oauthWithSiliconFlow } from '@renderer/utils/oauth'
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
  }

  return (
    <Button onClick={onAuth} {...buttonProps}>
      {t('auth.get_key')}
    </Button>
  )
}

export default OAuthButton
