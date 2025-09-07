import { ToastProvider } from '@heroui/toast'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export const ToastPortal = () => {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  if (!mounted) return null

  return createPortal(
    <ToastProvider
      placement="bottom-center"
      regionProps={{
        className: 'z-[1001]'
      }}
      toastProps={{
        timeout: 3000
      }}
    />,
    document.body
  )
}
