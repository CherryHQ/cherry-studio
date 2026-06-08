import { Button, Flex, HStack, VStack } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import OauthButton from '@renderer/components/Oauth/OauthButton'
import { PROVIDER_URLS } from '@renderer/config/providers'
import { useProvider } from '@renderer/hooks/useProvider'
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

  // Logged-out: simple centered call-to-action (avatar + login + service note), matching the logged-in layout.
  if (!hasApiKeys(provider)) {
    return (
      <VStack gap={3} align="center" justify="center" className="py-3 pb-2">
        {Icon ? (
          <Icon.Avatar size={60} />
        ) : (
          <div className="flex size-[60px] shrink-0 items-center justify-center rounded-full bg-(--color-background-soft) font-bold text-[24px]">
            {provider.name[0]}
          </div>
        )}
        {/* className="" clears OauthButton's hard-coded `rounded-full` so the emphasis variant's own radius/size applies */}
        <OauthButton provider={{ id: provider.id }} onSuccess={setApiKey} variant="emphasis" className="" />
        <HStack gap={1} className="text-(--color-text-2) text-[13px] leading-[1.35]">
          {serviceDescription}
        </HStack>
      </VStack>
    )
  }

  // Logged-in: charge / bills actions (original centered layout).
  return (
    <VStack gap={3} align="center" justify="center" className="py-3 pb-2">
      {Icon ? (
        <Icon.Avatar size={60} />
      ) : (
        <div className="flex size-[60px] shrink-0 items-center justify-center rounded-full bg-(--color-background-soft) font-bold text-[24px]">
          {provider.name[0]}
        </div>
      )}
      <Flex direction="row" gap={2}>
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
      </Flex>
      <HStack gap={1} className="text-(--color-text-2) text-[13px] leading-[1.35]">
        {serviceDescription}
      </HStack>
    </VStack>
  )
}

export default ProviderOauth
