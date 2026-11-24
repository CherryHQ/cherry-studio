/**
 * Earliest preboot gate — must be imported FIRST in `main/main.ts`, before
 * `@main/data/bootConfig` and any other profile-backed import.
 *
 * ES imports are evaluated in order, so this module's side effect (running the
 * OS gate during evaluation) executes before `bootConfig`/`LoggerService`
 * construct their file transports. On an unsupported Windows release
 * `runOsSupportGate()` shows a modal (console + dialog only, no file logging)
 * then `process.exit(1)`, so the later imports never even evaluate and no
 * profile file — including `%APPDATA%/<App>/logs` — is touched.
 *
 * On a supported OS (or non-Windows) this is a cheap `os.release()` check
 * with no side effects; `main.ts` re-checks in its body as a second line of
 * defense before `resolveUserDataLocation()`.
 */
import { runOsSupportGate } from './osSupportGate'

runOsSupportGate()
