/**
 * The one door mini app guests may knock on.
 *
 * `validateSender` rejects every webview guest at the IpcApi entrance — correct,
 * and it stays. This channel authenticates by webContents id and nothing else:
 * anything the guest sends about its own identity is discarded.
 */

import { eq } from 'drizzle-orm'
import { app } from 'electron'
import * as z from 'zod'

import { application } from '@application'
import { miniAppInstallationTable } from '@data/db/schemas/miniApp'
import { loggerService } from '@logger'
import { getAppLanguage } from '@main/i18n'
import type { BridgeResult, CherryPublicError } from '@shared/ipc/schemas/miniAppBridge'
import { declaredGrantKeys, MiniAppManifestSchema, type MiniAppMethod } from '@shared/types/miniAppManifest'

import { miniAppActivityLog } from '../activityLog'
import { aiCapability } from '../capabilities/ai'
import { clipboardCapability } from '../capabilities/clipboard'
import { fileCapability } from '../capabilities/file'
import { networkCapability } from '../capabilities/network'
import { notificationCapability } from '../capabilities/notification'
import { QuotaExceededError, RateLimitedError } from '../capabilities/quota'
import { storageCapability } from '../capabilities/storage'
import { InvalidArgumentError, MiniAppUnavailableError } from '../errors'
import { assertMethodAllowed, listGrants, PermissionDeniedError } from '../grants'
import { installationOf } from '../install/installer'
import { MiniAppQuiescingError } from './MiniAppRuntimeService'

const logger = loggerService.withContext('miniApp:bridge')

const RequestSchema = z.object({
  method: z.string(),
  params: z.unknown().optional(),
  /** Preload-generated, routes stream chunks back. Bounded so it is not a payload. */
  requestId: z.string().max(64).optional(),
  /** The APP's own label, and the only thing `ai.cancel` can name. */
  callId: z.string().max(64).optional()
})

function installedVersionOf(appId: string): string {
  return (
    application
      .get('DbService')
      .getDb()
      .select({ version: miniAppInstallationTable.version })
      .from(miniAppInstallationTable)
      .where(eq(miniAppInstallationTable.appId, appId))
      .all()[0]?.version ?? '0.0.0'
  )
}

type Emit = (chunk: string) => void
type Handler = (
  appId: string,
  params: unknown,
  emit: Emit,
  senderId: number,
  /** The guest's own id for this call. Host-visible so `ai.cancel` can name a stream. */
  requestId: string | undefined,
  /** The app's own label for this call, when it gave one. Names an `ai.cancel` target. */
  callId: string | undefined
) => unknown | Promise<unknown>

/**
 * Handlers only. The GATE is not here — it lives in `MINI_APP_METHODS`, next to the
 * schema that validates declarations against the same list. Two tables would be two
 * places to add a method and one place to forget.
 */
const ROUTES: Record<MiniAppMethod, Handler> = {
  'app.getInfo': ((appId) => ({
    appId,
    /** The mini app's own version, from its installation record. */
    version: installedVersionOf(appId),
    /** Cherry's version. `application` has NO getVersion(); it comes from electron. */
    hostVersion: app.getVersion(),
    // `getAppLanguage()`, never the raw preference: it stays null until the user picks
    // one. No `theme` — `matchMedia` gives the guest the value AND the changes (§6.4).
    locale: getAppLanguage()
  })) as Handler,

  // Gated `none` on purpose: it reports the CALLER'S OWN grant state, so there is nothing
  // to protect — gating it would only leave an app blind to what it may call.
  'app.getPermissions': ((appId) => {
    const manifest = MiniAppManifestSchema.parse(installationOf(appId).manifestJson)
    const granted = new Set(listGrants(appId))
    return Object.fromEntries(declaredGrantKeys(manifest).map((k) => [k, granted.has(k)]))
  }) as Handler,

  'ai.chat': (appId, params, emit, senderId, _requestId, callId) =>
    aiCapability.chat(appId, params, emit, senderId, callId),
  'ai.cancel': (appId, params, _emit, senderId) => aiCapability.cancel(appId, params, senderId),
  'ai.getCapabilities': (appId, params) => aiCapability.getCapabilities(appId, params),

  'storage.get': (appId, params) => storageCapability.get(appId, params),
  'storage.set': (appId, params) => storageCapability.set(appId, params),
  'storage.delete': (appId, params) => storageCapability.delete(appId, params),
  'storage.keys': (appId) => storageCapability.keys(appId),
  'storage.usage': (appId) => storageCapability.usage(appId),

  'file.save': (appId, params) => fileCapability.save(appId, params),
  'file.load': (appId, params) => fileCapability.load(appId, params),
  'file.list': (appId) => fileCapability.list(appId),
  'file.delete': (appId, params) => fileCapability.delete(appId, params),
  'file.usage': (appId) => fileCapability.usage(appId),
  'file.export': (appId, params, _emit, senderId) => fileCapability.export(appId, params, senderId),

  'notification.show': (appId, params) => notificationCapability.show(appId, params),

  'clipboard.read': (appId, _params, _emit, senderId) => clipboardCapability.read(appId, senderId),
  'clipboard.write': (appId, params, _emit, senderId) => clipboardCapability.write(appId, params, senderId),

  'network.fetch': (appId, params, _emit, senderId) => networkCapability.fetch(appId, params, senderId)
}

/**
 * The public error contract (design §6.0): `{ name, message }` with `name` from a
 * CLOSED set.
 *
 * Internal class names are NOT the contract — an app branching on
 * `QuotaExceededError` breaks the day that class is renamed. And `Internal` drops the
 * message entirely: everything unmapped is a host bug, and host bug text carries
 * stacks and absolute paths into untrusted code.
 *
 * `RateLimitedError` is checked BEFORE its base `QuotaExceededError`, or every rate
 * limit reports as a capacity problem and the app retries the one thing that cannot help.
 */
export function publicErrorOf(error: unknown): CherryPublicError {
  const out: CherryPublicError = { name: 'Internal', message: 'Internal error' }
  // `detail`, not `message`: the message is prefixed with the internal class name.
  if (error instanceof RateLimitedError) [out.name, out.message] = ['RateLimited', error.detail]
  else if (error instanceof QuotaExceededError) [out.name, out.message] = ['QuotaExceeded', error.detail]
  else if (error instanceof PermissionDeniedError) [out.name, out.message] = ['PermissionDenied', error.message]
  else if (error instanceof MiniAppQuiescingError) [out.name, out.message] = ['Unavailable', error.message]
  else if (error instanceof MiniAppUnavailableError) [out.name, out.message] = ['Unavailable', error.message]
  else if (error instanceof z.ZodError) [out.name, out.message] = ['InvalidArgument', 'Invalid arguments']
  else if (error instanceof Error && error.name === 'AbortError') [out.name, out.message] = ['Cancelled', 'Cancelled']
  else if (error instanceof InvalidArgumentError) [out.name, out.message] = ['InvalidArgument', error.message]
  return out
}

/**
 * NEVER throws. `ipcMain.handle` serializes a thrown Error down to its `message` alone
 * (`electron.d.ts:8877`), which would erase every one of the seven frozen names in §6.0 —
 * the guest would branch on `catch (e) { if (e.name === 'QuotaExceeded') }` and always
 * see `'Error'`. The envelope is the only shape that survives the boundary.
 */
export async function handleBridgeRequest(senderId: number, payload: unknown, emit: Emit): Promise<BridgeResult> {
  try {
    return { ok: true, value: await route(senderId, payload, emit) }
  } catch (error) {
    const publicError = publicErrorOf(error)
    if (publicError.name === 'Internal') logger.warn('Mini app bridge call failed', { error })
    return { ok: false, error: publicError }
  }
}

async function route(senderId: number, payload: unknown, emit: Emit): Promise<unknown> {
  const runtime = application.get('MiniAppRuntimeService')
  const appId = runtime.resolveAppIdBySender(senderId)
  if (!appId) {
    throw new Error(`Bridge request from an unknown mini app guest (webContents ${senderId})`)
  }

  const { method, params, requestId, callId } = RequestSchema.parse(payload)
  // Own-property check: `ROUTES['constructor']` would otherwise resolve up the prototype
  // chain, and the gate below refusing it would be luck, not design.
  if (!Object.hasOwn(ROUTES, method)) throw new InvalidArgumentError(`Unknown method: ${method}`)
  const handler = ROUTES[method as MiniAppMethod]

  // From here on the call is attributable, so from here on it is logged — the gate's
  // refusal included, which is the line the activity log exists to show.
  const started = Date.now()
  try {
    assertMethodAllowed(appId, method as MiniAppMethod)

    // Synchronous refusal while the app is being taken offline. Returns void: the host
    // never waits for in-flight calls, so there is nothing to release.
    runtime.beginCapabilityCall(appId)

    // Identity comes from `senderId` (Electron), never the payload. `requestId` does come
    // from the payload but names only this guest's own call — lookups scope by senderId.
    const value = await handler(appId, params, emit, senderId, requestId, callId)
    miniAppActivityLog.recordCall(appId, method as MiniAppMethod, 'ok', Date.now() - started, params, value)
    return value
  } catch (error) {
    miniAppActivityLog.recordCall(
      appId,
      method as MiniAppMethod,
      publicErrorOf(error).name,
      Date.now() - started,
      params,
      undefined,
      reasonOf(error)
    )
    throw error
  }
}

/**
 * What actually failed, for the USER's log — the seven public names cannot say whether an
 * `Unavailable` was a dead provider or a cleared app, and the panel is where that is asked.
 *
 * A class name only, never a message: the log's own contract is names, outcomes, sizes and
 * addresses. Bounded because it is written to a file that is capped by size, not by line.
 */
function reasonOf(error: unknown): string | undefined {
  const cause = error instanceof Error ? error.cause : undefined
  return typeof cause === 'string' && cause.length > 0 ? cause.slice(0, 64) : undefined
}
