/**
 * Hook for subscribing to relocation progress updates from the preboot gate.
 */
import { RelocationIpcChannels, type RelocationProgress } from '@shared/data/relocation/types'
import { useCallback, useEffect, useState } from 'react'

export function useRelocationProgress() {
  const [progress, setProgress] = useState<RelocationProgress | null>(null)

  useEffect(() => {
    const handleProgress = (_: unknown, data: RelocationProgress) => {
      setProgress(data)
    }

    window.electron.ipcRenderer.on(RelocationIpcChannels.Progress, handleProgress)

    // Pull the current state on mount — covers the case where the gate
    // already pushed progress before the listener was attached.
    window.electron.ipcRenderer
      .invoke(RelocationIpcChannels.GetProgress)
      .then((initial: RelocationProgress | null) => {
        if (initial) setProgress(initial)
      })
      .catch(console.error)

    return () => {
      window.electron.ipcRenderer.removeAllListeners(RelocationIpcChannels.Progress)
    }
  }, [])

  const restart = useCallback(() => {
    void window.electron.ipcRenderer.invoke(RelocationIpcChannels.Restart)
  }, [])

  return { progress, restart }
}
