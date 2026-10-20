import '../src/page/preload'
import { CoreClient } from '../src/client/CoreClient'
import { connectCore } from '../src/page/electron'
import { reportNativeTheme } from '../src/page/nativeTheme'

// The Web edition's page: the desktop main window over a Core Worker. Until login exists, every
// visitor's data lives in one local account.
const LOCAL_ACCOUNT = 'local'

const client = new CoreClient(new Worker(new URL('./coreWorker.ts', import.meta.url), { type: 'module' }))
connectCore(client)
reportNativeTheme()
await client.open(LOCAL_ACCOUNT)
await import('@renderer/windows/main/entryPoint')
