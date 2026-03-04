import { useAppSelector } from '@renderer/store'

/**
 * Stub hook - the API server feature (window.api.apiServer) has been removed.
 * Returns safe no-op defaults so existing consumers continue to compile.
 */
export const useApiServer = () => {
  const apiServerConfig = useAppSelector((state) => state.settings.apiServer)

  const noop = async () => {}

  return {
    apiServerConfig,
    apiServerRunning: false,
    apiServerLoading: false,
    startApiServer: noop,
    stopApiServer: noop,
    restartApiServer: noop,
    checkApiServerStatus: noop,
    setApiServerEnabled: (_enabled: boolean) => {}
  }
}
