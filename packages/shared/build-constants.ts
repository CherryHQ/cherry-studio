/**
 * Build-time constants for brand customization and feature flags.
 * These values are set at compile time and cannot be changed at runtime.
 */

// Helper function to safely access environment variables
// In development, process.env might not be fully replaced by build tools
function getEnv(key: string, defaultValue: string): string {
  try {
    if (typeof process !== 'undefined' && process.env) {
      return process.env[key] || defaultValue
    }
    return defaultValue
  } catch {
    return defaultValue
  }
}

function getEnvBool(key: string, defaultValue: boolean): boolean {
  try {
    if (typeof process !== 'undefined' && process.env) {
      const value = process.env[key]
      return value === 'true'
    }
    return defaultValue
  } catch {
    return defaultValue
  }
}

export const BUILD_CONSTANTS = {
  ENABLE_TEST_PLAN: getEnvBool('ENABLE_TEST_PLAN', true),
  APP_NAME: getEnv('APP_NAME', 'Cherry Studio'),
  APP_DESCRIPTION: getEnv('APP_DESCRIPTION', 'A powerful AI assistant for producer.'),
  APP_ID: getEnv('APP_ID', 'com.kangfenmao.CherryStudio'),
  APP_AUTHOR: getEnv('APP_AUTHOR', 'support@cherry-ai.com'),
  APP_HOMEPAGE: getEnv('APP_HOMEPAGE', 'https://github.com/CherryHQ/cherry-studio'),
  APP_PROTOCOL: getEnv('APP_PROTOCOL', 'cherrystudio'),
  IS_CUSTOM_BUILD: getEnvBool('CUSTOM_BUILD', false),
  BUILD_BRAND: getEnv('BUILD_BRAND', 'default'),
  // AGPL-3.0 Compliance: These fields must be preserved for license compliance
  ORIGINAL_PROJECT_NAME: 'Cherry Studio',
  ORIGINAL_PROJECT_URL: 'https://github.com/CherryHQ/cherry-studio',
  ORIGINAL_PROJECT_LICENSE: 'AGPL-3.0',
  LICENSE_URL: 'https://www.gnu.org/licenses/agpl-3.0.html',
  SOURCE_CODE_URL: getEnv('SOURCE_CODE_URL', 'https://github.com/CherryHQ/cherry-studio'),
  // Contact and feature visibility
  CONTACT_EMAIL: getEnv('CONTACT_EMAIL', 'support@cherry-ai.com'),
  SHOW_DOCS: getEnvBool('SHOW_DOCS', true),
  SHOW_WEBSITE: getEnvBool('SHOW_WEBSITE', true),
  SHOW_ENTERPRISE: getEnvBool('SHOW_ENTERPRISE', true),
  SHOW_CAREERS: getEnvBool('SHOW_CAREERS', true),
  GITHUB_REPO_URL: getEnv('GITHUB_REPO_URL', 'https://github.com/CherryHQ/cherry-studio'),
  // Update server configuration
  UPDATE_SERVER_URL: getEnv('UPDATE_SERVER_URL', ''),
  UPDATE_CONFIG_URL: getEnv('UPDATE_CONFIG_URL', ''),
  UPDATE_FEED_URL: getEnv('UPDATE_FEED_URL', ''),
  UPDATE_MIRROR: getEnv('UPDATE_MIRROR', 'github')
} as const

export type BuildConstants = typeof BUILD_CONSTANTS
