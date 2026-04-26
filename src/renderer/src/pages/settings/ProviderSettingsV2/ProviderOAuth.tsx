import { RowFlex } from '@cherrystudio/ui'
import { Button } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import OAuthButton from '@renderer/components/OAuth/OAuthButton'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useProvider, useProviderPresetMetadata } from '@renderer/hooks/useProviders'
import { getProviderLabel } from '@renderer/i18n/label'
import { hasApiKeys } from '@renderer/pages/settings/ProviderSettingsV2/utils/provider'
import { providerBills, providerCharge } from '@renderer/utils/oauth'
import { CircleDollarSign, ReceiptText } from 'lucide-react'
import type { FC } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  providerId: string
}

const ProviderOAuth: FC<Props> = ({ providerId }) => {
  const { t } = useTranslation()
  const { provider, updateProvider, addApiKey } = useProvider(providerId)
  const { data: presetMetadata } = useProviderPresetMetadata(providerId)

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
  const officialWebsite = presetMetadata?.websites?.official

  const Icon = resolveProviderIcon(provider.id)

  return (
    <Container>
      {Icon ? <Icon.Avatar size={60} /> : <ProviderLogoFallback>{provider.name[0]}</ProviderLogoFallback>}
      {!hasApiKeys(provider) ? (
        <OAuthButton
          provider={{ id: provider.id } as any}
          onSuccess={setApiKey}
          className="!rounded-lg !px-3 !py-[6px] !text-[13px]">
          {t('settings.provider.oauth.button', { provider: getProviderLabel(provider.id) })}
        </OAuthButton>
      ) : (
        <RowFlex className="gap-2.5">
          <Button
            className="rounded-lg px-3 py-[6px] text-[13px] shadow-none"
            onClick={() => providerCharge(provider.id)}>
            <CircleDollarSign size={16} />
            {t('settings.provider.charge')}
          </Button>
          <Button
            className="rounded-lg px-3 py-[6px] text-[13px] shadow-none"
            onClick={() => providerBills(provider.id)}>
            <ReceiptText size={16} />
            {t('settings.provider.bills')}
          </Button>
        </RowFlex>
      )}
      <Description>
        <Trans
          i18nKey="settings.provider.oauth.description"
          components={{
            website: <OfficialWebsite href={officialWebsite ?? ''} target="_blank" rel="noreferrer" />
          }}
          values={{ provider: providerWebsite }}
        />
      </Description>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 0 8px;
`

const ProviderLogoFallback = styled.div`
  width: 60px;
  height: 60px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-background-soft);
  font-size: 24px;
  font-weight: bold;
`

const Description = styled.div`
  font-size: 13px;
  line-height: 1.35;
  color: var(--color-text-2);
  display: flex;
  align-items: center;
  gap: 5px;
`

const OfficialWebsite = styled.a`
  text-decoration: none;
  color: var(--color-text-2);
`

export default ProviderOAuth
