import { useCallback, useEffect, useRef, useState } from 'react'

export interface UseInPlaceEditOptions {
  onSave: (value: string) => void
  onCancel?: () => void
  autoSelectOnStart?: boolean
  trimOnSave?: boolean
}

export interface UseInPlaceEditReturn {
  isEditing: boolean
  editValue: string
  inputRef: React.RefObject<HTMLInputElement | null>
  startEdit: (initialValue: string) => void
  saveEdit: () => void
  cancelEdit: () => void
  handleKeyDown: (e: React.KeyboardEvent) => void
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export function useInPlaceEdit(options: UseInPlaceEditOptions): UseInPlaceEditReturn {
  const { onSave, onCancel, autoSelectOnStart = true, trimOnSave = true } = options

  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [originalValue, setOriginalValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = useCallback(
    (initialValue: string) => {
      setIsEditing(true)
      setEditValue(initialValue)
      setOriginalValue(initialValue)

      setTimeout(() => {
        inputRef.current?.focus()
        if (autoSelectOnStart) {
          inputRef.current?.select()
        }
      }, 0)
    },
    [autoSelectOnStart]
  )

  const saveEdit = useCallback(() => {
    const finalValue = trimOnSave ? editValue.trim() : editValue
    if (finalValue !== originalValue) {
      onSave(finalValue)
    }
    setIsEditing(false)
    setEditValue('')
    setOriginalValue('')
  }, [editValue, originalValue, onSave, trimOnSave])

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
        cancelEdit()
      }
    },
    [saveEdit, cancelEdit]
  )

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setEditValue(e.target.value)
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
    editValue,
    inputRef,
    startEdit,
    saveEdit,
    cancelEdit,
    handleKeyDown,
    handleInputChange
  }
}
