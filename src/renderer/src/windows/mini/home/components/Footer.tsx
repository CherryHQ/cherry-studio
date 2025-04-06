import { ArrowLeftOutlined, CopyOutlined, LogoutOutlined, PushpinFilled, PushpinOutlined } from '@ant-design/icons'
import { Tag, Tooltip } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface FooterProps {
  route: string
  canUseBackspace?: boolean
  clearClipboard?: () => void
  onExit: () => void
}

const Footer: FC<FooterProps> = ({ route, canUseBackspace, clearClipboard, onExit }) => {
  const { t } = useTranslation()
  const [isPinned, setIsPinned] = useState(false)

  const onClickPin = () => {
    window.api.miniWindow.setPin(!isPinned).then(() => {
      setIsPinned(!isPinned)
    })
  }

  return (
    <WindowFooter className="drag">
      <PinButtonArea onClick={() => onClickPin()} className="nodrag">
        <Tooltip title={t('miniwindow.tooltip.pin')} mouseEnterDelay={0.8} placement="left">
          {isPinned ? (
            <PushpinFilled style={{ fontSize: '18px', color: 'var(--color-primary)' }} />
          ) : (
            <PushpinOutlined style={{ fontSize: '18px' }} />
          )}
        </Tooltip>
      </PinButtonArea>
      <FooterText>
        <Tag
          bordered={false}
          icon={<LogoutOutlined />}
          style={{ cursor: 'pointer' }}
          className="nodrag"
          onClick={() => onExit()}>
          {t('miniwindow.footer.esc', {
            action: route === 'home' ? t('miniwindow.footer.esc_close') : t('miniwindow.footer.esc_back')
          })}
        </Tag>
        {route === 'home' && !canUseBackspace && (
          <Tag
            bordered={false}
            icon={<ArrowLeftOutlined />}
            style={{ cursor: 'pointer' }}
            className="nodrag"
            onClick={() => clearClipboard!()}>
            {t('miniwindow.footer.backspace_clear')}
          </Tag>
        )}
        {route !== 'home' && (
          <Tag bordered={false} icon={<CopyOutlined />} style={{ cursor: 'pointer' }} className="nodrag">
            {t('miniwindow.footer.copy_last_message')}
          </Tag>
        )}
      </FooterText>
    </WindowFooter>
  )
}

const WindowFooter = styled.div`
  position: relative;
  width: 100%;
  text-align: center;
  padding: 5px 0;
  color: var(--color-text-secondary);
  font-size: 12px;
`

const FooterText = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: var(--color-text-secondary);
  font-size: 12px;
`

const PinButtonArea = styled.div`
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  cursor: pointer;
`

export default Footer
