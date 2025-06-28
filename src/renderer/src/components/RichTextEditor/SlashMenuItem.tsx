import { AutocompleteItem } from 'prosekit/react/autocomplete'
import styled from 'styled-components'

export default function SlashMenuItem(props: { label: string; kbd?: string; onSelect: () => void }) {
  return (
    <StyledAutocompleteItem onSelect={props.onSelect}>
      <span>{props.label}</span>
      {props.kbd && <KeyboardShortcut>{props.kbd}</KeyboardShortcut>}
    </StyledAutocompleteItem>
  )
}

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

const KeyboardShortcut = styled.kbd`
  font-size: 0.75rem;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  color: var(--color-text-secondary);
`
