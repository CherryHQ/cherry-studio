import { CopyOutlined, LoginOutlined } from '@ant-design/icons'
import { Tag } from 'antd'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface FooterProps {
  route: string
  onExit: () => void
}

const Footer: FC<FooterProps> = ({ route, onExit }) => {
  const { t } = useTranslation()

  return (
    <WindowFooter>
      <FooterText className="nodrag">
        <Tag bordered={false} icon={<LoginOutlined />} onClick={() => onExit()}>
          {t('miniwindow.footer.esc', {
            action: route === 'home' ? t('miniwindow.footer.esc_close') : t('miniwindow.footer.esc_back')
          })}
        </Tag>
        {route !== 'home' && (
          <Tag bordered={false} icon={<CopyOutlined />}>
            {t('miniwindow.footer.copy_last_message')}
          </Tag>
        )}
      </FooterText>
    </WindowFooter>
  )
}

const WindowFooter = styled.div`
  text-align: center;
  padding: 5px 0;
  color: var(--color-text-secondary);
  font-size: 12px;
  cursor: pointer;
`

const FooterText = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: var(--color-text-secondary);
  font-size: 12px;
`

export default Footer
