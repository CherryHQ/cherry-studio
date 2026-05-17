import { Button } from '@cherrystudio/ui'
import { getProviderLabel } from '@renderer/i18n/label'
import {
  oauthWith302AI,
  oauthWithAihubmix,
  oauthWithAiOnly,
  oauthWithPPIO,
  oauthWithSiliconFlow,
  oauthWithTokenFlux
} from '@renderer/utils/oauth'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

interface Props extends React.ComponentProps<typeof Button> {
  /** Only `provider.id` is read; accepts either v1 or v2 Provider shape. */
  provider: { id: string }
  onSuccess?: (key: string) => void
}

const OAuthButton: FC<Props> = ({ provider, onSuccess, ...buttonProps }) => {
  const { t } = useTranslation()

  const onAuth = () => {
    const handleSuccess = (key: string) => {
      if (key.trim()) {
        onSuccess?.(key)
        window.toast.success(t('auth.get_key_success'))
      }
    }

    if (provider.id === 'silicon') {
      void oauthWithSiliconFlow(handleSuccess)
    }

    if (provider.id === 'aihubmix') {
      void oauthWithAihubmix(handleSuccess)
    }

    if (provider.id === 'ppio') {
      void oauthWithPPIO(handleSuccess)
    }

    if (provider.id === 'tokenflux') {
      void oauthWithTokenFlux()
    }

    if (provider.id === '302ai') {
      void oauthWith302AI(handleSuccess)
    }

    if (provider.id === 'aionly') {
      void oauthWithAiOnly(handleSuccess)
    }
  }

  return (
    <Button onClick={onAuth} className="rounded-full" {...buttonProps}>
      {t('settings.provider.oauth.button', { provider: getProviderLabel(provider.id) })}
    </Button>
  )
}

export default OAuthButton
