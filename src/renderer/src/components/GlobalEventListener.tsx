import { addPendingChange, clearPendingChanges } from '@renderer/store/knowledgeFile'
import { useEffect } from 'react'
import { useDispatch } from 'react-redux'

const GlobalEventListener: React.FC = () => {
  const dispatch = useDispatch()
  dispatch(clearPendingChanges())

  useEffect(() => {
    const fileRemoveCleanup = window.electron.ipcRenderer.on('file-removed', (_, uniqueId: string) => {
      console.log('file-removed', uniqueId)
      dispatch(
        addPendingChange({
          type: 'file-removed',
          uniqueId
        })
      )
    })
    const directoryRemoveCleanup = window.electron.ipcRenderer.on('directory-removed', (_, uniqueId: string) => {
      console.log('directory-removed', uniqueId)
      dispatch(
        addPendingChange({
          type: 'directory-removed',
          uniqueId
        })
      )
    })
    const directoryCleanup = window.electron.ipcRenderer.on('directory-content-changed', (_, uniqueId: string) => {
      console.log('directory-content-changed', uniqueId)
      dispatch(
        addPendingChange({
          type: 'directory-changed',
          uniqueId
        })
      )
    })

    const fileCleanup = window.electron.ipcRenderer.on('file-changed', (_, uniqueId: string) => {
      console.log('file-changed', uniqueId)
      dispatch(
        addPendingChange({
          type: 'file-changed',
          uniqueId
        })
      )
    })

    return () => {
      directoryCleanup()
      fileCleanup()
      fileRemoveCleanup()
      directoryRemoveCleanup()
    }
  }, [dispatch])

  return null
}

export default GlobalEventListener
