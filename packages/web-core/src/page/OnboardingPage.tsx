// Browser `windows/main/onboarding/OnboardingPage`: CherryIN signs in through a callback on the local
// machine, which a Web page cannot receive, so only provider setup is offered.
import DesktopOnboardingPage from '@renderer/windows/main/onboarding/OnboardingPage'

export default function OnboardingPage() {
  return <DesktopOnboardingPage enableCherryInLogin={false} />
}
