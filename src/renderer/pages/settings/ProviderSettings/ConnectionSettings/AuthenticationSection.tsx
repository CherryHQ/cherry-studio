import { ApiKeyProvider } from '../hooks/providerSetting/useAuthenticationApiKey'
import { useProviderApiKey } from '../hooks/providerSetting/useProviderApiKey'
import AuthConnectionSlotsLayout from './AuthConnectionSlotsLayout'
import { AuthenticationSectionContent } from './AuthenticationSectionContent'
import type { ConnectionModelDetectionEvent } from './connectionModelDetection'

interface AuthenticationSectionProps {
  providerId: string
  onOpenModelHealthCheck?: () => void
  onConnectionModelDetection?: (event: ConnectionModelDetectionEvent) => void
}

export default function AuthenticationSection({
  providerId,
  onOpenModelHealthCheck,
  onConnectionModelDetection
}: AuthenticationSectionProps) {
  const apiKey = useProviderApiKey(providerId)

  return (
    <ApiKeyProvider value={apiKey}>
      <AuthConnectionSlotsLayout providerId={providerId}>
        <AuthenticationSectionContent
          providerId={providerId}
          onOpenModelHealthCheck={onOpenModelHealthCheck}
          onConnectionModelDetection={onConnectionModelDetection}
        />
      </AuthConnectionSlotsLayout>
    </ApiKeyProvider>
  )
}
