import { AutocompleteEmpty } from 'prosekit/react/autocomplete'
import styled from 'styled-components'

export default function SlashMenuEmpty() {
  return (
    <StyledAutocompleteEmpty>
      <span>No results</span>
    </StyledAutocompleteEmpty>
  )
}

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
