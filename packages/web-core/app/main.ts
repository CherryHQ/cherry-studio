import '../src/page/preload'
import { CoreClient } from '../src/client/CoreClient'
import { installBrowserShell } from '../src/page/browserShell'
import { checkBrowserSupport } from '../src/page/browserSupport'
import { connectCore } from '../src/page/electron'
import { installFileDownloads } from '../src/page/fileDownloads'
import { installLocalFolders } from '../src/page/localFolders'
import { reportNativeTheme } from '../src/page/nativeTheme'
import { requestPersistentStorage } from '../src/page/persistentStorage'
import { showStartError } from '../src/page/startError'

// The Web edition's page: the desktop main window over a Core Worker. Until login exists, every
// visitor's data lives in one local account.
const LOCAL_ACCOUNT = 'local'

// The desktop main window ends this timer (`MainApp`); the CSP allows no inline script to start it.
console.time('init')

async function start(): Promise<void> {
  await checkBrowserSupport()
  const client = new CoreClient(new Worker(new URL('./coreWorker.ts', import.meta.url), { type: 'module' }))
  connectCore(client)
  installLocalFolders(client)
  installFileDownloads()
  installBrowserShell()
  reportNativeTheme()
  await client.open(LOCAL_ACCOUNT)
}

try {
  await start()
} catch (error) {
  await showStartError(error as Error)
  throw error
}
await import('@renderer/windows/main/entryPoint')
// The desktop loads it with the code block view; the Worker's `PythonService` needs its listener from the start.
await import('@renderer/services/PyodideService')
void requestPersistentStorage(LOCAL_ACCOUNT)
