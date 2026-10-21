// The Pi approval policy's guard for the desktop database, as `approvalExtension` sees it in the browser.
// The account database is an OPFS file beside the `/web` mount, not in it, so no agent file tool can reach it.
export { normalizePiNativePathInput } from '@main/ai/toolApproval/userDataSqliteGuard'

export async function evaluateUserDataSqliteGuard(): Promise<undefined> {
  return undefined
}
