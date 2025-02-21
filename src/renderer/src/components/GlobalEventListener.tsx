import { addPendingChange } from '@renderer/store/knowledgeFile'
import { useEffect } from 'react'
import { useDispatch } from 'react-redux'

const GlobalEventListener: React.FC = () => {
  const dispatch = useDispatch()

  useEffect(() => {
    const cleanup = window.electron.ipcRenderer.on('directory-content-changed', (_, uniqueId: string) => {
      console.log('directory-content-changed', uniqueId)
      dispatch(
        addPendingChange({
          type: 'directory-changed',
          uniqueId
        })
      )
    })

    return () => cleanup()
  }, [dispatch])

  return null
}

export default GlobalEventListener
