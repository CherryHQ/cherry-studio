import { PushpinOutlined } from '@ant-design/icons'
import { isMac } from '@renderer/config/constant'
import AntdProvider from '@renderer/context/AntdProvider'
import StyleSheetManager from '@renderer/context/StyleSheetManager'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
import { useSettings } from '@renderer/hooks/useSettings'
import store, { useAppDispatch } from '@renderer/store'
import { setCustomCss } from '@renderer/store/settings'
import { Input } from 'antd'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Provider } from 'react-redux'
import styled from 'styled-components'

// Wrap the main APP component with providers
function AppWrapper(): React.ReactElement {
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

function APP(): React.ReactElement {
  const { t } = useTranslation()
  const { customCss } = useSettings()
  const dispatch = useAppDispatch()
  const [isPinned, setIsPinned] = useState(false)

  const handlePinClick = async () => {
    const newPinnedState = await window.api.cssEditor.pin()
    setIsPinned(newPinnedState)
  }

  return (
    <Container>
      <NavbarContainer>
        <HeaderTitle>{t('settings.display.custom.css')}</HeaderTitle>
        <Controls>
          <PinButton onClick={handlePinClick} $isPinned={isPinned}>
            <PushpinOutlined />
          </PinButton>
        </Controls>
      </NavbarContainer>
      <Content>
        <Input.TextArea
          value={customCss}
          onChange={(e) => {
            dispatch(setCustomCss(e.target.value))
            window.api.setCustomCss(e.target.value)
          }}
          placeholder={t('settings.display.custom.css.placeholder')}
          style={{
            minHeight: 200,
            maxHeight: '100%',
            fontFamily: 'monospace'
          }}
        />
      </Content>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-background);
`

const NavbarContainer = styled.div`
  min-width: 100%;
  display: flex;
  flex-direction: row;
  min-height: var(--navbar-height);
  max-height: var(--navbar-height);
  padding-left: ${isMac ? 'calc(20px + var(--sidebar-width))' : '8px'};
  padding-right: ${isMac ? '8px' : '140px'};
  background-color: var(--navbar-background);
  -webkit-app-region: drag;
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

const Controls = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--color-text);
`

const Content = styled.div`
  flex: 1;
  height: fit-content;
  padding: 8px;
  background-color: var(--color-background);
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
