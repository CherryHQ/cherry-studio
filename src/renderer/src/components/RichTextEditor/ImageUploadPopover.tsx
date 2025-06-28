import { useEditor } from 'prosekit/react'
import { PopoverContent, PopoverRoot, PopoverTrigger } from 'prosekit/react/popover'
import { type FC, type ReactNode, useState } from 'react'
import styled from 'styled-components'

import Button from './Button'
import type { EditorExtension } from './extension'

export const ImageUploadPopover: FC<{
  tooltip: string
  disabled: boolean
  children: ReactNode
}> = ({ tooltip, disabled, children }) => {
  const [open, setOpen] = useState(false)
  const [webUrl, setWebUrl] = useState('')
  const [objectUrl, setObjectUrl] = useState('')
  const url = webUrl || objectUrl

  const editor = useEditor<EditorExtension>()

  const handleFileChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    const file = event.target.files?.[0]

    if (file) {
      setObjectUrl(URL.createObjectURL(file))
      setWebUrl('')
    } else {
      setObjectUrl('')
    }
  }

  const handleWebUrlChange: React.ChangeEventHandler<HTMLInputElement> = (event) => {
    const url = event.target.value

    if (url) {
      setWebUrl(url)
      setObjectUrl('')
    } else {
      setWebUrl('')
    }
  }

  const deferResetState = () => {
    setTimeout(() => {
      setWebUrl('')
      setObjectUrl('')
    }, 300)
  }

  const handleSubmit = () => {
    editor.commands.insertImage({ src: url })
    deferResetState()
    setOpen(false)
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      deferResetState()
    }
    setOpen(open)
  }

  return (
    <PopoverRoot open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger>
        <Button pressed={open} disabled={disabled} tooltip={tooltip}>
          {children}
        </Button>
      </PopoverTrigger>

      <StyledPopoverContent>
        {objectUrl ? null : (
          <>
            <InputLabel>Embed Link</InputLabel>
            <StyledInput
              placeholder="Paste the image link..."
              type="url"
              value={webUrl}
              onChange={handleWebUrlChange}
            />
          </>
        )}

        {webUrl ? null : (
          <>
            <InputLabel>Upload</InputLabel>
            <StyledInput accept="image/*" type="file" onChange={handleFileChange} />
          </>
        )}

        {url ? (
          <SubmitButton type="button" onClick={handleSubmit}>
            Insert Image
          </SubmitButton>
        ) : null}
      </StyledPopoverContent>
    </PopoverRoot>
  )
}

const StyledPopoverContent = styled(PopoverContent)`
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 1.5rem;
  font-size: 0.875rem;
  width: 20rem;
  z-index: 10;
  box-sizing: border-box;
  border-radius: 0.5rem;
  border: 1px solid var(--color-border);
  background-color: var(--color-background);
  box-shadow:
    0 10px 15px -3px rgb(0 0 0 / 0.1),
    0 4px 6px -4px rgb(0 0 0 / 0.1);
  will-change: transform;

  &:not([data-state]) {
    display: none;
  }

  &[data-state='open'] {
    animation:
      fade-in 150ms ease-out,
      zoom-in 150ms ease-out;
  }

  &[data-state='closed'] {
    animation:
      fade-out 200ms ease-out,
      zoom-out 200ms ease-out;
  }

  &[data-side='bottom'] {
    animation:
      fade-in 150ms ease-out,
      slide-in-from-top 150ms ease-out;
  }

  &[data-side='left'] {
    animation:
      fade-in 150ms ease-out,
      slide-in-from-right 150ms ease-out;
  }

  &[data-side='right'] {
    animation:
      fade-in 150ms ease-out,
      slide-in-from-left 150ms ease-out;
  }

  &[data-side='top'] {
    animation:
      fade-in 150ms ease-out,
      slide-in-from-bottom 150ms ease-out;
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes fade-out {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }

  @keyframes zoom-in {
    from {
      transform: scale(0.95);
    }
    to {
      transform: scale(1);
    }
  }

  @keyframes zoom-out {
    from {
      transform: scale(1);
    }
    to {
      transform: scale(0.95);
    }
  }

  @keyframes slide-in-from-top {
    from {
      transform: translateY(-0.5rem);
    }
    to {
      transform: translateY(0);
    }
  }

  @keyframes slide-in-from-bottom {
    from {
      transform: translateY(0.5rem);
    }
    to {
      transform: translateY(0);
    }
  }

  @keyframes slide-in-from-left {
    from {
      transform: translateX(-0.5rem);
    }
    to {
      transform: translateX(0);
    }
  }

  @keyframes slide-in-from-right {
    from {
      transform: translateX(0.5rem);
    }
    to {
      transform: translateX(0);
    }
  }
`

const InputLabel = styled.label`
  font-weight: 500;
`

const StyledInput = styled.input`
  display: flex;
  height: 2.25rem;
  border-radius: 0.375rem;
  width: 100%;
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  transition: all 0.15s ease-in-out;
  box-sizing: border-box;
  outline: none;

  &::placeholder {
    color: var(--color-text-secondary);
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px;
  }

  &::file-selector-button {
    border: 0;
    background-color: transparent;
    font-size: 0.875rem;
    font-weight: 500;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`

const SubmitButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.15s ease-in-out;
  border: 1px solid var(--color-border);
  background-color: var(--color-primary);
  color: white;
  height: 2.5rem;
  padding: 0.5rem 1rem;
  width: 100%;
  cursor: pointer;

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px;
  }

  &:disabled {
    pointer-events: none;
    opacity: 0.5;
  }

  &:hover:not(:disabled) {
    background-color: var(--color-background);
  }
`
