import { PushpinOutlined } from '@ant-design/icons'
import { isMac } from '@renderer/config/constant'
import AntdProvider from '@renderer/context/AntdProvider'
import StyleSheetManager from '@renderer/context/StyleSheetManager'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
import useNavBackgroundColor from '@renderer/hooks/useNavBackgroundColor'
import store from '@renderer/store'
import { Input } from 'antd'
import { type FC, type PropsWithChildren, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Provider } from 'react-redux'
import styled from 'styled-components'

// Wrap the main APP component with providers
function AppWrapper(): JSX.Element {
  return (
    <Provider store={store}>
      <StyleSheetManager>
        <ThemeProvider>
          <AntdProvider>
            <APP />
          </AntdProvider>
        </ThemeProvider>
      </StyleSheetManager>
    </Provider>
  )
}

function APP(): JSX.Element {
  const { t } = useTranslation()
  //const { customCss } = useSettings()
  const [css, setCss] = useState('')
  const [isPinned, setIsPinned] = useState(false)

  const handleCssChange = (value: string) => {
    setCss(value)
    window.api.cssEditor.update(value)
  }

  const handlePinClick = async () => {
    const newPinnedState = await window.api.cssEditor.togglePin()
    setIsPinned(newPinnedState)
  }

  return (
    <Container>
      <Navbar>
        <NavbarLeft>
          <HeaderTitle>{t('settings.display.custom.css')}</HeaderTitle>
          <PinButton onClick={handlePinClick} $isPinned={isPinned}>
            <PushpinOutlined />
          </PinButton>
        </NavbarLeft>
      </Navbar>
      <Content>
        <Input.TextArea
          value={css}
          onChange={(e) => handleCssChange(e.target.value)}
          placeholder={t('settings.display.custom.css.placeholder')}
          style={{
            height: '100%',
            minHeight: 200,
            fontFamily: 'monospace'
          }}
        />
      </Content>
    </Container>
  )
}

type Props = PropsWithChildren & JSX.IntrinsicElements['div']
export const Navbar: FC<Props> = ({ children, ...props }) => {
  const backgroundColor = useNavBackgroundColor()

  return (
    <NavbarContainer {...props} style={{ backgroundColor }}>
      {children}
    </NavbarContainer>
  )
}

export const NavbarLeft: FC<Props> = ({ children, ...props }) => {
  return <NavbarLeftContainer {...props}>{children}</NavbarLeftContainer>
}

const NavbarContainer = styled.div`
  min-width: 100%;
  display: flex;
  flex-direction: row;
  justify-content: ${isMac ? 'flex-end' : 'flex-start'};
  min-height: var(--navbar-height);
  max-height: var(--navbar-height);
  margin-left: ${isMac ? 'calc(var(--sidebar-width) * -1)' : 0};
  padding-left: ${isMac ? 'var(--sidebar-width)' : 0};
  -webkit-app-region: drag;
`

const NavbarLeftContainer = styled.div`
  min-width: var(--assistants-width);
  padding: 0 10px;
  display: flex;
  flex-direction: row;
  align-items: center;
  font-weight: bold;
  color: var(--color-text-1);
`

const Container = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-background);
`

const HeaderTitle = styled.div`
  flex: 1;
  font-size: 14px;
  font-weight: bold;
  color: var(--color-text);
  display: flex;
  align-items: center;
  justify-content: left;
`

const Content = styled.div`
  flex: 1;
  padding: 8px;
  overflow-y: auto;
`

const PinButton = styled.div<{ $isPinned: boolean }>`
  -webkit-app-region: no-drag;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  color: var(--color-text);
  opacity: ${(props) => (props.$isPinned ? 1 : 0.6)};
  transform: ${(props) => (props.$isPinned ? 'rotate(-45deg)' : 'none')};
`

export default AppWrapper
