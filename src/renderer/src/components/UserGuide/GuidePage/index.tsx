import logoImage from '@renderer/assets/images/logo.png'
import Selector from '@renderer/components/Selector'
import i18n from '@renderer/i18n'
import { useAppDispatch } from '@renderer/store'
import { completeGuidePage } from '@renderer/store/onboarding'
import { setLanguage, setNavbarPosition } from '@renderer/store/settings'
import type { LanguageVarious } from '@renderer/types'
import { Flex } from 'antd'
import type { FC } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import FeatureCarousel from './FeatureCarousel'
import NavStyleSelector from './NavStyleSelector'
import {
  ContentSection,
  GuidePageContainer,
  LanguageLabel,
  LanguageSection,
  LanguageSelector,
  LeftPanel,
  LeftPanelContent,
  LogoContainer,
  LogoImage,
  LogoText,
  SectionTitle,
  SettingSection,
  SettingsWrapper,
  StartButton,
  TitleSection,
  WelcomeSubtitle,
  WelcomeTitle
} from './styles'

const languagesOptions: { value: LanguageVarious; label: string; flag: string }[] = [
  { value: 'zh-CN', label: '中文', flag: '🇨🇳' },
  { value: 'zh-TW', label: '中文（繁体）', flag: '🇭🇰' },
  { value: 'en-US', label: 'English', flag: '🇺🇸' },
  { value: 'de-DE', label: 'Deutsch', flag: '🇩🇪' },
  { value: 'ja-JP', label: '日本語', flag: '🇯🇵' },
  { value: 'ru-RU', label: 'Русский', flag: '🇷🇺' },
  { value: 'el-GR', label: 'Ελληνικά', flag: '🇬🇷' },
  { value: 'es-ES', label: 'Español', flag: '🇪🇸' },
  { value: 'fr-FR', label: 'Français', flag: '🇫🇷' },
  { value: 'pt-PT', label: 'Português', flag: '🇵🇹' },
  { value: 'ro-RO', label: 'Română', flag: '🇷🇴' }
]

const GuidePage: FC = () => {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()

  const [navStyle, setNavStyle] = useState<'left' | 'top'>('top')
  const [language, setLanguageState] = useState<LanguageVarious>(
    (localStorage.getItem('language') as LanguageVarious) || (navigator.language as LanguageVarious) || 'en-US'
  )

  const handleLanguageChange = (value: LanguageVarious) => {
    setLanguageState(value)
    dispatch(setLanguage(value))
    localStorage.setItem('language', value)
    window.api.setLanguage(value)
    i18n.changeLanguage(value)
  }

  const handleStart = () => {
    dispatch(setNavbarPosition(navStyle))
    dispatch(completeGuidePage())
    navigate('/')
  }

  return (
    <GuidePageContainer>
      <LeftPanel>
        <LeftPanelContent>
          <LogoContainer>
            <LogoImage src={logoImage} alt="Cherry Studio" />
            <LogoText>Cherry Studio</LogoText>
          </LogoContainer>

          <ContentSection>
            <SettingsWrapper>
              <TitleSection>
                <WelcomeTitle>{t('userGuide.guidePage.welcome.title')}</WelcomeTitle>
                <WelcomeSubtitle>{t('userGuide.guidePage.welcome.subtitle')}</WelcomeSubtitle>
              </TitleSection>

              <SettingSection>
                <SectionTitle>{t('userGuide.guidePage.navStyle.title')}</SectionTitle>
                <NavStyleSelector value={navStyle} onChange={setNavStyle} />
              </SettingSection>

              <LanguageSection>
                <LanguageLabel>{t('common.language')}</LanguageLabel>
                <LanguageSelector>
                  <Selector
                    size={14}
                    value={language}
                    onChange={handleLanguageChange}
                    options={languagesOptions.map((lang) => ({
                      label: (
                        <Flex align="center" gap={8}>
                          <span role="img" aria-label={lang.flag}>
                            {lang.flag}
                          </span>
                          {lang.label}
                        </Flex>
                      ),
                      value: lang.value
                    }))}
                  />
                </LanguageSelector>
              </LanguageSection>
            </SettingsWrapper>

            <StartButton onClick={handleStart}>{t('userGuide.guidePage.startButton')}</StartButton>
          </ContentSection>
        </LeftPanelContent>
      </LeftPanel>
      <FeatureCarousel />
    </GuidePageContainer>
  )
}

export default GuidePage
