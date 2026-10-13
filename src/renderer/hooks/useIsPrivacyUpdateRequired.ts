import { usePreference } from '@data/hooks/usePreference'
import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

/** Whether the user must acknowledge the latest privacy policy before continuing. */
export function useIsPrivacyUpdateRequired(): boolean {
  const [policyVersion] = usePreference('app.privacy.policy_version')
  const [dataCollectionEnabled] = usePreference('app.privacy.data_collection.enabled')
  return dataCollectionEnabled && policyVersion !== LATEST_PRIVACY_POLICY_VERSION
}
