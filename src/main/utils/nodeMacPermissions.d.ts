/**
 * Ambient types for the optional, darwin-only `node-mac-permissions`.
 *
 * The package is in `optionalDependencies` with `os: ["darwin"]`, so it is not
 * installed on Windows / Linux — where CI still runs `pnpm typecheck` on
 * ubuntu-latest. Declaring the surface here keeps type checking independent of
 * whether the package is on disk.
 *
 * Only the one function this codebase calls is declared. Permission STATUS is
 * read through Electron instead (it is the only source that distinguishes
 * 'not-determined'), so `getAuthStatus` is deliberately absent — declaring an
 * unused API invites someone to reach for the wrong one.
 */
declare module 'node-mac-permissions' {
  export function askForScreenCaptureAccess(openPreferences?: boolean): void
}
