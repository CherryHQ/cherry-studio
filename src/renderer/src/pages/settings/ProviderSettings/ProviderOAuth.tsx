import { RowFlex } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import OAuthButton from '@renderer/components/OAuth/OAuthButton'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useProvider } from '@renderer/hooks/useProvider'
import { getProviderLabel } from '@renderer/i18n/label'
import { providerBills, providerCharge } from '@renderer/utils/oauth'
import { isEmpty } from 'lodash'
import { CircleDollarSign, ReceiptText } from 'lucide-react'
import type { FC } from 'react'
import { Trans, useTranslation } from 'react-i18next'

interface Props {
  providerId: string
}

const ProviderOAuth: FC<Props> = ({ providerId }) => {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)

  const setApiKey = (newKey: string) => {
    updateProvider({ apiKey: newKey, enabled: true })
  }

  let providerWebsite =
    PROVIDER_URLS[provider.id]?.api?.url.replace('https://', '').replace('api.', '') || provider.name
  if (provider.id === 'ppio') {
    providerWebsite = 'ppio.com'
  }

  const Icon = resolveProviderIcon(provider.id)

  return (
    <div className="flex flex-col items-center justify-center gap-[15px] p-5">
      {Icon ? (
        <Icon.Avatar size={60} />
      ) : (
        <div className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-background-subtle font-bold text-2xl">
          {provider.name[0]}
        </div>
      )}
      {isEmpty(provider.apiKey) ? (
        <OAuthButton provider={provider} onSuccess={setApiKey}>
          {t('settings.provider.oauth.button', { provider: getProviderLabel(provider.id) })}
        </OAuthButton>
      ) : (
        <RowFlex className="gap-2.5">
          <Button className="rounded-full" onClick={() => providerCharge(provider.id)}>
            <CircleDollarSign size={16} />
            {t('settings.provider.charge')}
          </Button>
          <Button className="rounded-full" onClick={() => providerBills(provider.id)}>
            <ReceiptText size={16} />
            {t('settings.provider.bills')}
          </Button>
        </RowFlex>
      )}
      <div className="flex items-center gap-[5px] text-[11px] text-foreground-secondary">
        <Trans
          i18nKey="settings.provider.oauth.description"
          components={{
            website: (
              <a
                className="text-foreground-secondary no-underline"
                href={PROVIDER_URLS[provider.id].websites.official}
                target="_blank"
                rel="noreferrer"
              />
            )
          }}
          values={{ provider: providerWebsite }}
        />
      </div>
    </div>
  )
}

export default ProviderOAuth
