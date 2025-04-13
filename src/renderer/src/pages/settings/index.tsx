import { ThemeMode } from '@renderer/types'
import { Divider } from 'antd'
import Link from 'antd/es/typography/Link'
import styled, { CSSProp } from 'styled-components'

export const SettingContainer = styled.div<{ theme?: ThemeMode }>`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: calc(100vh - var(--navbar-height));
  height: auto;
  padding: 20px;
  padding-top: 15px;
  padding-bottom: 75px;
  overflow-y: auto; /* 改为auto，只在需要时显示滚动条 */
  font-family: Ubuntu;
  background: ${(props) => (props.theme === 'dark' ? 'transparent' : 'var(--color-background-soft)')};

  /* 添加滚动指示器 */
  &::after {
    content: '';
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    background-color: var(--color-primary);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
    background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>');
    background-repeat: no-repeat;
    background-position: center;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  }

  &.scrollable::after {
    opacity: 0.7;
  }

  &::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  &::-webkit-scrollbar-thumb {
    background: var(--color-border);
    border-radius: 5px;
    border: 2px solid transparent;
    background-clip: content-box;
  }

  &::-webkit-scrollbar-thumb:hover {
    background: var(--color-primary);
    border: 2px solid transparent;
    background-clip: content-box;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }
`

export const SettingTitle = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  user-select: none;
  font-size: 14px;
  font-weight: bold;
`

export const SettingSubtitle = styled.div`
  font-size: 14px;
  color: var(--color-text-1);
  margin: 15px 0 0 0;
  user-select: none;
  font-weight: bold;
`

export const SettingDescription = styled.div`
  font-size: 12px;
  color: var(--color-text-3);
  margin-top: 10px;
`

export const SettingDivider = styled(Divider)`
  margin: 10px 0;
  border-block-start: 0.5px solid var(--color-border);
`

export const SettingRow = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  min-height: 24px;
`

export const SettingRowTitle = styled.div`
  font-size: 14px;
  line-height: 18px;
  color: var(--color-text-1);
  display: flex;
  flex-direction: row;
  align-items: center;
`

export const SettingHelpTextRow = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  padding: 5px 0;
`

export const SettingHelpText = styled.div`
  font-size: 11px;
  color: var(--color-text);
  opacity: 0.4;
`

export const SettingHelpLink = styled(Link)`
  font-size: 11px;
  margin: 0 5px;
`

export const SettingGroup = styled.div<{ theme?: ThemeMode; css?: CSSProp }>`
  margin-bottom: 20px;
  border-radius: 8px;
  border: 0.5px solid var(--color-border);
  padding: 16px;
  background: ${(props) => (props.theme === 'dark' ? '#00000010' : 'var(--color-background)')};
`
