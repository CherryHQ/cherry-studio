import styled, { css, keyframes } from 'styled-components'

/**
 * 拖拽上下文菜单样式组件
 */

// 动画定义
const fadeInUp = keyframes`
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`

const fadeOut = keyframes`
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(10px);
  }
`

/**
 * 菜单容器
 */
export const MenuContainer = styled.div<{ $visible: boolean }>`
  position: fixed;
  z-index: 2000;
  background: var(--color-bg-base);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow:
    0 6px 16px rgba(0, 0, 0, 0.12),
    0 3px 6px rgba(0, 0, 0, 0.08);
  overflow: hidden;
  min-width: 280px;
  max-width: 320px;
  max-height: 400px;

  ${(props) =>
    props.$visible
      ? css`
          animation: ${fadeInUp} 0.15s ease-out;
        `
      : css`
          animation: ${fadeOut} 0.15s ease-out;
          pointer-events: none;
        `}

  /* 响应式调整 */
  @media (max-width: 480px) {
    min-width: 240px;
    max-width: 280px;
  }
`

/**
 * 菜单组标题
 */
export const MenuGroupTitle = styled.div`
  padding: 8px 16px 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--color-text-3);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: none;

  &:not(:first-child) {
    margin-top: 8px;
    padding-top: 12px;
    border-top: 1px solid var(--color-border-secondary);
  }
`

/**
 * 菜单项容器
 */
export const MenuGroup = styled.div`
  padding: 4px 0;

  &:not(:last-child) {
    border-bottom: 1px solid var(--color-border-secondary);
  }
`

/**
 * 菜单项
 */
export const MenuItem = styled.button<{ $danger?: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border: none;
  background: transparent;
  color: var(--color-text);
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s ease;
  gap: 12px;

  ${(props) =>
    props.$danger &&
    css`
      color: var(--color-error);

      &:hover {
        background: var(--color-error-bg);
        color: var(--color-error);
      }
    `}

  &:hover {
    background: var(--color-hover);
  }

  &:focus {
    outline: none;
    background: var(--color-primary-bg);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;

    &:hover {
      background: transparent;
    }
  }
`

/**
 * 菜单项图标
 */
export const MenuItemIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
`

/**
 * 菜单项标签
 */
export const MenuItemLabel = styled.span`
  flex: 1;
  font-weight: 400;
`

/**
 * 菜单项快捷键
 */
export const MenuItemShortcut = styled.span`
  font-size: 12px;
  color: var(--color-text-3);
  font-family: var(--font-mono);
  margin-left: auto;
`

/**
 * 拖拽手柄容器样式
 */
export const DragHandleContainer = styled.div<{ $visible: boolean }>`
  display: flex;
  align-items: center;
  gap: 0.25rem;
  opacity: ${(props) => (props.$visible ? 1 : 0)};
  transition: opacity 0.15s ease;
  position: absolute;
  left: -60px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
  padding: 2px;
`

/**
 * 手柄按钮基础样式
 */
const handleButtonBase = css`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 0.25rem;
  border: none;
  background: var(--color-background);
  color: var(--color-text-3);
  cursor: pointer;
  transition: background 0.15s ease;
  padding: 0;

  &:hover {
    background: var(--color-hover);
  }

  &:focus {
    outline: none;
    background: var(--color-primary-bg);
  }
`

/**
 * 加号按钮
 */
export const PlusButton = styled.button`
  ${handleButtonBase}
`

/**
 * 拖拽手柄
 */
export const DragHandleButton = styled.div`
  ${handleButtonBase}
  cursor: grab;

  &:active {
    cursor: grabbing;
  }

  &[draggable='true'] {
    user-select: none;
  }
`

/**
 * 加载状态指示器
 */
export const LoadingIndicator = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  color: var(--color-text-3);
  font-size: 14px;
`

/**
 * 错误状态显示
 */
export const ErrorMessage = styled.div`
  padding: 12px 16px;
  color: var(--color-error);
  background: var(--color-error-bg);
  border-radius: 4px;
  margin: 8px;
  font-size: 14px;
  text-align: center;
`

/**
 * 空状态显示
 */
export const EmptyState = styled.div`
  padding: 24px 16px;
  text-align: center;
  color: var(--color-text-3);
  font-size: 14px;
`

/**
 * 分隔线
 */
export const MenuDivider = styled.hr`
  border: none;
  border-top: 1px solid var(--color-border-secondary);
  margin: 4px 0;
`
