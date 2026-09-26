const RELEASE_PLATFORM_KEYS = Object.freeze(['win32-x64', 'win32-arm64', 'darwin-arm64', 'darwin-x64'])
const UAR_RELEASE_PLATFORM_KEYS = Object.freeze(['win32-x64', 'darwin-arm64'])
const RETAINED_NATIVE_TOOLS = Object.freeze(['compass', 'rust-mcp-filesystem', 'prometheus', 'pk', 'node'])

function resolveReleaseProfile(env = process.env) {
  const value = env.THE_BOSS_UAR_ENABLED
  if (value !== undefined && value !== '0' && value !== '1') {
    throw new Error('THE_BOSS_UAR_ENABLED must be either 0 or 1')
  }

  const uarEnabled = value !== '0'
  return Object.freeze({
    id: uarEnabled ? 'uar-enabled' : 'non-uar',
    uarEnabled,
    nativeTools: Object.freeze(
      uarEnabled ? [...RETAINED_NATIVE_TOOLS, 'uar-sidecar', 'liter-llm'] : [...RETAINED_NATIVE_TOOLS]
    ),
    supportedPlatforms: uarEnabled ? UAR_RELEASE_PLATFORM_KEYS : RELEASE_PLATFORM_KEYS
  })
}

module.exports = { RELEASE_PLATFORM_KEYS, RETAINED_NATIVE_TOOLS, UAR_RELEASE_PLATFORM_KEYS, resolveReleaseProfile }
