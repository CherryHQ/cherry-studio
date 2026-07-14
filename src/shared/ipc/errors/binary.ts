/**
 * BinaryManager domain IpcApi error codes (SCREAMING_SNAKE_CASE, `as const`,
 * mirroring `IpcErrorCode`). Imported directly by both the handler (throw) and
 * any renderer that branches — not aggregated through a barrel (see ipc-overview.md).
 */
export const binaryErrorCodes = {
  /**
   * A side-effecting route (`install_tool` / `remove_tool`) was reached by a
   * caller that passed the source-trust gate (`validateSender`) but is not a
   * WindowManager-managed window (`senderId: null`). `install_tool` can run
   * arbitrary package postinstall code, so these routes refuse an unmanaged
   * sender rather than assume a window context — see ipc-overview.md
   * "Caller Identity". Not expected to fire today (no trusted-but-unmanaged
   * window reaches these routes), so it surfaces as a generic error toast.
   */
  BINARY_UNMANAGED_SENDER: 'BINARY_UNMANAGED_SENDER'
} as const
