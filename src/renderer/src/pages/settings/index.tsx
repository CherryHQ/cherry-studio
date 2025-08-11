import { ThemeMode } from '@renderer/types'
import { Divider } from 'antd'
import Link from 'antd/es/typography/Link'
import styled, { CSSProp } from 'styled-components'

export const SettingContainer = styled.div<{ theme?: ThemeMode }>`
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: 10px;
  overflow-y: scroll;
  background: ${(props) => (props.theme === 'dark' ? 'transparent' : 'var(--color-background-soft)')};

  &::-webkit-scrollbar {
    display: none;
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
  border-radius: var(--list-item-border-radius);
  border: 0.5px solid var(--color-border);
  padding: 16px;
  background: ${(props) => (props.theme === 'dark' ? '#00000010' : 'var(--color-background)')};
`
