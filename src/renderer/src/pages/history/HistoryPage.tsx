import { HStack } from '@renderer/components/Layout'
import { useAppDispatch } from '@renderer/store'
import { loadTopicMessagesThunk } from '@renderer/store/thunk/messageThunk'
import { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { Divider, Input, InputRef } from 'antd'
import { last } from 'lodash'
import { ChevronLeft, CornerDownLeft, Search } from 'lucide-react'
import { FC, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import SearchMessage from './components/SearchMessage'
import SearchResults from './components/SearchResults'
import TopicMessages from './components/TopicMessages'
import TopicsHistory from './components/TopicsHistory'

type Route = 'topics' | 'topic' | 'search' | 'message'

let _search = ''
let _stack: Route[] = ['topics']
let _topic: Topic | undefined
let _message: Message | undefined

const TopicsPage: FC = () => {
  const { t } = useTranslation()
  const [search, setSearch] = useState(_search)
  const [searchKeywords, setSearchKeywords] = useState(_search)
  const [stack, setStack] = useState<Route[]>(_stack)
  const [topic, setTopic] = useState<Topic | undefined>(_topic)
  const [message, setMessage] = useState<Message | undefined>(_message)
  const inputRef = useRef<InputRef>(null)
  const dispatch = useAppDispatch()

  _search = search
  _stack = stack
  _topic = topic
  _message = message

  const goBack = () => {
    const _stack = [...stack]
    const route = _stack.pop()
    setStack(_stack)
    route === 'search' && setSearch('')
    route === 'topic' && setTopic(undefined)
    route === 'message' && setMessage(undefined)
  }

  const onSearch = () => {
    setSearchKeywords(search)
    setStack(['topics', 'search'])
    setTopic(undefined)
  }

  const onTopicClick = (topic: Topic) => {
    setStack((prev) => [...prev, 'topic'])
    setTopic(topic)
  }

  const onMessageClick = (message: Message) => {
    dispatch(loadTopicMessagesThunk(message.topicId))
    setStack(['topics', 'search', 'message'])
    setMessage(message)
  }

  const isShow = (route: Route) => (last(stack) === route ? 'flex' : 'none')

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  return (
    <Container>
      <HStack style={{ padding: '0 12px', marginTop: 8 }}>
        <Input
          prefix={
            stack.length > 1 ? (
              <SearchIcon className="back-icon" onClick={goBack}>
                <ChevronLeft size={16} />
              </SearchIcon>
            ) : (
              <SearchIcon>
                <Search size={15} />
              </SearchIcon>
            )
          }
          suffix={search.length >= 2 ? <CornerDownLeft size={16} /> : null}
          ref={inputRef}
          placeholder={t('history.search.placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value.trimStart())}
          allowClear
          autoFocus
          spellCheck={false}
          style={{ paddingLeft: 0 }}
          variant="borderless"
          size="middle"
          onPressEnter={onSearch}
        />
      </HStack>
      <Divider style={{ margin: 0, marginTop: 4, borderBlockStartWidth: 0.5 }} />

      <TopicsHistory
        keywords={search}
        onClick={onTopicClick as any}
        onSearch={onSearch}
        style={{ display: isShow('topics') }}
      />
      <TopicMessages topic={topic} style={{ display: isShow('topic') }} />
      <SearchResults
        keywords={isShow('search') ? searchKeywords : ''}
        onMessageClick={onMessageClick}
        onTopicClick={onTopicClick}
        style={{ display: isShow('search') }}
      />
      <SearchMessage message={message} style={{ display: isShow('message') }} />
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  height: 100%;
`

const SearchIcon = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  background-color: var(--color-background-soft);
  margin-right: 2px;
  &.back-icon {
    cursor: pointer;
    transition: background-color 0.2s;
    &:hover {
      background-color: var(--color-background-mute);
    }
  }
`

export default TopicsPage
