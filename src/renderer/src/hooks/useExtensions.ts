import { useAppDispatch, useAppSelector } from '@renderer/store'
import { addExtension, removeExtension, toggleExtensionEnabled } from '@renderer/store/extensions'
import { useCallback, useEffect, useState } from 'react'

export function useExtensions() {
  const dispatch = useAppDispatch()
  const { extensions } = useAppSelector((state) => state.extensions)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Install extension
  const installExtension = useCallback(
    async (extensionId: string) => {
      try {
        setLoading(true)
        setError(null)

        const extension = await window.api.extensions.install({
          extensionId
        })
        dispatch(addExtension(extension))
      } catch (err) {
        console.error('Failed to install extension:', err)
        setError('Failed to install extension')
      } finally {
        setLoading(false)
      }
    },
    [dispatch]
  )

  // Uninstall extension
  const uninstallExtension = useCallback(
    async (extensionId: string) => {
      try {
        setLoading(true)
        setError(null)

        await window.api.extensions.uninstall(extensionId)
        dispatch(removeExtension(extensionId))
      } catch (err) {
        console.error('Failed to uninstall extension:', err)
        setError('Failed to uninstall extension')
      } finally {
        setLoading(false)
      }
    },
    [dispatch]
  )

  // Update extensions
  const updateExtensions = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      await window.api.extensions.update()
    } catch (err) {
      console.error('Failed to update extensions:', err)
      setError('Failed to update extensions')
    } finally {
      setLoading(false)
    }
  }, [])

  // Open Chrome Web Store
  const openChromeStore = useCallback(async () => {
    try {
      await window.api.extensions.openChromeStore({
        loadExtensions: true
      })
    } catch (err) {
      console.error('Failed to open Chrome Web Store:', err)
      setError('Failed to open Chrome Web Store')
    }
  }, [])

  // Toggle extension enabled state
  const toggleEnabled = useCallback(
    async (extensionId: string) => {
      try {
        setLoading(true)
        setError(null)

        const extension = extensions.find((ext) => ext.id === extensionId)

        if (extension) {
          if (extension.enabled) {
            // Disable extension
            await window.api.extensions.unload(extensionId)
          } else {
            // Enable extension
            await window.api.extensions.load(extensionId)
          }

          dispatch(toggleExtensionEnabled(extensionId))
        }
      } catch (err) {
        console.error('Failed to toggle extension state:', err)
        setError('Failed to toggle extension state')
      } finally {
        setLoading(false)
      }
    },
    [dispatch, extensions]
  )

  // Listen for IPC events
  useEffect(() => {
    const handleExtensionInstalled = () => {
      setLoading(false)
      setError(null)
    }

    const handleExtensionUninstalled = () => {
      setLoading(false)
      setError(null)
    }

    const handleExtensionError = (_, errorMessage: string) => {
      setError(errorMessage)
      setLoading(false)
    }

    // Subscribe to IPC events
    window.electron.ipcRenderer.on('extension-installed', handleExtensionInstalled)
    window.electron.ipcRenderer.on('extension-uninstalled', handleExtensionUninstalled)
    window.electron.ipcRenderer.on('extension-error', handleExtensionError)

    return () => {
      // Cleanup listeners
      window.electron.ipcRenderer.removeListener('extension-installed', handleExtensionInstalled)
      window.electron.ipcRenderer.removeListener('extension-uninstalled', handleExtensionUninstalled)
      window.electron.ipcRenderer.removeListener('extension-error', handleExtensionError)
    }
  }, [])

  return {
    extensions,
    loading,
    error,
    installExtension,
    uninstallExtension,
    updateExtensions,
    openChromeStore,
    toggleEnabled
  }
}
