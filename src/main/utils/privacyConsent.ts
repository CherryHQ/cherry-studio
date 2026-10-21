import { LATEST_PRIVACY_POLICY_VERSION } from '@shared/utils/constants'

/**
 * Whether the user consented to data collection **under the current policy**.
 * Every uploader (analytics, crash reporting) must gate on this one predicate so
 * a policy bump revokes them all together.
 */
export function isDataCollectionConsented(enabled: boolean, policyVersion: string): boolean {
  return enabled && policyVersion === LATEST_PRIVACY_POLICY_VERSION
}
