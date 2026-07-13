import { setMiniAppLogo } from '@main/services/entityLogo'
import type { miniAppRequestSchemas } from '@shared/ipc/schemas/miniApp'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Mini-app imperative command handlers. Thin adapter: `mini_app.set_logo`
 * delegates the create→bind→compensate orchestration to `setMiniAppLogo`.
 */
export const miniAppHandlers: IpcHandlersFor<typeof miniAppRequestSchemas> = {
  'mini_app.set_logo': ({ appId, image }) => setMiniAppLogo(appId, image)
}
