import { InfoCircleOutlined } from '@ant-design/icons'
import { Message } from '@renderer/types'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface Props {
  message: Message
}

const MessageSearchResults: FC<Props> = ({ message }) => {
  const { t } = useTranslation()

  if (!message.metadata?.groundingMetadata) {
    return null
  }

  const { groundingChunks, searchEntryPoint } = message.metadata.groundingMetadata

  if (!groundingChunks) {
    return null
  }

  let searchEntryContent = searchEntryPoint?.renderedContent

  searchEntryContent = searchEntryContent?.replace(
    /@media \(prefers-color-scheme: light\)/g,
    'body[theme-mode="light"]'
  )

  searchEntryContent = searchEntryContent?.replace(/@media \(prefers-color-scheme: dark\)/g, 'body[theme-mode="dark"]')

  return (
    <>
      <Container className="footnotes">
        <TitleRow>
          <Title>{t('common.footnotes')}</Title>
          <InfoCircleOutlined />
        </TitleRow>
        <Sources>
          {groundingChunks.map((chunk, index) => (
            <SourceItem key={index}>
              <Link href={chunk.web?.uri} target="_blank" rel="noopener noreferrer">
                {chunk.web?.title}
              </Link>
            </SourceItem>
          ))}
        </Sources>
      </Container>
      <SearchEntryPoint dangerouslySetInnerHTML={{ __html: searchEntryContent || '' }} />
    </>
  )
}

const Container = styled.div`
  padding: 16px;
  border-radius: 8px;
  margin-bottom: 0;
`

const TitleRow = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 5px;
  margin-bottom: 10px;
`

const Title = styled.h4`
  margin: 0 !important;
`

const Sources = styled.ol`
  margin-top: 10px;
`

const SourceItem = styled.li`
  margin-bottom: 5px;
`

const Link = styled.a`
  margin-left: 5px;
  color: var(--color-primary);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`

const SearchEntryPoint = styled.div`
  margin: 10px 2px;
`

export default MessageSearchResults
