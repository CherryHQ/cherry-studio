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
import styled from 'styled-components'

interface Props {
  providerId: string
}

const ProviderOAuth: FC<Props> = ({ providerId }) => {
  const { t } = useTranslation()
  const { provider, updateProvider } = useProvider(providerId)

  const setApiKey = (newKey: string) => {
    updateProvider({ apiKey: newKey })
  }

  let providerWebsite =
    PROVIDER_URLS[provider.id]?.api?.url.replace('https://', '').replace('api.', '') || provider.name
  if (provider.id === 'ppio') {
    providerWebsite = 'ppio.com'
  }

  const Icon = resolveProviderIcon(provider.id)

  return (
    <Container>
      {Icon ? <Icon.Avatar size={60} /> : <ProviderLogoFallback>{provider.name[0]}</ProviderLogoFallback>}
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
      <Description>
        <Trans
          i18nKey="settings.provider.oauth.description"
          components={{
            website: (
              <OfficialWebsite href={PROVIDER_URLS[provider.id].websites.official} target="_blank" rel="noreferrer" />
            )
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
  gap: 15px;
  padding: 20px;
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
  font-size: 11px;
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
