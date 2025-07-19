import { useSettings } from '@renderer/hooks/useSettings'
import { FileSearch, Folder, Languages, LayoutGrid, Palette, Sparkle } from 'lucide-react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

const LaunchpadPage: FC = () => {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { defaultPaintingProvider } = useSettings()

  const appMenuItems = [
    {
      icon: <Sparkle size={32} className="icon" />,
      text: t('agents.title'),
      path: '/agents',
      bgColor: 'linear-gradient(135deg, #6366F1, #4F46E5)' // AI助手：靛蓝渐变，代表智能和科技
    },
    {
      icon: <Languages size={32} className="icon" />,
      text: t('translate.title'),
      path: '/translate',
      bgColor: 'linear-gradient(135deg, #06B6D4, #0EA5E9)' // 翻译：明亮的青蓝色，代表沟通和流畅
    },
    {
      icon: <Palette size={32} className="icon" />,
      text: t('paintings.title'),
      path: `/paintings/${defaultPaintingProvider}`,
      bgColor: 'linear-gradient(135deg, #EC4899, #F472B6)' // 绘画：活力粉色，代表创造力和艺术
    },
    {
      icon: <LayoutGrid size={32} className="icon" />,
      text: t('minapp.title'),
      path: '/apps',
      bgColor: 'linear-gradient(135deg, #8B5CF6, #A855F7)' // 小程序：紫色，代表多功能和灵活性
    },
    {
      icon: <FileSearch size={32} className="icon" />,
      text: t('knowledge.title'),
      path: '/knowledge',
      bgColor: 'linear-gradient(135deg, #10B981, #34D399)' // 知识库：翠绿色，代表生长和知识
    },
    {
      icon: <Folder size={32} className="icon" />,
      text: t('files.title'),
      path: '/files',
      bgColor: 'linear-gradient(135deg, #F59E0B, #FBBF24)' // 文件：金色，代表资源和重要性
    }
  ]

  return (
    <Container>
      <Grid>
        {appMenuItems.map((item) => (
          <AppIcon key={item.path} onClick={() => navigate(item.path)}>
            <IconWrapper bgColor={item.bgColor}>{item.icon}</IconWrapper>
            <AppName>{item.text}</AppName>
          </AppIcon>
        ))}
      </Grid>
    </Container>
  )
}

const Container = styled.div`
  width: 100%;
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: var(--color-background);
`

const Grid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 40px;
  padding: 40px;
  max-width: 800px;
`

const AppIcon = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  cursor: pointer;
  gap: 12px;
`

const IconWrapper = styled.div<{ bgColor: string }>`
  width: 64px;
  height: 64px;
  border-radius: 16px;
  background: ${(props) => props.bgColor};
  display: flex;
  justify-content: center;
  align-items: center;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);

  .icon {
    color: white;
  }
`

const AppName = styled.div`
  font-size: 14px;
  color: var(--color-text);
  text-align: center;
`

export default LaunchpadPage
