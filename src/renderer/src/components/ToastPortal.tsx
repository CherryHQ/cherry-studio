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
      placement="top-center"
      regionProps={{
        className: 'z-[1001]'
      }}
      toastOffset={20}
      toastProps={{
        timeout: 3000,
        classNames: {
          // This setting causes the 'hero-toast' class to be applied twice to the toast element. This is weird and I don't know why, but it works.
          base: 'hero-toast'
        }
      }}
    />,
    document.body
  )
}
