import AuthConnectionSlotsLayout from './AuthConnectionSlotsLayout'
import { AuthenticationSectionContent } from './AuthenticationSectionContent'

interface AuthenticationSectionProps {
  providerId: string
  onRequestModelPullGuide?: () => void
  onOpenApiSetup?: () => void
}

export default function AuthenticationSection({
  providerId,
  onRequestModelPullGuide,
  onOpenApiSetup
}: AuthenticationSectionProps) {
  return (
    <AuthConnectionSlotsLayout providerId={providerId}>
      <AuthenticationSectionContent
        providerId={providerId}
        onRequestModelPullGuide={onRequestModelPullGuide}
        onOpenApiSetup={onOpenApiSetup}
      />
    </AuthConnectionSlotsLayout>
  )
}
