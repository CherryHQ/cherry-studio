import { RowFlex } from '@cherrystudio/ui'
import { TopView } from '@renderer/components/TopView'
import { useAssistants, useDefaultAssistant } from '@renderer/hooks/useAssistant'
import { useAssistantPresets } from '@renderer/hooks/useAssistantPresets'
import { useTimer } from '@renderer/hooks/useTimer'
import { useSystemAssistantPresets } from '@renderer/pages/store/assistants/presets'
import { createAssistantFromAgent, DEFAULT_ASSISTANT_SETTINGS } from '@renderer/services/AssistantService'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { Assistant, AssistantPreset } from '@renderer/types'
import { DEFAULT_ASSISTANT_ID } from '@shared/data/types/assistant'
import type { InputRef } from 'antd'
import { Divider, Input, Modal, Tag } from 'antd'
import { take } from 'lodash'
import { Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import EmojiIcon from '../EmojiIcon'
import Scrollbar from '../Scrollbar'

/** Field-by-field check for legacy v1 records still living in Redux. */
const isAgentPreset = (preset: AssistantPreset): boolean => (preset as unknown as { type?: string }).type === 'agent'

interface Props {
  resolve: (value: Assistant | undefined) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const { presets: userPresets } = useAssistantPresets()
  const [searchText, setSearchText] = useState('')
  const { assistant: defaultAssistant } = useDefaultAssistant()
  const { assistants, addAssistant } = useAssistants()
  const inputRef = useRef<InputRef>(null)
  const systemPresets = useSystemAssistantPresets()
  const loadingRef = useRef(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const { setTimeoutTimer } = useTimer()

  const presets = useMemo(() => {
    const allPresets = [...userPresets, ...systemPresets] as AssistantPreset[]
    const base: AssistantPreset[] = [defaultAssistant as AssistantPreset]
    const list = [...base, ...allPresets.filter((preset) => !assistants.map((a) => a.id).includes(preset.id))]
    const filtered = searchText
      ? list.filter(
          (preset) =>
            preset.name.toLowerCase().includes(searchText.trim().toLocaleLowerCase()) ||
            preset.description?.toLowerCase().includes(searchText.trim().toLocaleLowerCase())
        )
      : list

    if (searchText.trim()) {
      const now = new Date().toISOString()
      const newAgent: AssistantPreset = {
        id: 'new',
        name: searchText.trim(),
        prompt: '',
        emoji: '⭐️',
        description: '',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        modelId: null,
        modelName: null,
        mcpServerIds: [],
        knowledgeBaseIds: [],
        tags: [],
        createdAt: now,
        updatedAt: now
      }
      return [newAgent, ...filtered]
    }
    return filtered
  }, [assistants, defaultAssistant, searchText, systemPresets, userPresets])

  // 重置选中索引当搜索或列表内容变更时
  useEffect(() => {
    setSelectedIndex(0)
  }, [presets.length, searchText])

  const onCreateAssistant = useCallback(
    async (preset: AssistantPreset | undefined) => {
      if (!preset || loadingRef.current) {
        return
      }

      loadingRef.current = true
      let assistant: Assistant

      if (preset.id === DEFAULT_ASSISTANT_ID || preset.id === 'new') {
        // Cloning the default seed (or a search-typed brand-new entry):
        // create via DataApi mutation. Fields not present on the preset
        // (id, createdAt, updatedAt) are filled by the server.
        const created = await addAssistant({
          name: preset.name,
          prompt: preset.prompt,
          emoji: preset.emoji,
          description: preset.description,
          settings: preset.settings,
          modelId: preset.modelId,
          mcpServerIds: preset.mcpServerIds,
          knowledgeBaseIds: preset.knowledgeBaseIds
        })
        assistant = created
      } else {
        assistant = await createAssistantFromAgent(preset)
      }

      setTimeoutTimer('onCreateAssistant', () => EventEmitter.emit(EVENT_NAMES.SHOW_ASSISTANTS), 0)
      resolve(assistant)
      setOpen(false)
    },
    [setTimeoutTimer, resolve, addAssistant]
  )
  // 键盘导航处理
  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const displayedPresets = take(presets, 100)

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => (prev >= displayedPresets.length - 1 ? 0 : prev + 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => (prev <= 0 ? displayedPresets.length - 1 : prev - 1))
          break
        case 'Enter':
        case 'NumpadEnter':
          // 如果焦点在输入框且有搜索内容，则默认选择第一项
          if (document.activeElement === inputRef.current?.input && searchText.trim()) {
            e.preventDefault()
            void onCreateAssistant(displayedPresets[selectedIndex])
          }
          // 否则选择当前选中项
          else if (selectedIndex >= 0 && selectedIndex < displayedPresets.length) {
            e.preventDefault()
            void onCreateAssistant(displayedPresets[selectedIndex])
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open, selectedIndex, presets, searchText, onCreateAssistant])

  // 确保选中项在可视区域
  useEffect(() => {
    if (containerRef.current) {
      const presetItems = containerRef.current.querySelectorAll('.agent-item')
      if (presetItems[selectedIndex]) {
        presetItems[selectedIndex].scrollIntoView({
          behavior: 'smooth',
          block: 'nearest'
        })
      }
    }
  }, [selectedIndex])

  const onCancel = () => {
    setOpen(false)
  }

  const onClose = async () => {
    resolve(undefined)
    AddAssistantPopup.hide()
  }

  useEffect(() => {
    if (!open) return

    const timer = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(timer)
  }, [open])

  return (
    <Modal
      centered
      open={open}
      onCancel={onCancel}
      afterClose={onClose}
      transitionName="animation-move-down"
      styles={{
        content: {
          borderRadius: 20,
          padding: 0,
          overflow: 'hidden',
          paddingBottom: 20
        },
        body: {
          padding: 0
        }
      }}
      closeIcon={null}
      footer={null}>
      <RowFlex className="mt-[5px] px-3">
        <Input
          prefix={
            <SearchIcon>
              <Search size={14} />
            </SearchIcon>
          }
          ref={inputRef}
          placeholder={t('assistants.search')}
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
          autoFocus
          style={{ paddingLeft: 0 }}
          variant="borderless"
          size="middle"
        />
      </RowFlex>
      <Divider style={{ margin: 0, marginTop: 4, borderBlockStartWidth: 0.5 }} />
      <Container ref={containerRef}>
        {take(presets, 100).map((preset, index) => (
          <AgentItem
            key={preset.id}
            onClick={() => onCreateAssistant(preset)}
            className={`agent-item ${preset.id === DEFAULT_ASSISTANT_ID ? 'default' : ''} ${index === selectedIndex ? 'keyboard-selected' : ''}`}
            onMouseEnter={() => setSelectedIndex(index)}>
            <RowFlex className="max-w-full items-center gap-[5px] overflow-hidden">
              <EmojiIcon emoji={preset.emoji || ''} />
              <span className="text-nowrap">{preset.name}</span>
            </RowFlex>
            {preset.id === DEFAULT_ASSISTANT_ID && <Tag color="green">{t('assistants.presets.tag.system')}</Tag>}
            {isAgentPreset(preset) && <Tag color="orange">{t('assistants.presets.tag.agent')}</Tag>}
            {preset.id === 'new' && <Tag color="green">{t('assistants.presets.tag.new')}</Tag>}
          </AgentItem>
        ))}
      </Container>
    </Modal>
  )
}

const Container = styled(Scrollbar)`
  padding: 0 12px;
  height: 50vh;
  margin-top: 10px;
`

const AgentItem = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding: 8px 15px;
  border-radius: 8px;
  user-select: none;
  margin-bottom: 8px;
  cursor: pointer;
  overflow: hidden;
  &.default {
    background-color: var(--color-background-mute);
  }
  &.keyboard-selected {
    background-color: var(--color-background-mute);
  }
  .anticon {
    font-size: 16px;
    color: var(--color-icon);
  }
  &:hover {
    background-color: var(--color-background-mute);
  }
`

const SearchIcon = styled.div`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  background-color: var(--color-background-mute);
  margin-right: 2px;
`

export default class AddAssistantPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('AddAssistantPopup')
  }
  static show() {
    return new Promise<Assistant | undefined>((resolve) => {
      TopView.show(<PopupContainer resolve={resolve} />, 'AddAssistantPopup')
    })
  }
}
