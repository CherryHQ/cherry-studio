import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A hook for managing a temporary value that automatically reverts to its default after a specified duration.
 *
 * @param defaultValue - The default value to revert to
 * @param duration - The duration in milliseconds before the value reverts to default (default: 2000ms)
 * @returns A tuple containing the current value and a function to set a temporary value
 *
 * @example
 * const [copied, setCopiedTemporarily] = useTemporaryValue(false)
 *
 * const handleCopy = () => {
 *   // Copy logic here
 *   setCopiedTemporarily(true) // Will automatically revert to false after 2 seconds
 * }
 *
 * @example
 * const [status, setStatusTemporarily] = useTemporaryValue('idle', 3000)
 *
 * const handleSubmit = async () => {
 *   setStatusTemporarily('saving')
 *   await saveData()
 *   setStatusTemporarily('saved') // Will automatically revert to 'idle' after 3 seconds
 * }
 */
export const useTemporaryValue = <T>(defaultValue: T, duration: number = 2000) => {
  const [value, setValue] = useState<T>(defaultValue)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)

  const setTemporaryValue = useCallback(
    (tempValue: T) => {
      // Clear any existing timeout
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      // Set the new value
      setValue(tempValue)

      // Set timeout to revert to default value
      if (tempValue !== defaultValue) {
        timeoutRef.current = setTimeout(() => {
          setValue(defaultValue)
          timeoutRef.current = null
        }, duration)
      }
    },
    [defaultValue, duration]
  )

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return [value, setTemporaryValue] as const
}
