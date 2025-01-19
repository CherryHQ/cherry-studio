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
    <WindowFooter onClick={() => onExit()}>
      <FooterText className="nodrag">
        {t('miniwindow.footer.esc', {
          action: route === 'home' ? t('miniwindow.footer.esc_close') : t('miniwindow.footer.esc_back')
        })}
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

const FooterText = styled.span`
  color: var(--color-text-secondary);
  font-size: 12px;
`

export default Footer
