import AI302ProviderLogo from '@renderer/assets/images/providers/302ai.webp'
import AiHubMixProviderLogo from '@renderer/assets/images/providers/aihubmix.webp'
import AiOnlyProviderLogo from '@renderer/assets/images/providers/aiOnly.png'
import PPIOProviderLogo from '@renderer/assets/images/providers/ppio.png'
import SiliconFlowProviderLogo from '@renderer/assets/images/providers/silicon.png'
import TokenFluxProviderLogo from '@renderer/assets/images/providers/tokenflux.png'
import { HStack } from '@renderer/components/Layout'
import OAuthButton from '@renderer/components/OAuth/OAuthButton'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useProvider } from '@renderer/hooks/useProvider'
import { getProviderLabel } from '@renderer/i18n/label'
import { providerBills, providerCharge } from '@renderer/utils/oauth'
import { Button } from 'antd'
import { isEmpty } from 'lodash'
import { CircleDollarSign, ReceiptText } from 'lucide-react'
import { FC } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  providerId: string
}

const PROVIDER_LOGO_MAP = {
  '302ai': AI302ProviderLogo,
  silicon: SiliconFlowProviderLogo,
  aihubmix: AiHubMixProviderLogo,
  ppio: PPIOProviderLogo,
  tokenflux: TokenFluxProviderLogo,
  aionly: AiOnlyProviderLogo
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

  return (
    <Container>
      <ProviderLogo src={PROVIDER_LOGO_MAP[provider.id]} />
      {isEmpty(provider.apiKey) ? (
        <OAuthButton provider={provider} onSuccess={setApiKey}>
          {t('settings.provider.oauth.button', { provider: getProviderLabel(provider.id) })}
        </OAuthButton>
      ) : (
        <HStack gap={10}>
          <Button shape="round" icon={<CircleDollarSign size={16} />} onClick={() => providerCharge(provider.id)}>
            {t('settings.provider.charge')}
          </Button>
          <Button shape="round" icon={<ReceiptText size={16} />} onClick={() => providerBills(provider.id)}>
            {t('settings.provider.bills')}
          </Button>
        </HStack>
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

const ProviderLogo = styled.img`
  width: 60px;
  height: 60px;
  border-radius: 50%;
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
