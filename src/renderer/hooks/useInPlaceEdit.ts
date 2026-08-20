import { loggerService } from '@logger'
import { toast } from '@renderer/services/toast'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  const isSavingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const blurSaveTimerRef = useRef<number | null>(null)

  const clearPendingBlurSave = useCallback(() => {
    if (blurSaveTimerRef.current === null) return
    window.clearTimeout(blurSaveTimerRef.current)
    blurSaveTimerRef.current = null
  }, [])

  const startEdit = useCallback(
    (initialValue: string) => {
      clearPendingBlurSave()
      setIsEditing(true)
      setEditValue(initialValue)
      originalValueRef.current = initialValue
    },
    [clearPendingBlurSave]
  )

  useEffect(() => clearPendingBlurSave, [clearPendingBlurSave])

  useLayoutEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      if (autoSelectOnStart) {
        inputRef.current?.select()
      }
    }
  }, [autoSelectOnStart, isEditing])

  const saveEdit = useCallback(async () => {
    if (isSavingRef.current) return
    clearPendingBlurSave()

    const finalValue = trimOnSave ? editValue.trim() : editValue
    if (finalValue === originalValueRef.current) {
      setIsEditing(false)
      return
    }

    isSavingRef.current = true
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
        toast.error(t('common.save_failed') || 'Failed to save')
      }
    } finally {
      setIsSaving(false)
      isSavingRef.current = false
    }
  }, [clearPendingBlurSave, trimOnSave, editValue, onSave, onError, t])

  const cancelEdit = useCallback(() => {
    clearPendingBlurSave()
    setIsEditing(false)
    setEditValue('')
    onCancel?.()
  }, [clearPendingBlurSave, onCancel])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.nativeEvent.isComposing) return
      if (e.key === 'Enter') {
        e.preventDefault()
        void saveEdit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        cancelEdit()
      } else if (e.key === ' ' || e.key === 'Spacebar') {
        e.stopPropagation()
      }
    },
    [saveEdit, cancelEdit]
  )

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value)
  }, [])

  const handleBlur = useCallback(() => {
    if (isSavingRef.current) return
    clearPendingBlurSave()
    blurSaveTimerRef.current = window.setTimeout(() => {
      blurSaveTimerRef.current = null
      void saveEdit()
    }, 0)
  }, [clearPendingBlurSave, saveEdit])

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
      disabled: isSaving // 保存时禁用输入
    }
  }
}
