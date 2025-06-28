import { useEditor } from 'prosekit/react'
import { AutocompleteEmpty, AutocompleteItem, AutocompleteList, AutocompletePopover } from 'prosekit/react/autocomplete'
import styled from 'styled-components'

import type { EditorExtension } from './extension'
import { users } from './UserData'

export default function UserMenu() {
  const editor = useEditor<EditorExtension>()

  const handleUserInsert = (id: number, username: string) => {
    editor.commands.insertMention({
      id: id.toString(),
      value: '@' + username,
      kind: 'user'
    })
    editor.commands.insertText({ text: ' ' })
  }

  return (
    <StyledAutocompletePopover regex={/@\w*$/}>
      <AutocompleteList>
        <StyledAutocompleteEmpty>No results</StyledAutocompleteEmpty>

        {users.map((user) => (
          <StyledAutocompleteItem key={user.id} onSelect={() => handleUserInsert(user.id, user.name)}>
            {user.name}
          </StyledAutocompleteItem>
        ))}
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
  border-radius: 0.5rem;
  border: 1px solid var(--color-border);
  background-color: var(--color-background);
  box-shadow:
    0 10px 15px -3px rgb(0 0 0 / 0.1),
    0 4px 6px -4px rgb(0 0 0 / 0.1);

  &:not([data-state]) {
    display: none;
  }
`

const StyledAutocompleteEmpty = styled(AutocompleteEmpty)`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 8rem;
  scroll-margin: 0.25rem 0;
  border-radius: 0.25rem;
  padding: 0.375rem 0.75rem;
  box-sizing: border-box;
  cursor: default;
  user-select: none;
  white-space: nowrap;
  outline: none;

  &[data-focused] {
    background-color: var(--color-background);
  }
`

const StyledAutocompleteItem = styled(AutocompleteItem)`
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 8rem;
  scroll-margin: 0.25rem 0;
  border-radius: 0.25rem;
  padding: 0.375rem 0.75rem;
  box-sizing: border-box;
  cursor: default;
  user-select: none;
  white-space: nowrap;
  outline: none;

  &[data-focused] {
    background-color: var(--color-background);
  }
`
