import { ApiKeyProvider } from '../hooks/providerSetting/useAuthenticationApiKey'
import { useProviderApiKey } from '../hooks/providerSetting/useProviderApiKey'
import AuthConnectionSlotsLayout from './AuthConnectionSlotsLayout'
import { AuthenticationSectionContent } from './AuthenticationSectionContent'

interface AuthenticationSectionProps {
  providerId: string
}

export default function AuthenticationSection({ providerId }: AuthenticationSectionProps) {
  const apiKey = useProviderApiKey(providerId)

  return (
    <ApiKeyProvider value={apiKey}>
      <AuthConnectionSlotsLayout providerId={providerId}>
        <AuthenticationSectionContent providerId={providerId} />
      </AuthConnectionSlotsLayout>
    </ApiKeyProvider>
  )
}
