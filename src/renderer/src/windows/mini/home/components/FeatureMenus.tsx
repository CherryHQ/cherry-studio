import { BulbOutlined, EnterOutlined, FileTextOutlined, MessageOutlined, TranslationOutlined } from '@ant-design/icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { Col } from 'antd'
import { Dispatch, forwardRef, SetStateAction, useImperativeHandle, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface FeatureMenusProps {
  text: string
  setRoute: Dispatch<SetStateAction<'translate' | 'summary' | 'chat' | 'explanation' | 'home'>>
  onSendMessage: (prompt?: string) => void
}

export interface FeatureMenusRef {
  nextFeature: () => void
  prevFeature: () => void
  useFeature: () => void
  resetSelectedIndex: () => void
}

const FeatureMenus = forwardRef<FeatureMenusRef, FeatureMenusProps>(({ text, setRoute, onSendMessage }, ref) => {
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

  useImperativeHandle(ref, () => ({
    nextFeature() {
      setSelectedIndex((prev) => (prev < features.length - 1 ? prev + 1 : 0))
    },
    prevFeature() {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : features.length - 1))
    },
    useFeature() {
      features[selectedIndex].onClick?.()
    },
    resetSelectedIndex() {
      setSelectedIndex(0)
    }
  }))

  return (
    <FeatureList>
      <FeatureListWrapper>
        {features.map((feature, index) => (
          <Col span={24} key={index}>
            <FeatureItem onClick={feature.onClick} className={index === selectedIndex ? 'active' : ''}>
              <FeatureIcon>{feature.icon}</FeatureIcon>
              <FeatureTitle>{feature.title}</FeatureTitle>
              {index === selectedIndex && <EnterOutlined />}
            </FeatureItem>
          </Col>
        ))}
      </FeatureListWrapper>
    </FeatureList>
  )
})
FeatureMenus.displayName = 'FeatureMenus'

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
  transition: background-color 0s;
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
    background: var(--color-background-mute);
  }

  &.active {
    background: var(--color-background-mute);
  }
`

const FeatureIcon = styled.div`
  color: #fff;
`

const FeatureTitle = styled.h3`
  margin: 0;
  font-size: 14px;
  flex-basis: 100%;
`

export default FeatureMenus
