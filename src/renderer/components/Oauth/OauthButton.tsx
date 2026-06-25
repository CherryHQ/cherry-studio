import { Button } from '@cherrystudio/ui'
import { getProviderLabelKey } from '@renderer/i18n/label'
import {
  oauthWith302AI,
  oauthWithAihubmix,
  oauthWithAiOnly,
  oauthWithPPIO,
  oauthWithSiliconFlow,
  oauthWithTokenFlux
} from '@renderer/utils/oauth'
import type { API_KEY_OAUTH_PROVIDER_IDS } from '@shared/utils/provider'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Per-provider "get API key" launchers, keyed by runtime id. Typed against
 * `API_KEY_OAUTH_PROVIDER_IDS` (the shared source of truth used by
 * `isProviderSupportAuth`) so adding an id there without a launcher here is a
 * compile error — the button can never render for a provider it cannot handle.
 */
const API_KEY_OAUTH_LAUNCHERS: Record<
  (typeof API_KEY_OAUTH_PROVIDER_IDS)[number],
  (onSuccess: (key: string) => void) => void
> = {
  silicon: oauthWithSiliconFlow,
  aihubmix: oauthWithAihubmix,
  ppio: oauthWithPPIO,
  tokenflux: () => oauthWithTokenFlux(),
  '302ai': oauthWith302AI,
  aionly: oauthWithAiOnly
}

interface Props extends React.ComponentProps<typeof Button> {
  /** Only `provider.id` is read; accepts either v1 or v2 Provider shape. */
  provider: { id: string }
  onSuccess?: (key: string) => void
}

const OauthButton: FC<Props> = ({ provider, onSuccess, ...buttonProps }) => {
  const { t } = useTranslation()

  const onAuth = () => {
    const handleSuccess = (key: string) => {
      if (key.trim()) {
        onSuccess?.(key)
        window.toast.success(t('auth.get_key_success'))
      }
    }

    API_KEY_OAUTH_LAUNCHERS[provider.id as (typeof API_KEY_OAUTH_PROVIDER_IDS)[number]]?.(handleSuccess)
  }

  return (
    <Button onClick={onAuth} className="rounded-full" {...buttonProps}>
      {t('settings.provider.oauth.button', { provider: t(getProviderLabelKey(provider.id)) })}
    </Button>
  )
}

export default OauthButton
