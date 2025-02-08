import { Provider } from '@renderer/types'
import { oauthWithAihubmix, oauthWithSiliconFlow } from '@renderer/utils/oauth'
import { Button, ButtonProps } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props extends ButtonProps {
  provider: Provider
  onSuccess?: (key: string) => void
}

const OAuthButton: FC<Props> = ({ provider, ...props }) => {
  const { t } = useTranslation()

  const onAuth = () => {
    const onSuccess = (key: string) => {
      if (key.trim()) {
        props.onSuccess?.(key)
        window.message.success({ content: t('auth.get_key_success'), key: 'auth-success' })
      }
    }

    if (provider.id === 'silicon') {
      oauthWithSiliconFlow(onSuccess)
    }

    if (provider.id === 'aihubmix') {
      oauthWithAihubmix(onSuccess)
    }
  }

  return (
    <Button onClick={onAuth} {...props}>
      {t('auth.get_key')}
    </Button>
  )
}

export default OAuthButton
