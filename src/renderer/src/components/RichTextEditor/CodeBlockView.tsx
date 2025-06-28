import type { CodeBlockAttrs } from 'prosekit/extensions/code-block'
import { shikiBundledLanguagesInfo } from 'prosekit/extensions/code-block'
import type { ReactNodeViewProps } from 'prosekit/react'
import styled from 'styled-components'

export default function CodeBlockView(props: ReactNodeViewProps) {
  const attrs = props.node.attrs as CodeBlockAttrs
  const language = attrs.language

  const setLanguage = (language: string) => {
    const attrs: CodeBlockAttrs = { language }
    props.setAttrs(attrs)
  }

  return (
    <>
      <LanguageSelectContainer contentEditable={false}>
        <LanguageSelect onChange={(event) => setLanguage(event.target.value)} value={language || ''}>
          <option value="">Plain Text</option>
          {shikiBundledLanguagesInfo.map((info) => (
            <option key={info.id} value={info.id}>
              {info.name}
            </option>
          ))}
        </LanguageSelect>
      </LanguageSelectContainer>
      <CodePre ref={props.contentRef} data-language={language}></CodePre>
    </>
  )
}

const LanguageSelectContainer = styled.div`
  position: relative;
  margin: 0 0.5rem;
  top: 0.75rem;
  height: 0;
  user-select: none;
  overflow: visible;
  font-size: 0.75rem;
`

const LanguageSelect = styled.select`
  outline: unset;
  position: relative;
  box-sizing: border-box;
  width: auto;
  cursor: pointer;
  user-select: none;
  appearance: none;
  border-radius: 0.25rem;
  border: none;
  background-color: transparent;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  transition: all 0.15s ease-in-out;
  color: var(--prosemirror-highlight);
  opacity: 0;

  &:focus {
    outline: unset;
  }

  &:hover {
    opacity: 0.8;
  }

  div[data-node-view-root]:hover & {
    opacity: 0.5;

    &:hover {
      opacity: 0.8;
    }
  }
`

const CodePre = styled.pre``
