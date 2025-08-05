import CustomTag from '@renderer/components/CustomTag'
import { DeleteIcon, EditIcon } from '@renderer/components/Icons'
import { useAgents } from '@renderer/hooks/useAgents'
import AssistantSettingsPopup from '@renderer/pages/settings/AssistantSettings'
import { createAssistantFromAgent } from '@renderer/services/AssistantService'
import type { Agent } from '@renderer/types'
import { getLeadingEmoji } from '@renderer/utils'
import { Button, Dropdown } from 'antd'
import { t } from 'i18next'
import { ArrowDownAZ, Ellipsis, PlusIcon, SquareArrowOutUpRight } from 'lucide-react'
import { type FC, memo, useCallback, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

import ManageAgentsPopup from './ManageAgentsPopup'

interface Props {
  agent: Agent
  activegroup?: string
  onClick: () => void
  getLocalizedGroupName: (group: string) => string
}

const AgentCard: FC<Props> = ({ agent, onClick, activegroup, getLocalizedGroupName }) => {
  const { removeAgent } = useAgents()
  const [isVisible, setIsVisible] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  const handleDelete = useCallback(
    (agent: Agent) => {
      window.modal.confirm({
        centered: true,
        content: t('agents.delete.popup.content'),
        onOk: () => removeAgent(agent.id)
      })
    },
    [removeAgent]
  )

  const exportAgent = useCallback(async () => {
    const result = [
      {
        name: agent.name,
        emoji: agent.emoji,
        group: agent.group,
        prompt: agent.prompt,
        description: agent.description,
        regularPhrases: agent.regularPhrases,
        type: 'agent'
      }
    ]

    const resultStr = JSON.stringify(result, null, 2)

    await window.api.file.save(`${agent.name}.json`, new TextEncoder().encode(resultStr), {
      filters: [{ name: t('agents.import.file_filter'), extensions: ['json'] }]
    })
  }, [agent])

  const menuItems = [
    {
      key: 'edit',
      label: t('agents.edit.title'),
      icon: <EditIcon size={14} />,
      onClick: (e: any) => {
        e.domEvent.stopPropagation()
        AssistantSettingsPopup.show({ assistant: agent })
      }
    },
    {
      key: 'create',
      label: t('agents.add.button'),
      icon: <PlusIcon size={14} />,
      onClick: (e: any) => {
        e.domEvent.stopPropagation()
        createAssistantFromAgent(agent)
      }
    },
    {
      key: 'sort',
      label: t('agents.sorting.title'),
      icon: <ArrowDownAZ size={14} />,
      onClick: (e: any) => {
        e.domEvent.stopPropagation()
        ManageAgentsPopup.show()
      }
    },
    {
      key: 'export',
      label: t('agents.export.agent'),
      icon: <SquareArrowOutUpRight size={14} />,
      onClick: (e: any) => {
        e.domEvent.stopPropagation()
        exportAgent()
      }
    },
    {
      key: 'delete',
      label: t('common.delete'),
      icon: <DeleteIcon size={14} className="lucide-custom" />,
      danger: true,
      onClick: (e: any) => {
        e.domEvent.stopPropagation()
        handleDelete(agent)
      }
    }
  ]

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.1 }
    )

    if (cardRef.current) {
      observer.observe(cardRef.current)
    }

    return () => {
      observer.disconnect()
    }
  }, [])

  const emoji = agent.emoji || getLeadingEmoji(agent.name)
  const prompt = (agent.description || agent.prompt).substring(0, 200).replace(/\\n/g, '')

  const content = (
    <AgentCardContainer onClick={onClick} ref={cardRef}>
      {isVisible && (
        <AgentCardBody>
          <AgentCardBackground>{emoji}</AgentCardBackground>
          <AgentCardHeader>
            <AgentCardHeaderInfo>
              <AgentCardHeaderInfoTitle>{agent.name}</AgentCardHeaderInfoTitle>
              <AgentCardHeaderInfoTags>
                {activegroup === '我的' && (
                  <CustomTag color="#A0A0A0" size={11}>
                    {getLocalizedGroupName('我的')}
                  </CustomTag>
                )}
                {!!agent.group?.length &&
                  agent.group.map((group) => (
                    <CustomTag key={group} color="#A0A0A0" size={11}>
                      {getLocalizedGroupName(group)}
                    </CustomTag>
                  ))}
              </AgentCardHeaderInfoTags>
            </AgentCardHeaderInfo>
            {activegroup === '我的' ? (
              <AgentCardHeaderInfoAction>
                {emoji && <HeaderInfoEmoji>{emoji}</HeaderInfoEmoji>}
                <Dropdown
                  menu={{
                    items: menuItems
                  }}
                  trigger={['click']}
                  placement="bottomRight">
                  <MenuButton
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                    }}
                    color="default"
                    variant="filled"
                    shape="circle"
                    icon={<Ellipsis size={14} color="var(--color-text-3)" />}
                  />
                </Dropdown>
              </AgentCardHeaderInfoAction>
            ) : (
              emoji && <HeaderInfoEmoji>{emoji}</HeaderInfoEmoji>
            )}
          </AgentCardHeader>
          <CardInfo>
            <AgentPrompt>{prompt}</AgentPrompt>
          </CardInfo>
        </AgentCardBody>
      )}
    </AgentCardContainer>
  )

  if (activegroup === '我的') {
    return (
      <Dropdown
        menu={{
          items: menuItems
        }}
        trigger={['contextMenu']}>
        {content}
      </Dropdown>
    )
  }

  return content
}

const AgentCardHeaderInfoAction = styled.div`
  width: 45px;
  height: 45px;
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
`

const HeaderInfoEmoji = styled.div`
  width: 45px;
  height: 45px;
  border-radius: var(--list-item-border-radius);
  font-size: 26px;
  line-height: 1;
  flex-shrink: 0;
  opacity: 1;
  transition: opacity 0.2s ease;
  background-color: var(--color-background-soft);
  display: flex;
  align-items: center;
  justify-content: center;
`

const MenuButton = styled(Button)`
  position: absolute;
  opacity: 0;
  transition: opacity 0.2s ease;
`

const AgentCardContainer = styled.div`
  border-radius: var(--list-item-border-radius);
  cursor: pointer;
  border: 0.5px solid var(--color-border);
  padding: 16px;
  overflow: hidden;
  transition:
    box-shadow 0.2s ease,
    background-color 0.2s ease,
    transform 0.2s ease;

  --shadow-color: rgba(0, 0, 0, 0.05);
  box-shadow:
    0 5px 7px -3px var(--color-border-soft),
    0 2px 3px -4px var(--color-border-soft);
  &:hover {
    box-shadow:
      0 10px 15px -3px var(--color-border-soft),
      0 4px 6px -4px var(--color-border-soft);
    transform: translateY(-2px);

    ${AgentCardHeaderInfoAction} ${HeaderInfoEmoji} {
      opacity: 0;
    }
    ${AgentCardHeaderInfoAction} ${MenuButton} {
      opacity: 1;
    }
  }
  body[theme-mode='dark'] & {
    --shadow-color: rgba(255, 255, 255, 0.02);
  }
`

const AgentCardBody = styled.div`
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  animation: fadeIn 0.2s ease;
`

const AgentCardBackground = styled.div`
  height: 100%;
  position: absolute;
  top: 0;
  right: -50px;
  font-size: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  opacity: 0.1;
  filter: blur(20px);
  border-radius: 99px;
  overflow: hidden;
`

const AgentCardHeader = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  justify-content: flex-start;
  overflow: hidden;
`

const AgentCardHeaderInfo = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 7px;
`

const AgentCardHeaderInfoTitle = styled.div`
  font-size: 16px;
  line-height: 1.2;
  font-weight: 600;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  word-break: break-all;
`

const AgentCardHeaderInfoTags = styled.div`
  display: flex;
  flex-direction: row;
  gap: 5px;
  flex-wrap: wrap;
`

const CardInfo = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  margin-top: 16px;
  background-color: var(--color-background-soft);
  padding: 8px;
  border-radius: 10px;
`

const AgentPrompt = styled.div`
  font-size: 12px;
  display: -webkit-box;
  line-height: 1.4;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--color-text-2);
`

export default memo(AgentCard)
