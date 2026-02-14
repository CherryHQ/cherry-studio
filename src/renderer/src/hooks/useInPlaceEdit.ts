import { loggerService } from '@logger'
import type { ValidatorConfig } from '@shared/utils/validators'
import { debounce } from 'lodash'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useInPlaceEdit')

export interface UseInPlaceEditOptions {
  onSave: ((value: string) => void) | ((value: string) => Promise<void>)
  onCancel?: () => void
  onError?: (error: unknown) => void
  autoSelectOnStart?: boolean
  trimOnSave?: boolean
  /** Optional validator for real-time input validation */
  validator?: ValidatorConfig
}

export interface UseInPlaceEditReturn {
  isEditing: boolean
  isSaving: boolean
  startEdit: (initialValue: string) => void
  saveEdit: () => void
  cancelEdit: () => void
  inputProps: React.InputHTMLAttributes<HTMLInputElement> & { ref: React.RefObject<HTMLInputElement | null> }
  /** Current validation error message, null if valid */
  validationError: string | null
}

/**
 * A React hook that provides in-place editing functionality for text inputs
 * @param options - Configuration options for the in-place edit behavior
 * @param options.onSave - Callback function called when edits are saved
 * @param options.onCancel - Optional callback function called when editing is cancelled
 * @param options.autoSelectOnStart - Whether to automatically select text when editing starts (default: true)
 * @param options.trimOnSave - Whether to trim whitespace when saving (default: true)
 * @param options.validator - Optional validator for real-time input validation
 * @returns An object containing the editing state and handler functions
 */
export function useInPlaceEdit(options: UseInPlaceEditOptions): UseInPlaceEditReturn {
  const { onSave, onCancel, onError, autoSelectOnStart = true, trimOnSave = true, validator } = options
  const { t } = useTranslation()

  const [isSaving, setIsSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)
  const originalValueRef = useRef('')
  const inputRef = useRef<HTMLInputElement>(null)

  // Debounced validation function
  const debouncedValidate = useMemo(
    () =>
      debounce((value: string) => {
        const error = validator?.validate?.(value) ?? null
        setValidationError(error)
      }, validator?.debounceMs ?? 300),
    [validator]
  )

  // Cleanup debounced function on unmount
  useEffect(() => {
    return () => {
      debouncedValidate.cancel()
    }
  }, [debouncedValidate])

  const startEdit = useCallback((initialValue: string) => {
    setIsEditing(true)
    setEditValue(initialValue)
    setValidationError(null)
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

    // Final validation (sync, no debounce)
    if (validator?.validate) {
      const error = validator.validate(finalValue)
      if (error) {
        setValidationError(error)
        return // Block save, error will be shown inline
      }
    }

    if (finalValue === originalValueRef.current) {
      setIsEditing(false)
      setValidationError(null)
      return
    }

    setIsSaving(true)
    setValidationError(null)

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
  }, [isSaving, trimOnSave, editValue, onSave, onError, t, validator])

  const cancelEdit = useCallback(() => {
    setIsEditing(false)
    setEditValue('')
    setValidationError(null)
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

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      let value = e.target.value

      // Apply transform (e.g., lowercase, remove invalid chars)
      if (validator?.transform) {
        value = validator.transform(value)
      }

      setEditValue(value)

      // Trigger validation with debounce
      if (validator?.validate) {
        debouncedValidate(value)
      } else {
        setValidationError(null)
      }
    },
    [validator, debouncedValidate]
  )

  const handleBlur = useCallback(() => {
    // 这里的逻辑需要注意：
    // 如果点击了"取消"按钮，可能会先触发 Blur 保存。
    // 通常 InPlaceEdit 的逻辑是 Blur 即 Save。
    // 如果不想 Blur 保存，可以去掉这一行，或者判断 relatedTarget。
    if (!isSaving) {
      saveEdit()
    }
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
      disabled: isSaving // 保存时禁用输入
    },
    validationError
  }
}
