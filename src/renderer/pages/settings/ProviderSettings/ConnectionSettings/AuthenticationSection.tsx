import AuthConnectionSlotsLayout from './AuthConnectionSlotsLayout'
import { AuthenticationSectionContent } from './AuthenticationSectionContent'

interface AuthenticationSectionProps {
  providerId: string
  onRequestModelPullGuide?: () => void
}

export default function AuthenticationSection({ providerId, onRequestModelPullGuide }: AuthenticationSectionProps) {
  return (
    <AuthConnectionSlotsLayout providerId={providerId}>
      <AuthenticationSectionContent providerId={providerId} onRequestModelPullGuide={onRequestModelPullGuide} />
    </AuthConnectionSlotsLayout>
  )
}
