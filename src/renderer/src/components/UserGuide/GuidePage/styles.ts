import styled from 'styled-components'

export const GuidePageContainer = styled.div`
  display: flex;
  width: 100vw;
  height: 100vh;
  background: var(--color-background);
  overflow: hidden;
  -webkit-app-region: drag;
  gap: 27px;
  padding: 0;
`

export const LeftPanel = styled.div`
  flex: 0 0 682px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 64px 10px;
  -webkit-app-region: no-drag;
`

export const LeftPanelContent = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
  padding: 0 32px;
  gap: 129px;
`

export const LogoContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

export const LogoImage = styled.img`
  width: 32px;
  height: 32px;
  border-radius: 8px;
`

export const LogoText = styled.span`
  font-size: 16px;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.9);
  line-height: 18px;

  body[theme-mode='dark'] & {
    color: rgba(255, 255, 255, 0.9);
  }
`

export const ContentSection = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 64px;
  padding: 32px;
  width: 100%;
`

export const SettingsWrapper = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
`

export const TitleSection = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  width: 100%;
`

export const WelcomeTitle = styled.h1`
  font-size: 32px;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.9);
  margin: 0;
  text-align: center;
  line-height: 22px;

  body[theme-mode='dark'] & {
    color: rgba(255, 255, 255, 0.9);
  }
`

export const WelcomeSubtitle = styled.p`
  font-size: 14px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.6);
  margin: 0;
  text-align: center;
  line-height: 16px;

  body[theme-mode='dark'] & {
    color: rgba(255, 255, 255, 0.6);
  }
`

export const SettingSection = styled.div`
  width: 100%;
`

export const SectionTitle = styled.h2`
  font-size: 14px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.9);
  margin: 0;
  padding: 8px;
  line-height: 16px;

  body[theme-mode='dark'] & {
    color: rgba(255, 255, 255, 0.9);
  }
`

export const NavStyleOptions = styled.div`
  display: flex;
  gap: 8px;
  justify-content: space-between;
  padding: 8px;
  width: 100%;
`

export const NavStyleOption = styled.div<{ $selected?: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid ${(props) => (props.$selected ? 'rgba(60, 212, 90, 0.8)' : 'transparent')};
  background: #f5f5f5;
  cursor: pointer;
  transition: all 0.2s ease;
  width: 216px;

  &:hover {
    border-color: ${(props) => (props.$selected ? 'rgba(60, 212, 90, 0.8)' : 'rgba(60, 212, 90, 0.4)')};
  }

  body[theme-mode='dark'] & {
    background: #2a2a2a;
  }
`

export const NavStylePreview = styled.div`
  width: 183px;
  height: 100px;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
`

export const NavStyleLabel = styled.span`
  font-size: 14px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.9);
  line-height: 16px;

  body[theme-mode='dark'] & {
    color: rgba(255, 255, 255, 0.9);
  }
`

export const LanguageSection = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 36px;
  padding: 8px;
`

export const LanguageLabel = styled.span`
  font-size: 14px;
  font-weight: 500;
  color: rgba(0, 0, 0, 0.9);
  line-height: 16px;

  body[theme-mode='dark'] & {
    color: rgba(255, 255, 255, 0.9);
  }
`

export const LanguageSelector = styled.div`
  height: 32px;
`

export const StartButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 300px;
  padding: 8px 16px;
  background: #3cd45a;
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 500;
  line-height: 24px;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: #35c052;
  }

  &:active {
    transform: scale(0.98);
  }
`

// Gradient definitions for each carousel slide
export const gradients = {
  assistants: 'linear-gradient(135deg, #a78bfa 0%, #f472b6 50%, #fb923c 100%)',
  paintings: 'linear-gradient(135deg, #fb923c 0%, #f472b6 50%, #a78bfa 100%)',
  models: 'linear-gradient(135deg, #60a5fa 0%, #a78bfa 50%, #f472b6 100%)'
}

export const RightPanel = styled.div<{ $gradient?: string }>`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  background: ${(props) => props.$gradient || gradients.assistants};
  border-top-left-radius: 24px;
  border-bottom-left-radius: 24px;
  position: relative;
  overflow: hidden;
  margin: 0;
  height: 100%;
`

export const FeatureContent = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 598px;
  z-index: 1;
`

export const FeatureTitle = styled.h2`
  font-size: 32px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  margin: 0 0 24px 0;
  line-height: 22px;
`

export const FeatureDescription = styled.p`
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.6);
  line-height: 16px;
  margin: 0;
`

export const FeatureImage = styled.div`
  width: 600px;
  height: 408px;
  margin-top: 24px;
  border-radius: 12px;
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
`

export const CarouselDots = styled.div`
  display: flex;
  gap: 8px;
  justify-content: center;
  position: absolute;
  bottom: 46px;
  left: 50%;
  transform: translateX(-50%);
`

export const CarouselDot = styled.button<{ $active?: boolean }>`
  width: 135px;
  height: ${(props) => (props.$active ? '6px' : '4px')};
  border-radius: 4px;
  border: none;
  background: #fafafa;
  opacity: ${(props) => (props.$active ? '0.5' : '0.2')};
  cursor: pointer;
  transition: all 0.2s ease;
  padding: 0;

  &:hover {
    opacity: 0.6;
  }
`
