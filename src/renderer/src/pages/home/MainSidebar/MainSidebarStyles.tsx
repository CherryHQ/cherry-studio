import Scrollbar from '@renderer/components/Scrollbar'
import styled from 'styled-components'

export const MainMenuItem = styled.div<{ active?: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 5px;
  background-color: ${({ active }) => (active ? 'var(--color-list-item)' : 'transparent')};
  padding: 5px 10px;
  border-radius: 5px;
  border-radius: 8px;
  opacity: ${({ active }) => (active ? 0.6 : 1)};
  &.active {
    background-color: var(--color-list-item);
  }
  &:hover {
    background-color: ${({ active }) => (active ? 'var(--color-list-item)' : 'var(--color-list-item-hover)')};
  }
`

export const MainMenuItemLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`

export const MainMenuItemRight = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  margin-right: -3px;
`

export const MainMenuItemIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
`

export const MainMenuItemText = styled.div`
  font-size: 14px;
  font-weight: 500;
`

export const Container = styled.div<{ transparent?: boolean }>`
  display: flex;
  flex-direction: column;
  flex: 1;
  width: var(--assistants-width);
  max-width: var(--assistants-width);
  border-right: 0.5px solid var(--color-border);
  height: var(--main-height);
  min-height: var(--main-height);
  background: var(--color-background);
  padding-top: 10px;
`

export const MainMenu = styled.div`
  display: flex;
  flex-direction: column;
  padding: 0 10px;
`

export const SubMenu = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
  overflow: hidden;
  padding: 5px 0;
`

export const TabsContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  -webkit-app-region: none;
  position: relative;
  width: 100%;
  margin-top: 5px;

  &::-webkit-scrollbar {
    display: none;
  }
`

export const TabsWrapper = styled(Scrollbar as any)`
  width: 100%;
  max-height: 50vh;
`

export const Menus = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
`
