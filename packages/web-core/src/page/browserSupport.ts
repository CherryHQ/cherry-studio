// What the page needs before it starts the Core Worker. Each failure is named so the start screen can
// say why; the Worker checks the synchronous OPFS access handles, which only exist in Workers.

function startError(name: string, message: string): Error {
  return Object.assign(new Error(message), { name })
}

/** Throws a named error when this browser or this deployment cannot run the app. */
export async function checkBrowserSupport(): Promise<void> {
  if (typeof WebAssembly !== 'object' || typeof Worker !== 'function' || !navigator.storage?.getDirectory) {
    throw startError('BrowserUnsupportedError', 'The browser lacks WebAssembly, Workers or OPFS')
  }
  if (!crossOriginIsolated) {
    throw startError('CrossOriginIsolationError', 'The page is served without COOP and COEP')
  }
  try {
    await navigator.storage.getDirectory()
  } catch (error) {
    throw startError('StorageUnavailableError', `The browser refused OPFS: ${(error as Error).message}`)
  }
}
