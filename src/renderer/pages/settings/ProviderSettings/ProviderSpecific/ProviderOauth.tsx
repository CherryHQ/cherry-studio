import { Button, RowFlex } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import OauthButton from '@renderer/components/Oauth/OauthButton'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useProvider } from '@renderer/hooks/useProvider'
import { getProviderLabel } from '@renderer/i18n/label'
import {
  oauthCardClasses,
  sectionHeadingClasses
} from '@renderer/pages/settings/ProviderSettings/primitives/ProviderSettingsPrimitives'
import { providerBills, providerCharge } from '@renderer/utils/oauth'
import { hasApiKeys } from '@shared/utils/provider'
import { CircleDollarSign, ReceiptText } from 'lucide-react'
import type { FC } from 'react'
import { Trans, useTranslation } from 'react-i18next'

interface Props {
  providerId: string
}

const ProviderOauth: FC<Props> = ({ providerId }) => {
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

  const serviceDescription = (
    <Trans
      i18nKey="settings.provider.oauth.description"
      components={{
        website: (
          <a className="text-inherit hover:underline" href={officialWebsite ?? ''} rel="noreferrer" target="_blank" />
        )
      }}
      values={{ provider: providerWebsite }}
    />
  )

  // Logged-out: align with the CherryIN account card (section heading + bordered shell + one row:
  // avatar/name/description on the left, login button on the right).
  if (!hasApiKeys(provider)) {
    return (
      <div className="flex flex-col gap-3">
        <h3 className={sectionHeadingClasses}>{t('settings.provider.section.account')}</h3>
        <div className={oauthCardClasses.shell}>
          <div className={oauthCardClasses.loggedInRow}>
            <div className={oauthCardClasses.profileMeta}>
              {Icon ? (
                <Icon.Avatar size={48} />
              ) : (
                <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-(--color-background-soft) font-bold text-[20px]">
                  {provider.name[0]}
                </div>
              )}
              <div className={oauthCardClasses.nameBlock}>
                <div className={oauthCardClasses.loggedInName}>{getProviderLabel(provider.id)}</div>
                <div className={oauthCardClasses.loggedInEmail}>{serviceDescription}</div>
              </div>
            </div>
            {/* className="" clears OauthButton's hard-coded `rounded-full` so the emphasis variant's own radius/size matches the CherryIN login button */}
            <OauthButton provider={{ id: provider.id }} onSuccess={setApiKey} variant="emphasis" className="" />
          </div>
        </div>
      </div>
    )
  }

  // Logged-in: charge / bills actions (original centered layout).
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-3 pb-2">
      {Icon ? (
        <Icon.Avatar size={60} />
      ) : (
        <div className="flex size-[60px] shrink-0 items-center justify-center rounded-full bg-(--color-background-soft) font-bold text-[24px]">
          {provider.name[0]}
        </div>
      )}
      <RowFlex className="gap-2.5">
        <Button
          className="rounded-lg px-3 py-[6px] text-[13px] shadow-none"
          onClick={() => providerCharge(provider.id)}>
          <CircleDollarSign aria-hidden className="size-4 shrink-0 text-white" />
          {t('settings.provider.charge')}
        </Button>
        <Button className="rounded-lg px-3 py-[6px] text-[13px] shadow-none" onClick={() => providerBills(provider.id)}>
          <ReceiptText aria-hidden className="size-4 shrink-0 text-white" />
          {t('settings.provider.bills')}
        </Button>
      </RowFlex>
      <div className="flex items-center gap-1.5 text-(--color-text-2) text-[13px] leading-[1.35]">
        {serviceDescription}
      </div>
    </div>
  )
}

export default ProviderOauth
