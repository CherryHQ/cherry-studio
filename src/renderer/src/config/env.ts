import DefaultAppLogo from '@renderer/assets/images/logo.png'
import { BUILD_CONSTANTS } from '@shared/build-constants'

export { default as UserAvatar } from '@renderer/assets/images/avatar.png'

// For custom builds, use the build directory logo
// For default builds, use the original logo from assets
export const AppLogo = BUILD_CONSTANTS.IS_CUSTOM_BUILD ? `/logo.png?v=${BUILD_CONSTANTS.BUILD_BRAND}` : DefaultAppLogo

export const APP_NAME = BUILD_CONSTANTS.APP_NAME
export const ENABLE_TEST_PLAN = BUILD_CONSTANTS.ENABLE_TEST_PLAN
export const IS_CUSTOM_BUILD = BUILD_CONSTANTS.IS_CUSTOM_BUILD
export const APP_DESCRIPTION = BUILD_CONSTANTS.APP_DESCRIPTION
export const ORIGINAL_PROJECT_NAME = BUILD_CONSTANTS.ORIGINAL_PROJECT_NAME
export const ORIGINAL_PROJECT_URL = BUILD_CONSTANTS.ORIGINAL_PROJECT_URL
export const ORIGINAL_PROJECT_LICENSE = BUILD_CONSTANTS.ORIGINAL_PROJECT_LICENSE
export const LICENSE_URL = BUILD_CONSTANTS.LICENSE_URL
export const SOURCE_CODE_URL = BUILD_CONSTANTS.SOURCE_CODE_URL
export const CONTACT_EMAIL = BUILD_CONSTANTS.CONTACT_EMAIL
export const SHOW_DOCS = BUILD_CONSTANTS.SHOW_DOCS
export const SHOW_WEBSITE = BUILD_CONSTANTS.SHOW_WEBSITE
export const SHOW_ENTERPRISE = BUILD_CONSTANTS.SHOW_ENTERPRISE
export const SHOW_CAREERS = BUILD_CONSTANTS.SHOW_CAREERS
export const GITHUB_REPO_URL = BUILD_CONSTANTS.GITHUB_REPO_URL
export const isLocalAi = false
