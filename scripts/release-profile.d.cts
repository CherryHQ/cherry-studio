export type ReleaseProfile = Readonly<{
  id: 'uar-enabled' | 'non-uar'
  uarEnabled: boolean
  nativeTools: readonly string[]
  supportedPlatforms: readonly string[]
}>

export const RELEASE_PLATFORM_KEYS: readonly string[]
export const RETAINED_NATIVE_TOOLS: readonly string[]
export const UAR_RELEASE_PLATFORM_KEYS: readonly string[]
export function resolveReleaseProfile(env?: NodeJS.ProcessEnv): ReleaseProfile
