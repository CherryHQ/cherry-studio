import { useCallback, useEffect, useRef, useState } from 'react'

import { useTimer } from './useTimer'

export interface UseInPlaceEditOptions {
  onSave: ((value: string) => void) | ((value: string) => Promise<void>)
  onCancel?: () => void
  autoSelectOnStart?: boolean
  trimOnSave?: boolean
}

export interface UseInPlaceEditReturn {
  isEditing: boolean
  isSaving: boolean
  editValue: string
  inputRef: React.RefObject<HTMLInputElement | null>
  startEdit: (initialValue: string) => void
  saveEdit: () => void
  cancelEdit: () => void
  handleKeyDown: (e: React.KeyboardEvent) => void
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleValueChange: (value: string) => void
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
  const { onSave, onCancel, autoSelectOnStart = true, trimOnSave = true } = options

  const [isSaving, setIsSaving] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [originalValue, setOriginalValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { setTimeoutTimer } = useTimer()

  const startEdit = useCallback(
    (initialValue: string) => {
      setIsEditing(true)
      setEditValue(initialValue)
      setOriginalValue(initialValue)

      setTimeoutTimer(
        'startEdit',
        () => {
          inputRef.current?.focus()
          if (autoSelectOnStart) {
            inputRef.current?.select()
          }
        },
        0
      )
    },
    [autoSelectOnStart, setTimeoutTimer]
  )

  const saveEdit = useCallback(async () => {
    if (isSaving) return

    setIsSaving(true)

    try {
      const finalValue = trimOnSave ? editValue.trim() : editValue
      if (finalValue !== originalValue) {
        await onSave(finalValue)
      }
      setIsEditing(false)
      setEditValue('')
      setOriginalValue('')
    } finally {
      setIsSaving(false)
    }
  }, [isSaving, trimOnSave, editValue, originalValue, onSave])

  const cancelEdit = useCallback(() => {
    setIsEditing(false)
    setEditValue('')
    setOriginalValue('')
    onCancel?.()
  }, [onCancel])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
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

  const handleValueChange = useCallback((value: string) => {
    setEditValue(value)
  }, [])

  // Handle clicks outside the input to save
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isEditing && inputRef.current && !inputRef.current.contains(event.target as Node)) {
        saveEdit()
      }
    }

    if (isEditing) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => {
        document.removeEventListener('mousedown', handleClickOutside)
      }
    }
    return
  }, [isEditing, saveEdit])

  return {
    isEditing,
    isSaving,
    editValue,
    inputRef,
    startEdit,
    saveEdit,
    cancelEdit,
    handleKeyDown,
    handleInputChange,
    handleValueChange
  }
}
