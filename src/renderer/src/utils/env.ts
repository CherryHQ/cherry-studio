/**
 * Check if the application is running in production mode
 * @returns {Promise<boolean>} true if in production, false otherwise
 */
export async function isProduction(): Promise<boolean> {
  const { isPackaged } = await window.api.getAppInfo()
  return isPackaged
}

/**
 * Check if the application is running in development mode
 * @returns {Promise<boolean>} true if in development, false otherwise
 */
export async function isDev(): Promise<boolean> {
  const isProd = await isProduction()
  return !isProd
}
