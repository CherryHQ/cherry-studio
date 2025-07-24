import { Bold, Code, Italic, Link, Strikethrough, Underline } from 'lucide-react'
import type { Editor } from 'prosekit/core'
import type { LinkAttrs } from 'prosekit/extensions/link'
import type { EditorState } from 'prosekit/pm/state'
import { useEditor, useEditorDerivedValue } from 'prosekit/react'
import { InlinePopover } from 'prosekit/react/inline-popover'
import { useState } from 'react'
import styled from 'styled-components'

import Button from './Button'
import type { EditorExtension } from './extension'

function getInlineMenuItems(editor: Editor<EditorExtension>) {
  return {
    bold: {
      isActive: editor.marks.bold.isActive(),
      canExec: editor.commands.toggleBold.canExec(),
      command: () => editor.commands.toggleBold()
    },
    italic: {
      isActive: editor.marks.italic.isActive(),
      canExec: editor.commands.toggleItalic.canExec(),
      command: () => editor.commands.toggleItalic()
    },
    underline: {
      isActive: editor.marks.underline.isActive(),
      canExec: editor.commands.toggleUnderline.canExec(),
      command: () => editor.commands.toggleUnderline()
    },
    strike: {
      isActive: editor.marks.strike.isActive(),
      canExec: editor.commands.toggleStrike.canExec(),
      command: () => editor.commands.toggleStrike()
    },
    code: {
      isActive: editor.marks.code.isActive(),
      canExec: editor.commands.toggleCode.canExec(),
      command: () => editor.commands.toggleCode()
    },
    link: {
      isActive: editor.marks.link.isActive(),
      canExec: editor.commands.addLink.canExec({ href: '' }),
      command: () => editor.commands.expandLink(),
      currentLink: getCurrentLink(editor.state)
    }
  }
}

function getCurrentLink(state: EditorState): string | undefined {
  const { $from } = state.selection
  const marks = $from.marksAcross($from)
  if (!marks) {
    return
  }
  for (const mark of marks) {
    if (mark.type.name === 'link') {
      return (mark.attrs as LinkAttrs).href
    }
  }
}

export default function InlineMenu() {
  const editor = useEditor<EditorExtension>()
  const items = useEditorDerivedValue(getInlineMenuItems)

  const [linkMenuOpen, setLinkMenuOpen] = useState(false)
  const toggleLinkMenuOpen = () => setLinkMenuOpen((open) => !open)

  const handleLinkUpdate = (href?: string) => {
    if (href) {
      editor.commands.addLink({ href })
    } else {
      editor.commands.removeLink()
    }

    setLinkMenuOpen(false)
    editor.focus()
  }

  return (
    <>
      <StyledInlinePopover
        data-testid="inline-menu-main"
        onOpenChange={(open) => {
          if (!open) {
            setLinkMenuOpen(false)
          }
        }}>
        <Button
          pressed={items.bold.isActive}
          disabled={!items.bold.canExec}
          onClick={items.bold.command}
          tooltip="Bold">
          <Bold size={20} />
        </Button>

        <Button
          pressed={items.italic.isActive}
          disabled={!items.italic.canExec}
          onClick={items.italic.command}
          tooltip="Italic">
          <Italic size={20} />
        </Button>

        <Button
          pressed={items.underline.isActive}
          disabled={!items.underline.canExec}
          onClick={items.underline.command}
          tooltip="Underline">
          <Underline size={20} />
        </Button>

        <Button
          pressed={items.strike.isActive}
          disabled={!items.strike.canExec}
          onClick={items.strike.command}
          tooltip="Strikethrough">
          <Strikethrough size={20} />
        </Button>

        <Button
          pressed={items.code.isActive}
          disabled={!items.code.canExec}
          onClick={items.code.command}
          tooltip="Code">
          <Code size={20} />
        </Button>

        {items.link.canExec && (
          <Button
            pressed={items.link.isActive}
            onClick={() => {
              items.link.command()
              toggleLinkMenuOpen()
            }}
            tooltip="Link">
            <Link size={20} />
          </Button>
        )}
      </StyledInlinePopover>

      <LinkPopover
        placement={'bottom'}
        defaultOpen={false}
        open={linkMenuOpen}
        onOpenChange={setLinkMenuOpen}
        data-testid="inline-menu-link">
        {linkMenuOpen && (
          <LinkForm
            onSubmit={(event) => {
              event.preventDefault()
              const target = event.target as HTMLFormElement | null
              const href = target?.querySelector('input')?.value?.trim()
              handleLinkUpdate(href)
            }}>
            <LinkInput placeholder="Paste the link..." defaultValue={items.link.currentLink} />
          </LinkForm>
        )}
        {items.link.isActive && (
          <RemoveLinkButton onClick={() => handleLinkUpdate()} onMouseDown={(event) => event.preventDefault()}>
            Remove link
          </RemoveLinkButton>
        )}
      </LinkPopover>
    </>
  )
}

const StyledInlinePopover = styled(InlinePopover)`
  z-index: 10;
  box-sizing: border-box;
  border: 1px solid var(--color-border);
  background-color: var(--color-background);
  box-shadow:
    0 10px 15px -3px rgb(0 0 0 / 0.1),
    0 4px 6px -4px rgb(0 0 0 / 0.1);
  position: relative;
  display: flex;
  min-width: 8rem;
  gap: 0.25rem;
  overflow: auto;
  white-space: nowrap;
  border-radius: 0.375rem;
  padding: 0.25rem;

  &:not([data-state]) {
    display: none;
  }
`

const LinkPopover = styled(InlinePopover)`
  z-index: 10;
  box-sizing: border-box;
  border: 1px solid var(--color-border);
  background-color: var(--color-background);
  box-shadow:
    0 10px 15px -3px rgb(0 0 0 / 0.1),
    0 4px 6px -4px rgb(0 0 0 / 0.1);
  position: relative;
  display: flex;
  flex-direction: column;
  width: 20rem;
  border-radius: 0.5rem;
  padding: 1rem;
  gap: 0.5rem;
  align-items: stretch;

  &:not([data-state]) {
    display: none;
  }
`

const LinkForm = styled.form``

const LinkInput = styled.input`
  display: flex;
  height: 2.25rem;
  border-radius: 0.375rem;
  width: 100%;
  background-color: var(--color-background);
  border: 1px solid var(--color-border);
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  transition: all 0.15s ease-in-out;
  border: 1px solid;
  box-sizing: border-box;
  outline: none;

  &::placeholder {
    color: var(--color-text-secondary);
  }

  &:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`

const RemoveLinkButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  transition: all 0.15s ease-in-out;
  border: 0;
  background-color: var(--color-background);
  color: var(--color-link);
  height: 2.25rem;
  padding: 0 0.75rem;
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
    background-color: var(--color-hover);
  }
`
