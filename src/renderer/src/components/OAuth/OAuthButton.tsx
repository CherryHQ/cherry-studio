import { ExportOutlined } from '@ant-design/icons'
import { useProvider } from '@renderer/hooks/useProvider'
import { Provider } from '@renderer/types'
import { oauthWithSiliconFlow } from '@renderer/utils/oauth'
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
    if (provider.id === 'silicon') {
      oauthWithSiliconFlow((key: string) => {
        updateProvider({
          ...provider,
          apiKey: key
        })
      })
    }
  }

  return (
    <Button
      type="primary"
      style={{ backgroundColor: '#7c3aed', width: '200px' }}
      icon={<ExportOutlined />}
      onClick={onAuth}
      {...props}>
      {t('auth.oauth_button', { provider: t(`provider.${provider.id}`) })}
    </Button>
  )
}

export default OAuthButton
