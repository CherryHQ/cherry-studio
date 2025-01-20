import { BulbOutlined, FileTextOutlined, MessageOutlined, TranslationOutlined } from '@ant-design/icons'
import Scrollbar from '@renderer/components/Scrollbar'
import { Col } from 'antd'
import { Dispatch, FC, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface FeatureMenusProps {
  text: string
  setRoute: Dispatch<SetStateAction<'translate' | 'summary' | 'chat' | 'explanation' | 'home'>>
  onSendMessage: (prompt?: string) => void
}

const FeatureMenus: FC<FeatureMenusProps> = ({ text, setRoute, onSendMessage }) => {
  const { t } = useTranslation()

  const features = [
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
  ]

  return (
    <FeatureList>
      <FeatureListWrapper>
        {features.map((feature, index) => (
          <Col span={24} key={index}>
            <FeatureItem onClick={feature.onClick} className={feature.active ? 'active' : ''}>
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
