import styled from 'styled-components'

export interface ModalContainerProps {
  $backgroundImage?: string
}

export const ModalOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
  animation: fadeIn 0.2s ease;

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`

export const ModalContainer = styled.div<ModalContainerProps>`
  background: var(--color-background);
  background-image: ${({ $backgroundImage }) => ($backgroundImage ? `url(${$backgroundImage})` : 'none')};
  background-size: cover;
  background-position: center;
  border-radius: 24px;
  width: 520px;
  max-width: 90vw;
  max-height: 90vh;
  overflow: hidden;
  box-shadow: 0px 8px 40px rgba(0, 0, 0, 0.2);
  animation: slideUp 0.3s ease;

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`

export const ModalHeader = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 32px 32px 20px;
  text-align: center;
`

export const CherryImage = styled.img`
  width: 160px;
  height: auto;
  margin-bottom: 16px;
`

export const ModalTitle = styled.h2`
  font-size: 22px;
  font-weight: 700;
  color: var(--color-text);
  margin: 0 0 8px 0;
`

export const ModalSubtitle = styled.p`
  font-size: 14px;
  color: var(--color-text-2);
  margin: 0;
`

export const AssistantsSection = styled.div`
  padding: 0 24px 20px;
`

export const AssistantsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
`

export const AssistantCardContainer = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid var(--color-border);
  background: var(--color-background);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    border-color: var(--color-primary);
    background: var(--color-background-soft);

    .chat-button {
      opacity: 1;
      transform: translateY(0);
    }
  }
`

export const AssistantIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: var(--color-background-soft);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  flex-shrink: 0;
`

export const AssistantInfo = styled.div`
  flex: 1;
  min-width: 0;
`

export const AssistantName = styled.div`
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

export const AssistantDescription = styled.div`
  font-size: 11px;
  color: var(--color-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-top: 2px;
`

export const ChatButton = styled.button`
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%) translateY(4px);
  opacity: 0;
  padding: 4px 10px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;

  &:hover {
    background: var(--color-primary-hover, #35c052);
  }
`

export const ModalFooter = styled.div`
  display: flex;
  justify-content: center;
  padding: 0 24px 24px;
`

export const ExploreButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 12px 20px;
  background: var(--color-primary);
  color: var(--color-white);
  border: none;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    opacity: 0.9;
  }
`
