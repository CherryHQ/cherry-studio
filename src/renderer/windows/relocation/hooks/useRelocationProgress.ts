import { RelocationIpcChannels, type RelocationProgress } from '@shared/types/relocation'
import { useCallback, useEffect, useState } from 'react'

export function useRelocationProgress() {
  const [progress, setProgress] = useState<RelocationProgress | null>(null)

  useEffect(() => {
    let receivedProgressEvent = false
    const handleProgress = (_event: unknown, data: RelocationProgress) => {
      receivedProgressEvent = true
      setProgress(data)
    }

    window.electron.ipcRenderer.on(RelocationIpcChannels.Progress, handleProgress)
    window.electron.ipcRenderer
      .invoke(RelocationIpcChannels.GetProgress)
      .then((initial: RelocationProgress | null) => {
        if (initial && !receivedProgressEvent) setProgress(initial)
      })
      .catch(() => {})

    return () => {
      window.electron.ipcRenderer.removeListener(RelocationIpcChannels.Progress, handleProgress)
    }
  }, [])

  const restart = useCallback(() => {
    void window.electron.ipcRenderer.invoke(RelocationIpcChannels.Restart)
  }, [])

  return { progress, restart }
}
