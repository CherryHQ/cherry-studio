export const isMac = process.platform === 'darwin'
export const isWin = process.platform === 'win32'
export const isLinux = process.platform === 'linux'
export const isDev = process.env.NODE_ENV === 'development'
export const isPortable = isWin && 'PORTABLE_EXECUTABLE_DIR' in process.env

export const POE_CLIENT_ID = 'client_e6a654e59ea9437f9a561ca61d4ae6ef'
export const POE_OAUTH_AUTHORIZE_URL = 'https://poe.com/oauth/authorize'
export const POE_OAUTH_TOKEN_URL = 'https://api.poe.com/token'
export const POE_OAUTH_SCOPE = 'apikey:create'
export const POE_OAUTH_CALLBACK_HOST = '127.0.0.1'
export const POE_OAUTH_CALLBACK_PATH = '/callback'
export const POE_OAUTH_TIMEOUT_MS = 2 * 60 * 1000
export const POE_OAUTH_TOKEN_RETRY_COUNT = 1
