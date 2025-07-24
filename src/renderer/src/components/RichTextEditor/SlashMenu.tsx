import { useEditor } from 'prosekit/react'
import { AutocompleteList, AutocompletePopover } from 'prosekit/react/autocomplete'
import styled from 'styled-components'

import type { EditorExtension } from './extension'
import SlashMenuEmpty from './SlashMenuEmpty'
import SlashMenuItem from './SlashMenuItem'

export default function SlashMenu() {
  const editor = useEditor<EditorExtension>()

  // Match inputs like "/", "/table", "/heading 1" etc. Do not match "/ heading".
  const regex = /\/(|\S.*)$/u

  return (
    <StyledAutocompletePopover regex={regex}>
      <AutocompleteList>
        <SlashMenuItem label="Text" onSelect={() => editor.commands.setParagraph()} />

        <SlashMenuItem label="Heading 1" kbd="#" onSelect={() => editor.commands.setHeading({ level: 1 })} />

        <SlashMenuItem label="Heading 2" kbd="##" onSelect={() => editor.commands.setHeading({ level: 2 })} />

        <SlashMenuItem label="Heading 3" kbd="###" onSelect={() => editor.commands.setHeading({ level: 3 })} />

        <SlashMenuItem label="Bullet list" kbd="-" onSelect={() => editor.commands.wrapInList({ kind: 'bullet' })} />

        <SlashMenuItem label="Ordered list" kbd="1." onSelect={() => editor.commands.wrapInList({ kind: 'ordered' })} />

        <SlashMenuItem label="Task list" kbd="[]" onSelect={() => editor.commands.wrapInList({ kind: 'task' })} />

        <SlashMenuItem label="Toggle list" kbd=">>" onSelect={() => editor.commands.wrapInList({ kind: 'toggle' })} />

        <SlashMenuItem label="Quote" kbd=">" onSelect={() => editor.commands.setBlockquote()} />

        <SlashMenuItem label="Table" onSelect={() => editor.commands.insertTable({ row: 3, col: 3 })} />

        <SlashMenuItem label="Divider" kbd="---" onSelect={() => editor.commands.insertHorizontalRule()} />

        <SlashMenuItem label="Code" kbd="```" onSelect={() => editor.commands.setCodeBlock()} />

        <SlashMenuEmpty />
      </AutocompleteList>
    </StyledAutocompletePopover>
  )
}

const StyledAutocompletePopover = styled(AutocompletePopover)`
  position: relative;
  display: block;
  max-height: 25rem;
  min-width: 15rem;
  user-select: none;
  overflow: auto;
  white-space: nowrap;
  padding: 0.25rem;
  z-index: 10;
  box-sizing: border-box;
  border: 1px solid var(--color-border);
  background-color: var(--color-background);
  box-shadow:
    0 10px 15px -3px rgb(0 0 0 / 0.1),
    0 4px 6px -4px rgb(0 0 0 / 0.1);

  &:not([data-state]) {
    display: none;
  }
`
