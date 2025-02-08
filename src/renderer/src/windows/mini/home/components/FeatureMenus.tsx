import { BulbOutlined, FileTextOutlined, MessageOutlined, TranslationOutlined } from '@ant-design/icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { Col } from 'antd'
import { Dispatch, FC, SetStateAction, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface FeatureMenusProps {
  text: string
  setRoute: Dispatch<SetStateAction<'translate' | 'summary' | 'chat' | 'explanation' | 'home'>>
  onSendMessage: (prompt?: string) => void
}

const FeatureMenus: FC<FeatureMenusProps> = ({ text, setRoute, onSendMessage }) => {
  const { t } = useTranslation()
  const [selectedIndex, setSelectedIndex] = useState(0)

  const features = useMemo(
    () => [
      {
        icon: <MessageOutlined style={{ fontSize: '16px', color: 'var(--color-text)' }} />,
        title: t('miniwindow.feature.chat'),
        active: true,
        onClick: () => {
          if (text) {
            setRoute('chat')
            onSendMessage()
          }
        }
      },
      {
        icon: <TranslationOutlined style={{ fontSize: '16px', color: 'var(--color-text)' }} />,
        title: t('miniwindow.feature.translate'),
        onClick: () => text && setRoute('translate')
      },
      {
        icon: <FileTextOutlined style={{ fontSize: '16px', color: 'var(--color-text)' }} />,
        title: t('miniwindow.feature.summary'),
        onClick: () => {
          if (text) {
            setRoute('summary')
            onSendMessage(t('prompts.summarize'))
          }
        }
      },
      {
        icon: <BulbOutlined style={{ fontSize: '16px', color: 'var(--color-text)' }} />,
        title: t('miniwindow.feature.explanation'),
        onClick: () => {
          if (text) {
            setRoute('explanation')
            onSendMessage(t('prompts.explanation'))
          }
        }
      }
    ],
    [onSendMessage, setRoute, t, text]
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : features.length - 1))
          break
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex((prev) => (prev < features.length - 1 ? prev + 1 : 0))
          break
        case 'Enter':
          e.preventDefault()
          features[selectedIndex].onClick?.()
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [features, selectedIndex])

  return (
    <FeatureList>
      <FeatureListWrapper>
        {features.map((feature, index) => (
          <Col span={24} key={index}>
            <FeatureItem onClick={feature.onClick} className={index === selectedIndex ? 'active' : ''}>
              <FeatureIcon>{feature.icon}</FeatureIcon>
              <FeatureTitle>{feature.title}</FeatureTitle>
            </FeatureItem>
          </Col>
        ))}
      </FeatureListWrapper>
    </FeatureList>
  )
}

const FeatureList = styled(Scrollbar)`
  flex: 1;
  -webkit-app-region: none;
`

const FeatureListWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
  cursor: pointer;
`

const FeatureItem = styled.div`
  cursor: pointer;
  transition: all 0.3s;
  background: transparent;
  border: none;
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  -webkit-app-region: none;
  border-radius: 8px;
  user-select: none;

  &:hover {
    background: var(--color-background-opacity);
  }

  &.active {
    background: var(--color-background-opacity);
  }
`

const FeatureIcon = styled.div`
  color: #fff;
`

const FeatureTitle = styled.h3`
  margin: 0;
  font-size: 14px;
`

export default FeatureMenus
