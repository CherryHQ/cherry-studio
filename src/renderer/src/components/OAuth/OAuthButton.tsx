import { getProviderLabel } from '@renderer/i18n/label'
import { getProviderAuthHandler } from '@renderer/services/ProviderService'
import type { Provider } from '@renderer/types'
import type { ProviderOAuthResult } from '@renderer/utils/oauth'
import type { ButtonProps } from 'antd'
import { Button } from 'antd'
import { Loader2 } from 'lucide-react'
import { type FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props extends ButtonProps {
  provider: Provider
  onSuccess?: (result: ProviderOAuthResult) => void
}

const OAuthButton: FC<Props> = ({ provider, onSuccess, ...buttonProps }) => {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(false)

  const onAuth = async () => {
    const authHandler = getProviderAuthHandler(provider)

    if (!authHandler) {
      return
    }

    let handled = false

    const handleSuccess = (result: ProviderOAuthResult) => {
      if (result.apiKey.trim()) {
        handled = true
        onSuccess?.(result)
        window.toast.success(t('auth.get_key_success'))
      }
    }

    try {
      setLoading(true)
      const result = await authHandler(handleSuccess)
      if (!handled && result && typeof result === 'object' && 'apiKey' in result) {
        handleSuccess(result as ProviderOAuthResult)
      }
    } catch (error) {
      const content = error instanceof Error && error.message ? error.message : t('settings.provider.oauth.error')
      window.toast.error(content)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      type="primary"
      icon={loading ? <Loader2 size={16} className="animate-spin" /> : undefined}
      onClick={onAuth}
      shape="round"
      {...buttonProps}>
      {t('settings.provider.oauth.button', {
        provider: getProviderLabel(provider.id)
      })}
    </Button>
  )
}

export default OAuthButton
