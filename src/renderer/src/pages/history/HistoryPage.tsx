import { ArrowLeftOutlined, EnterOutlined } from '@ant-design/icons'
import { useAppDispatch } from '@renderer/store'
import { loadTopicMessagesThunk } from '@renderer/store/thunk/messageThunk'
import { Topic } from '@renderer/types'
import type { Message } from '@renderer/types/newMessage'
import { Input, InputRef } from 'antd'
import { last } from 'lodash'
import { Search } from 'lucide-react'
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
      <Header>
        {stack.length > 1 && (
          <HeaderLeft>
            <MenuIcon onClick={goBack}>
              <ArrowLeftOutlined />
            </MenuIcon>
          </HeaderLeft>
        )}
        <SearchInput
          placeholder={t('history.search.placeholder')}
          type="search"
          value={search}
          autoFocus
          allowClear
          ref={inputRef}
          onChange={(e) => setSearch(e.target.value.trimStart())}
          suffix={search.length >= 2 ? <EnterOutlined /> : <Search size={16} />}
          onPressEnter={onSearch}
        />
      </Header>
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

const Header = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  padding: 12px 0;
  width: 100%;
  position: relative;
  background-color: var(--color-background-mute);
  border-top-left-radius: 8px;
  border-top-right-radius: 8px;
  border-bottom: 0.5px solid var(--color-frame-border);
`

const HeaderLeft = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  position: absolute;
  top: 12px;
  left: 15px;
`

const MenuIcon = styled.div`
  cursor: pointer;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  width: 33px;
  height: 33px;
  border-radius: 50%;
  &:hover {
    background-color: var(--color-background);
    .anticon {
      color: var(--color-text-1);
    }
  }
`

const SearchInput = styled(Input)`
  border-radius: 30px;
  width: 800px;
  height: 36px;
`

export default TopicsPage
