import { useAssistant } from '@renderer/hooks/useAssistant'
import { fetchSuggestions } from '@renderer/services/ApiService'
import { getUserMessage } from '@renderer/services/MessagesService'
import { useAppDispatch } from '@renderer/store'
import { sendMessage } from '@renderer/store/messages'
import { Message, Suggestion, Topic } from '@renderer/types'
import { last } from 'lodash'
import { FC, memo, useEffect, useState } from 'react'
import BeatLoader from 'react-spinners/BeatLoader'
import styled from 'styled-components'

interface Props {
  topic: Topic
  messages: Message[]
}

const suggestionsMap = new Map<string, Suggestion[]>()

const Suggestions: FC<Props> = ({ topic, messages }) => {
  const dispatch = useAppDispatch()

  const [suggestions, setSuggestions] = useState<Suggestion[]>(
    suggestionsMap.get(messages[messages.length - 1]?.id) || []
  )
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)

  const { assistant, topics } = useAssistant(topic.assistantId)

  const handleSuggestionClick = async (content: string) => {
    const topic = topics.length > 0 ? topics[0] : null

    if (!topic) return

    const userMessage = getUserMessage({
      assistant,
      topic,
      type: 'text',
      content
    })

    await dispatch(sendMessage(userMessage, assistant, topic))
  }

  const suggestionsHandle = async () => {
    if (loadingSuggestions) return
    try {
      setLoadingSuggestions(true)
      const _suggestions = await fetchSuggestions({
        assistant,
        messages
      })
      if (_suggestions.length) {
        setSuggestions(_suggestions)
        suggestionsMap.set(messages[messages.length - 1].id, _suggestions)
      }
    } finally {
      setLoadingSuggestions(false)
    }
  }

  useEffect(() => {
    suggestionsHandle()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setSuggestions(suggestionsMap.get(messages[messages.length - 1]?.id) || [])
  }, [messages])

  if (last(messages)?.status !== 'success') {
    return null
  }
  if (loadingSuggestions) {
    return (
      <Container>
        <BeatLoader color="var(--color-text-2)" size="10" />
      </Container>
    )
  }

  if (suggestions.length === 0) {
    return null
  }

  return (
    <Container>
      <SuggestionsContainer>
        {suggestions.map((s, i) => (
          <SuggestionItem key={i} onClick={() => handleSuggestionClick(s.content)}>
            {s.content} →
          </SuggestionItem>
        ))}
      </SuggestionsContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  padding: 10px 10px 20px 65px;
  display: flex;
  width: 100%;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 15px;
`

const SuggestionsContainer = styled.div`
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  gap: 10px;
`

const SuggestionItem = styled.div`
  display: flex;
  align-items: center;
  width: fit-content;
  padding: 5px 10px;
  border-radius: 12px;
  font-size: 12px;
  color: var(--color-text);
  background: var(--color-background-mute);
  cursor: pointer;
  &:hover {
    opacity: 0.9;
  }
`

export default memo(Suggestions)
