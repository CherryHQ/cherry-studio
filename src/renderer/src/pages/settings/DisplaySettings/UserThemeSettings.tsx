import { PlusOutlined } from '@ant-design/icons'
import { useSettings } from '@renderer/hooks/useSettings'
import useUserTheme from '@renderer/hooks/useUserTheme'
import ImageStorage from '@renderer/services/ImageStorage'
import { ThemeMode } from '@renderer/types'
import { Image, Segmented, Slider, Tooltip, Upload } from 'antd'
import { Info } from 'lucide-react'
import { FC } from 'react'

import { SettingDivider, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '..'

const UserThemeSettings: FC = () => {
  const { theme, userTheme } = useSettings()
  const { setUserTheme } = useUserTheme()

  const handleBackgroundImageChange = async (file: File) => {
    await ImageStorage.set('background', file)
    const backgroundImage = await ImageStorage.get('background')
    if (backgroundImage) {
      setUserTheme({
        ...userTheme,
        backgroundImage: backgroundImage
      })
    }
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>主题设置</SettingTitle>
      <SettingDivider />
      <SettingRow>
        <SettingRowTitle>背景设置</SettingRowTitle>
        <Segmented
          value={userTheme.backgroundType}
          shape="round"
          onChange={(value) => setUserTheme({ ...userTheme, backgroundType: value as 'opacity' | 'image' | 'none' })}
          options={[
            { value: 'opacity', label: '透明' },
            { value: 'image', label: '背景图' },
            { value: 'none', label: '无' }
          ]}
        />
      </SettingRow>
      {userTheme.backgroundType === 'image' && (
        <>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>上传背景图</SettingRowTitle>
            <Upload
              maxCount={1}
              name="background"
              listType="picture-card"
              showUploadList={false}
              customRequest={({ file }) => handleBackgroundImageChange(file as File)}
              accept="image/*">
              {userTheme.backgroundImage ? (
                <Image preview={false} src={decodeURIComponent(userTheme.backgroundImage)} />
              ) : (
                <PlusOutlined />
              )}
            </Upload>
          </SettingRow>
          <SettingDivider />
          <SettingRow>
            <SettingRowTitle>背景模糊</SettingRowTitle>
            <Slider
              style={{ width: '200px' }}
              min={0}
              max={100}
              value={userTheme.backgroundBlur}
              onChange={(value) => setUserTheme({ ...userTheme, backgroundBlur: value })}
            />
          </SettingRow>
          {theme === ThemeMode.dark && (
            <>
              <SettingDivider />
              <SettingRow>
                <SettingRowTitle>
                  背景亮度
                  <Tooltip title="仅限深色主题" placement="right">
                    <Info size={16} color="var(--color-icon)" style={{ marginLeft: 5, cursor: 'pointer' }} />
                  </Tooltip>
                </SettingRowTitle>
                <Slider
                  style={{ width: '200px' }}
                  min={0}
                  max={100}
                  value={userTheme.backgroundBrightness}
                  onChange={(value) => setUserTheme({ ...userTheme, backgroundBrightness: value })}
                />
              </SettingRow>
            </>
          )}
        </>
      )}
    </SettingGroup>
  )
}

export default UserThemeSettings
