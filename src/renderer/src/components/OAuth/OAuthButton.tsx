import { useProvider } from '@renderer/hooks/useProvider'
import { Provider } from '@renderer/types'
import { oauthWithAihubmix, oauthWithSiliconFlow } from '@renderer/utils/oauth'
import { Button, ButtonProps } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props extends ButtonProps {
  provider: Provider
}

const OAuthButton: FC<Props> = (props) => {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(props.provider.id)

  const onAuth = () => {
    const onSuccess = (key: string) => {
      if (key.trim()) {
        updateProvider({ ...provider, apiKey: key })
        window.message.success(t('auth.get_key_success'))
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
