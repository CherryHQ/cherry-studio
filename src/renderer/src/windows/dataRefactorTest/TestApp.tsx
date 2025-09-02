import { AppLogo } from '@renderer/config/env'
import { usePreference } from '@renderer/data/hooks/usePreference'
import { loggerService } from '@renderer/services/LoggerService'
import { ThemeMode } from '@shared/data/preferenceTypes'
import { Button, Card, Col, Divider, Layout, Row, Space, Typography } from 'antd'
import { Database, FlaskConical, Settings, TestTube } from 'lucide-react'
import React from 'react'
import styled from 'styled-components'

import PreferenceBasicTests from './components/PreferenceBasicTests'
import PreferenceHookTests from './components/PreferenceHookTests'
import PreferenceMultipleTests from './components/PreferenceMultipleTests'
import PreferenceServiceTests from './components/PreferenceServiceTests'

const { Header, Content } = Layout
const { Title, Text } = Typography

const logger = loggerService.withContext('TestApp')

const TestApp: React.FC = () => {
  // Get window number from multiple sources
  const getWindowNumber = () => {
    // Try URL search params first
    const urlParams = new URLSearchParams(window.location.search)
    const windowParam = urlParams.get('window')
    if (windowParam) {
      return windowParam
    }

    // Try document title
    const windowTitle = document.title
    const windowMatch = windowTitle.match(/#(\d+)/)
    if (windowMatch) {
      return windowMatch[1]
    }

    // Try window name
    if (window.name && window.name.includes('#')) {
      const nameMatch = window.name.match(/#(\d+)/)
      if (nameMatch) {
        return nameMatch[1]
      }
    }

    // Fallback: generate based on window creation time
    return Math.floor(Date.now() / 1000) % 100
  }

  const windowNumber = getWindowNumber()

  // Add theme preference monitoring for UI changes
  const [theme, setTheme] = usePreference('ui.theme_mode')
  const [language] = usePreference('app.language')
  const [zoomFactor] = usePreference('app.zoom_factor')

  // Apply theme-based styling
  const isDarkTheme = theme === ThemeMode.dark
  const headerBg = isDarkTheme ? '#141414' : '#fff'
  const borderColor = isDarkTheme ? '#303030' : '#f0f0f0'
  const textColor = isDarkTheme ? '#fff' : '#000'

  // Apply zoom factor
  const zoomValue = typeof zoomFactor === 'number' ? zoomFactor : 1.0

  return (
    <Layout style={{ height: '100vh', transform: `scale(${zoomValue})`, transformOrigin: 'top left' }}>
      <Header
        style={{ background: headerBg, borderBottom: `1px solid ${borderColor}`, padding: '0 24px', color: textColor }}>
        <HeaderContent>
          <Space align="center">
            <img src={AppLogo} alt="Logo" style={{ width: 28, height: 28, borderRadius: 6 }} />
            <Title level={4} style={{ margin: 0, color: textColor }}>
              Test Window #{windowNumber} {isDarkTheme ? '🌙' : '☀️'}
            </Title>
          </Space>
          <Space>
            <FlaskConical size={20} color={isDarkTheme ? '#fff' : 'var(--color-primary)'} />
            <Text style={{ color: textColor }}>
              Cross-Window Sync Testing | {language || 'en-US'} | Zoom: {Math.round(zoomValue * 100)}%
            </Text>
          </Space>
        </HeaderContent>
      </Header>

      <Content style={{ padding: '24px', overflow: 'auto', backgroundColor: isDarkTheme ? '#000' : '#f5f5f5' }}>
        <Container>
          <Row gutter={[24, 24]}>
            {/* Introduction Card */}
            <Col span={24}>
              <Card style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <Space align="center">
                    <TestTube size={24} color="var(--color-primary)" />
                    <Title level={3} style={{ margin: 0, color: textColor }}>
                      PreferenceService 功能测试 (窗口 #{windowNumber})
                    </Title>
                  </Space>
                  <Text style={{ color: isDarkTheme ? '#d9d9d9' : 'rgba(0, 0, 0, 0.45)' }}>
                    此测试窗口用于验证 PreferenceService 和 usePreference hooks
                    的各项功能，包括单个偏好设置的读写、多个偏好设置的批量操作、跨窗口数据同步等。
                  </Text>
                  <Text style={{ color: isDarkTheme ? '#d9d9d9' : 'rgba(0, 0, 0, 0.45)' }}>
                    测试使用的都是真实的偏好设置系统，所有操作都会影响实际的数据库存储。
                  </Text>
                  <Text style={{ color: 'var(--color-primary)', fontWeight: 'bold' }}>
                    📋 跨窗口测试指南：在一个窗口中修改偏好设置，观察其他窗口是否实时同步更新。
                  </Text>
                </Space>
              </Card>
            </Col>

            {/* PreferenceService Basic Tests */}
            <Col span={24}>
              <Card
                title={
                  <Space>
                    <Database size={18} color={isDarkTheme ? '#fff' : '#000'} />
                    <span style={{ color: textColor }}>PreferenceService 基础测试</span>
                  </Space>
                }
                size="small"
                style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                <PreferenceServiceTests />
              </Card>
            </Col>

            {/* Basic Hook Tests */}
            <Col span={12}>
              <Card
                title={
                  <Space>
                    <Settings size={18} color={isDarkTheme ? '#fff' : '#000'} />
                    <span style={{ color: textColor }}>usePreference Hook 测试</span>
                  </Space>
                }
                size="small"
                style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                <PreferenceBasicTests />
              </Card>
            </Col>

            {/* Hook Tests */}
            <Col span={12}>
              <Card
                title={
                  <Space>
                    <Settings size={18} color={isDarkTheme ? '#fff' : '#000'} />
                    <span style={{ color: textColor }}>Hook 高级功能测试</span>
                  </Space>
                }
                size="small"
                style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                <PreferenceHookTests />
              </Card>
            </Col>

            {/* Multiple Preferences Tests */}
            <Col span={24}>
              <Card
                title={
                  <Space>
                    <Database size={18} color={isDarkTheme ? '#fff' : '#000'} />
                    <span style={{ color: textColor }}>usePreferences 批量操作测试</span>
                  </Space>
                }
                size="small"
                style={{ backgroundColor: isDarkTheme ? '#1f1f1f' : '#fff', borderColor: borderColor }}>
                <PreferenceMultipleTests />
              </Card>
            </Col>
          </Row>

          <Divider />

          <Row justify="center">
            <Space>
              <Button
                icon={isDarkTheme ? '☀️' : '🌙'}
                onClick={async () => {
                  await setTheme(isDarkTheme ? ThemeMode.light : ThemeMode.dark)
                }}
                style={{
                  backgroundColor: isDarkTheme ? '#434343' : '#f0f0f0',
                  borderColor: borderColor,
                  color: textColor
                }}>
                {isDarkTheme ? '切换到亮色主题' : '切换到暗色主题'}
              </Button>
              <Button
                type="primary"
                onClick={() => {
                  logger.info('Closing test window')
                  window.close()
                }}>
                关闭测试窗口
              </Button>
            </Space>
          </Row>
        </Container>
      </Content>
    </Layout>
  )
}

const HeaderContent = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 100%;
`

const Container = styled.div`
  max-width: 1200px;
  margin: 0 auto;
`

export default TestApp
