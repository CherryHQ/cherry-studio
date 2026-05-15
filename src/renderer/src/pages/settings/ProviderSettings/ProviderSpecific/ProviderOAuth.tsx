import { Button, RowFlex } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import OAuthButton from '@renderer/components/OAuth/OAuthButton'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useProvider } from '@renderer/hooks/useProviders'
import { getProviderLabel } from '@renderer/i18n/label'
import { hasApiKeys } from '@renderer/pages/settings/ProviderSettings/utils/provider'
import { providerBills, providerCharge } from '@renderer/utils/oauth'
import { CircleDollarSign, ReceiptText } from 'lucide-react'
import type { FC } from 'react'
import { Trans, useTranslation } from 'react-i18next'

interface Props {
  providerId: string
}

const ProviderOAuth: FC<Props> = ({ providerId }) => {
  const { t } = useTranslation()
  const { provider, updateProvider, addApiKey } = useProvider(providerId)

  const setApiKey = async (newKey: string) => {
    await addApiKey(newKey, 'OAuth')
    await updateProvider({ isEnabled: true })
  }

  if (!provider) return null

  let providerWebsite =
    PROVIDER_URLS[provider.id]?.api?.url.replace('https://', '').replace('api.', '') || provider.name
  if (provider.id === 'ppio') {
    providerWebsite = 'ppio.com'
  }
  const officialWebsite = provider.websites?.official

  const Icon = resolveProviderIcon(provider.id)

  return (
    <div className="flex flex-col items-center justify-center gap-3 py-3 pb-2">
      {Icon ? (
        <Icon.Avatar size={60} />
      ) : (
        <div className="flex size-[60px] shrink-0 items-center justify-center rounded-full bg-(--color-background-soft) font-bold text-[24px]">
          {provider.name[0]}
        </div>
      )}
      {!hasApiKeys(provider) ? (
        <OAuthButton
          provider={{ id: provider.id }}
          onSuccess={setApiKey}
          className="rounded-lg! px-3! py-[6px]! text-[13px]!">
          {t('settings.provider.oauth.button', { provider: getProviderLabel(provider.id) })}
        </OAuthButton>
      ) : (
        <RowFlex className="gap-2.5">
          <Button
            className="rounded-lg px-3 py-[6px] text-[13px] shadow-none"
            onClick={() => providerCharge(provider.id)}>
            <CircleDollarSign aria-hidden className="size-4 shrink-0 text-white" />
            {t('settings.provider.charge')}
          </Button>
          <Button
            className="rounded-lg px-3 py-[6px] text-[13px] shadow-none"
            onClick={() => providerBills(provider.id)}>
            <ReceiptText aria-hidden className="size-4 shrink-0 text-white" />
            {t('settings.provider.bills')}
          </Button>
        </RowFlex>
      )}
      <div className="flex items-center gap-1.5 text-(--color-text-2) text-[13px] leading-[1.35]">
        <Trans
          i18nKey="settings.provider.oauth.description"
          components={{
            website: (
              <a
                className="text-(--color-text-2) no-underline"
                href={officialWebsite ?? ''}
                rel="noreferrer"
                target="_blank"
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
