/**
 * OVMS domain IpcApi error codes. OvmsManager is a `@Conditional` service (Win32 + Intel
 * only), but the IpcApi handler registry is a static full table registered on every
 * platform. So the OvmsManager-backed routes resolve the service at call time via
 * `application.getOptional('OvmsManager')` and throw `OVMS_NOT_AVAILABLE` when it is
 * absent — the renderer branches on this code. Imported directly by both sides (no
 * aggregating barrel), mirroring `errors/ai.ts`.
 */
export const ovmsErrorCodes = {
  OVMS_NOT_AVAILABLE: 'OVMS_NOT_AVAILABLE',
  // start/stop report failure via { success: false, message } from OvmsManager; the handlers
  // turn a failed result into a thrown IpcError carrying the message so the renderer's existing
  // try/catch surfaces it as a toast instead of swallowing it.
  OVMS_START_FAILED: 'OVMS_START_FAILED',
  OVMS_STOP_FAILED: 'OVMS_STOP_FAILED'
} as const
