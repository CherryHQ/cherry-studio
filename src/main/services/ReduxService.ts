/**
 * @deprecated Stubbed in v2 — all methods log an error and return empty values.
 * --------------------------------------------------------------------------
 * ⚠️ NOTICE: V2 DATA&UI REFACTORING (by 0xfullex)
 * --------------------------------------------------------------------------
 * The Redux store bridge has been neutralized in v2. The class and its public
 * interface are preserved so existing call sites still compile and run, but
 * every method now:
 *   - logs `logger.error(...)` with the selector / action name so remaining
 *     call sites are visible in production logs
 *   - returns an empty value (`undefined` / `void`) matching the declared
 *     return type; consumers' existing null-safe branches (`x?.y`, `x || []`,
 *     `x || null`, etc.) will naturally degrade to a "no data" path.
 *
 * The former `ipcMain.handle(IpcChannel.ReduxStoreReady, ...)` handshake has
 * been removed on both sides: the stub does not read from the renderer, so
 * there is no readiness state to track, and the renderer's invoke of the
 * channel (renderer/src/store/index.ts) has been commented out with the
 * existing `// [v2] Removed:` convention.
 *
 * Migrate each caller to the v2 data layer (Preference / DataApi / direct
 * IPC) at its own pace. Once no callers remain, delete this file.
 * --------------------------------------------------------------------------
 */
import { loggerService } from '@logger'

type StoreValue = any

const logger = loggerService.withContext('ReduxService')

const STUB_ERROR_MESSAGE =
  'ReduxService is stubbed in v2 — the Redux store bridge no longer works. This call site must be migrated to the new data layer.'

export class ReduxService {
  async select<T = StoreValue>(selector: string): Promise<T> {
    logger.error(`${STUB_ERROR_MESSAGE} select('${selector}')`)
    return undefined as unknown as T
  }

  async dispatch(action: any): Promise<void> {
    logger.error(`${STUB_ERROR_MESSAGE} dispatch(type=${action?.type ?? 'unknown'})`)
  }

  async getState(): Promise<any> {
    logger.error(`${STUB_ERROR_MESSAGE} getState()`)
    return undefined
  }

  async batch(actions: any[]): Promise<void> {
    logger.error(`${STUB_ERROR_MESSAGE} batch(${actions?.length ?? 0} actions)`)
  }
}

export const reduxService = new ReduxService()
