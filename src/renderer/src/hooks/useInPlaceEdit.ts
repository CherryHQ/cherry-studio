import { loggerService } from '@logger'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useInPlaceEdit')
export interface UseInPlaceEditOptions {
  onSave: ((value: string) => void) | ((value: string) => Promise<void>)
  onCancel?: () => void
  onError?: (error: unknown) => void
  autoSelectOnStart?: boolean
  trimOnSave?: boolean
}

export interface UseInPlaceEditReturn {
  isEditing: boolean
  isSaving: boolean
  startEdit: (initialValue: string) => void
  saveEdit: () => void
  cancelEdit: () => void
  inputProps: React.InputHTMLAttributes<HTMLInputElement> & { ref: React.RefObject<HTMLInputElement | null> }
}

/**
 * A React hook that provides in-place editing functionality for text inputs
 * @param options - Configuration options for the in-place edit behavior
 * @param options.onSave - Callback function called when edits are saved
 * @param options.onCancel - Optional callback function called when editing is cancelled
 * @param options.autoSelectOnStart - Whether to automatically select text when editing starts (default: true)
 * @param options.trimOnSave - Whether to trim whitespace when saving (default: true)
 * @returns An object containing the editing state and handler functions
 */
export function useInPlaceEdit(options: UseInPlaceEditOptions): UseInPlaceEditReturn {
  const { onSave, onCancel, onError, autoSelectOnStart = true, trimOnSave = true } = options
  const { t } = useTranslation()

  const [isSaving, setIsSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const originalValueRef = useRef('')
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = useCallback((initialValue: string) => {
    setIsEditing(true)
    setEditValue(initialValue)
    originalValueRef.current = initialValue
  }, [])

  useLayoutEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      if (autoSelectOnStart) {
        inputRef.current?.select()
      }
    }
  }, [autoSelectOnStart, isEditing])

  const saveEdit = useCallback(async () => {
    if (isSaving) return

    const finalValue = trimOnSave ? editValue.trim() : editValue
    if (finalValue === originalValueRef.current) {
      setIsEditing(false)
      return
    }

    setIsSaving(true)

    try {
      await onSave(finalValue)
      setIsEditing(false)
      setEditValue('')
    } catch (error) {
      logger.error('Error saving in-place edit', { error })

      // Call custom error handler if provided, otherwise show default toast
      if (onError) {
        onError(error)
      } else {
        window.toast.error(t('common.save_failed') || 'Failed to save')
      }
    } finally {
      setIsSaving(false)
    }
  }, [isSaving, trimOnSave, editValue, onSave, onError, t])

  const cancelEdit = useCallback(() => {
    setIsEditing(false)
    setEditValue('')
    onCancel?.()
  }, [onCancel])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing) return
      if (e.key === 'Enter') {
        e.preventDefault()
        saveEdit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelEdit()
      }
    },
    [saveEdit, cancelEdit]
  )

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value)
  }, [])

  const handleBlur = useCallback(() => {
    // Note: The logic here requires attention:
    // If the "Cancel" button is clicked, a blur event may trigger a save first.
    // Typically, InPlaceEdit saves on blur.
    // If you do not want to save on blur, you can remove this line or check relatedTarget.
    if (isSaving) return
    saveEdit()
  }, [saveEdit, isSaving])

  return {
    isEditing,
    isSaving,
    startEdit,
    saveEdit,
    cancelEdit,
    inputProps: {
      ref: inputRef,
      value: editValue,
      onChange: handleInputChange,
      onKeyDown: handleKeyDown,
      onBlur: handleBlur,
      disabled: isSaving // Disable input while saving
    }
  }
}
