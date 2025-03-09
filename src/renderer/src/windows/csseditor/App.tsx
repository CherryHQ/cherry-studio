import { CloseOutlined, PushpinOutlined } from '@ant-design/icons'
import { Input } from 'antd'
import AntdProvider from '@renderer/context/AntdProvider'
import StyleSheetManager from '@renderer/context/StyleSheetManager'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
import { Provider } from 'react-redux'
import store from '@renderer/store'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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

    const handleClose = () => {
        window.api.cssEditor.close()
    }

    const handlePinClick = async () => {
        const newPinnedState = await window.api.cssEditor.togglePin()
        setIsPinned(newPinnedState)
    }

    return (
        <Container>
            <Header>
                <HeaderTitle>{t('settings.display.custom.css')}</HeaderTitle>
                <Controls>
                    <PinButton onClick={handlePinClick} $isPinned={isPinned}>
                        <PushpinOutlined />
                    </PinButton>
                    <CloseButton onClick={handleClose}>
                        <CloseOutlined />
                    </CloseButton>
                </Controls>
            </Header>
            <Content>
                <Input.TextArea
                    value={css}
                    onChange={(e) => handleCssChange(e.target.value)}
                    placeholder={t('settings.display.custom.css.placeholder')}
                    style={{
                        height: '100%',
                        minHeight: 200,
                        fontFamily: 'monospace',
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

const Header = styled.div`
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    -webkit-app-region: drag;
    background: var(--color-bg-1);
    border-bottom: 1px solid var(--color-border);
`

const HeaderTitle = styled.div`
    font-size: 14px;
    font-weight: 500;
    color: var(--color-text);
`

const Content = styled.div`
    flex: 1;
    padding: 8px;
    overflow-y: auto;
`

const Controls = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
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
    opacity: ${props => props.$isPinned ? 1 : 0.6};
    transform: ${props => props.$isPinned ? 'rotate(-45deg)' : 'none'};
`
const CloseButton = styled.div`
    -webkit-app-region: no-drag;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    color: var(--color-text);
    
    &:hover {
        background: var(--color-hover);
    }
`

export default AppWrapper