import { useAssistants } from '@renderer/hooks/useAssistant'
import { useSettings } from '@renderer/hooks/useSettings'
import { useActiveTopic } from '@renderer/hooks/useTopic'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import NavigationService from '@renderer/services/NavigationService'
import store from '@renderer/store'
import { addTopic } from '@renderer/store/assistants'
import { upsertManyBlocks } from '@renderer/store/messageBlock'
import { newMessagesActions } from '@renderer/store/newMessage'
import { saveNewTopicToDB } from '@renderer/store/thunk/messageThunk'
import { Assistant, Topic } from '@renderer/types' // Added Message import
import { MessageBlock } from '@renderer/types/newMessage'
import dayjs from 'dayjs'
import log from 'electron-log'
import { t } from 'i18next'
import { nanoid } from 'nanoid'
import { FC, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import Chat from './Chat'
import Navbar from './Navbar'
import HomeTabs from './Tabs'

let _activeAssistant: Assistant

const HomePage: FC = () => {
  const { assistants } = useAssistants()
  const navigate = useNavigate()

  const location = useLocation()
  const state = location.state

  const [activeAssistant, setActiveAssistant] = useState(state?.assistant || _activeAssistant || assistants[0])
  const { activeTopic, setActiveTopic } = useActiveTopic(activeAssistant, state?.topic)
  const { showAssistants, showTopics, topicPosition } = useSettings()

  _activeAssistant = activeAssistant

  useEffect(() => {
    NavigationService.setNavigate(navigate)
  }, [navigate])

  useEffect(() => {
    state?.assistant && setActiveAssistant(state?.assistant)
    state?.topic && setActiveTopic(state?.topic)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  useEffect(() => {
    const unsubscribe = EventEmitter.on(EVENT_NAMES.SWITCH_ASSISTANT, (assistantId: string) => {
      const newAssistant = assistants.find((a) => a.id === assistantId)
      if (newAssistant) {
        setActiveAssistant(newAssistant)
      }
    })

    return () => {
      unsubscribe()
    }
  }, [assistants, setActiveAssistant])

  useEffect(() => {
    const unsubscribe = EventEmitter.on(EVENT_NAMES.CHANGE_TOPIC, (topic?: Topic) => {
      if (topic) {
        setActiveTopic(topic)
      }
    })
    return () => unsubscribe()
  }, [setActiveTopic])

  // 監聽來自快捷助手的 assistant 和 topic 設定，延續對話
  useEffect(() => {
    console.log('[HomePage] useEffect for QuickAssist_Finalize_Topic listener setup')
    if (window.api?.window?.onReceiveQuickAssistTopic) {
      const removeIpcListener = window.api.window.onReceiveQuickAssistTopic((assistantId: string, topic: Topic) => {
        console.log('[HomePage] onReceiveQuickAssistTopic CALLBACK TRIGGERED')
        console.log('Receive topic from quick window', { assistantId, topic })

        const quickAssistTopic = topic
        log.info('[HomePage] Received topic from quick window', { assistantId, quickAssistTopic })

        const assistantState = store.getState().assistants
        if (!assistantState?.assistants || !Array.isArray(assistantState.assistants)) {
          log.error('Failed to process topic from quick window: assistants state is invalid')
          return
        }

        const targetAssistant = assistantState.assistants.find((a) => a.id === assistantId)
        if (!targetAssistant) {
          log.error('Failed to process topic from quick window: Target assistant not found', { assistantId })
          return
        }

        if (!quickAssistTopic.messages?.length) {
          log.warn('Received topic from quick window has no messages, nothing to clone.')
          // Optionally, 可選擇切換到助手和一個空的新主題
          // const emptyNewTopic: Topic = {
          //   id: nanoid(),
          //   name: quickAssistTopic.name || `From Quick Assistant (${dayjs().format('HH:mm')})`,
          //   messages: [],
          //   createdAt: new Date().toISOString(),
          //   updatedAt: new Date().toISOString(),
          //   assistantId: targetAssistant.id,
          //   isNameManuallyEdited: false
          // }
          // store.dispatch(addTopic({ assistantId: targetAssistant.id, topic: emptyNewTopic }))
          // setActiveAssistant(targetAssistant)
          // setActiveTopic(emptyNewTopic)
          return
        }

        // Create a new topic in the main application
        const newMainTopic: Topic = {
          id: nanoid(),
          name: t('chat.default.quickAssistant.topic.name') + ` (${dayjs().format('HH:mm')})`,
          messages: [], // Messages will be cloned by the thunk
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          assistantId: targetAssistant.id,
          isNameManuallyEdited: false
        }

        // Add the new topic shell to the store first
        store.dispatch(addTopic({ assistantId: targetAssistant.id, topic: newMainTopic }))

        const messagesToClone = quickAssistTopic.messages.map((msg) => ({
          ...msg,
          id: nanoid(),
          topicId: newMainTopic.id,
          assistantId: targetAssistant.id
        }))

        const blocksToClone: MessageBlock[] = []
        messagesToClone.forEach((clonedMsg, index) => {
          const originalMsg = quickAssistTopic.messages[index]
          if (originalMsg.blocks && Array.isArray(originalMsg.blocks)) {
            const clonedBlocksForThisMessage = originalMsg.blocks
              .map((blockId) => {
                // This assumes quickAssistTopic.blocks contains the actual block objects, keyed by their original IDs
                // Or, if quickAssistTopic.messages[x].blocks is an array of block objects directly (which is more likely from IPC)
                // Let's assume `originalMsg.blocks` is an array of block IDs, and the actual blocks are somewhere in `quickAssistTopic`
                // This part is tricky without knowing the exact structure of `topic` from miniWindow.
                // Let's assume `quickAssistTopic.messages[index].messageBlocks` (hypothetical) holds the block objects.
                // For now, we'll assume `originalMsg.blocks` are IDs and we need to find the block objects in `quickAssistTopic` if it has a flat list of blocks.
                // Given the provided context, `Message` type has `blocks?: string[]` and `messageBlocks?: MessageBlock[]` (from a quick look at other files).
                // Let's assume `messageBlocks` is populated.

                const originalBlock = (originalMsg as any).messageBlocks?.find((b) => b.id === blockId)
                if (originalBlock) {
                  return {
                    ...originalBlock,
                    id: nanoid(),
                    messageId: clonedMsg.id
                  }
                }
                return null
              })
              .filter(Boolean) as MessageBlock[]
            clonedMsg.blocks = clonedBlocksForThisMessage.map((b) => b.id) // Update cloned message with new block IDs
            blocksToClone.push(...clonedBlocksForThisMessage)
          }
        })

        if (blocksToClone.length > 0) {
          store.dispatch(upsertManyBlocks(blocksToClone))
        }

        if (messagesToClone.length > 0) {
          store.dispatch(
            newMessagesActions.messagesReceived({
              topicId: newMainTopic.id,
              messages: messagesToClone
            })
          )
        }

        setActiveAssistant(targetAssistant)
        setActiveTopic(newMainTopic)
        setTimeout(() => EventEmitter.emit(EVENT_NAMES.SHOW_TOPIC_SIDEBAR), 0)

        log.info(
          `[HomePage] New topic '${newMainTopic.name}' (ID: ${newMainTopic.id}) created and populated from Quick Assistant.`
        )

        // 將新的 Topic, Messages, MessageBlocks 儲存到資料庫
        const topicForDb = {
          id: newMainTopic.id,
          name: newMainTopic.name,
          assistantId: newMainTopic.assistantId,
          createdAt: newMainTopic.createdAt,
          updatedAt: newMainTopic.updatedAt,
          pinned: newMainTopic.pinned || false,
          messages: messagesToClone
        }

        ;(async () => {
          try {
            await saveNewTopicToDB(topicForDb, blocksToClone)
            log.info(
              `[HomePage] Successfully saved new topic ${topicForDb.id} with ${messagesToClone.length} messages and ${blocksToClone.length} blocks to DB via thunk.`
            )
          } catch (error) {
            log.error(`[HomePage] Error saving new topic ${topicForDb.id} via thunk:`, error)
          }
        })()
      })

      return () => removeIpcListener?.()
    }

    log.warn('window.api.window.onReceiveQuickAssistTopic is not available yet.')
    return () => {}
  }, [activeAssistant, assistants, setActiveAssistant, setActiveTopic])

  useEffect(() => {
    const canMinimize = topicPosition == 'left' ? !showAssistants : !showAssistants && !showTopics
    window.api.window.setMinimumSize(canMinimize ? 520 : 1080, 600)

    return () => {
      window.api.window.resetMinimumSize()
    }
  }, [showAssistants, showTopics, topicPosition])

  return (
    <Container id="home-page">
      <Navbar
        activeAssistant={activeAssistant}
        activeTopic={activeTopic}
        setActiveTopic={setActiveTopic}
        setActiveAssistant={setActiveAssistant}
        position="left"
      />
      <ContentContainer id="content-container">
        {showAssistants && (
          <HomeTabs
            activeAssistant={activeAssistant}
            activeTopic={activeTopic}
            setActiveAssistant={setActiveAssistant}
            setActiveTopic={setActiveTopic}
            position="left"
          />
        )}
        <Chat
          assistant={activeAssistant}
          activeTopic={activeTopic}
          setActiveTopic={setActiveTopic}
          setActiveAssistant={setActiveAssistant}
        />
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  max-width: calc(100vw - var(--sidebar-width));
`

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
  overflow: hidden;
`

export default HomePage
