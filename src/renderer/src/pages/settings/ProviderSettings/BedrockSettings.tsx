import { InfoCircleOutlined } from '@ant-design/icons'
import { useAppDispatch } from '@renderer/store'
import { setBedrockApikey } from '@renderer/store/llm'
import { Input, Select, Switch, Tooltip } from 'antd'
import { FC, useEffect, useState } from 'react'

import { SettingHelpText, SettingRow, SettingRowTitle } from '..'

const REGIONS = [
  { label: 'US East (N. Virginia)', value: 'us-east-1' },
  { label: 'US East (Ohio)', value: 'us-east-2' },
  { label: 'US West (N. California)', value: 'us-west-1' },
  { label: 'US West (Oregon)', value: 'us-west-2' },
  { label: 'Canada (Central)', value: 'ca-central-1' },
  { label: 'Canada (West)', value: 'ca-west-1' },
  { label: 'Europe (Ireland)', value: 'eu-west-1' },
  { label: 'Europe (London)', value: 'eu-west-2' },
  { label: 'Europe (Frankfurt)', value: 'eu-central-1' },
  { label: 'Europe (Paris)', value: 'eu-west-3' },
  { label: 'Europe (Stockholm)', value: 'eu-north-1' },
  { label: 'Europe (Milan)', value: 'eu-south-1' },
  { label: 'Europe (Spain)', value: 'eu-south-2' },
  { label: 'Europe (Zurich)', value: 'eu-central-2' },
  { label: 'Asia Pacific (Tokyo)', value: 'ap-northeast-1' },
  { label: 'Asia Pacific (Seoul)', value: 'ap-northeast-2' },
  { label: 'Asia Pacific (Osaka)', value: 'ap-northeast-3' },
  { label: 'Asia Pacific (Singapore)', value: 'ap-southeast-1' },
  { label: 'Asia Pacific (Sydney)', value: 'ap-southeast-2' },
  { label: 'Asia Pacific (Jakarta)', value: 'ap-southeast-3' },
  { label: 'Asia Pacific (Hong Kong)', value: 'ap-east-1' },
  { label: 'Asia Pacific (Mumbai)', value: 'ap-south-1' },
  { label: 'Asia Pacific (Hyderabad)', value: 'ap-south-2' },
  { label: 'Asia Pacific (Melbourne)', value: 'ap-southeast-4' },
  { label: 'South America (São Paulo)', value: 'sa-east-1' },
  { label: 'Middle East (Bahrain)', value: 'me-south-1' },
  { label: 'Middle East (UAE)', value: 'me-central-1' },
  { label: 'Africa (Cape Town)', value: 'af-south-1' },
  { label: 'Israel (Tel Aviv)', value: 'il-central-1' },
  { label: 'Asia Pacific (Malaysia)', value: 'ap-southeast-5' },
  { label: 'Asia Pacific (Thailand)', value: 'ap-southeast-7' },
  { label: 'Mexico (Central)', value: 'mx-central-1' }
]

interface Props {
  settings: {
    region: string
    accessKeyId: string
    secretAccessKey: string
    crossRegion?: boolean
  }
  onUpdate: (settings: any) => void
}

interface UpdateSettings {
  region?: string
  accessKeyId?: string
  secretAccessKey?: string
  crossRegion?: boolean
  apiHost?: string
}

const BedrockSettings: FC<Props> = ({ settings, onUpdate }) => {
  const dispatch = useAppDispatch()
  const [region, setRegion] = useState(settings.region || 'us-east-1')
  // set cross region is true
  const [crossRegion, setCrossRegion] = useState(true)
  const [accessKeyId, setAccessKeyId] = useState(settings.accessKeyId || '')
  const [secretAccessKey, setSecretAccessKey] = useState(settings.secretAccessKey || '')
  const [apiHost, setApiHost] = useState(`https://bedrock-runtime.${settings.region || 'us-east-1'}.amazonaws.com`)

  // 当 region 变化时更新 apiHost
  useEffect(() => {
    setApiHost(`https://bedrock-runtime.${region}.amazonaws.com`)
  }, [region])

  // 初始化时确保 crossRegion 为 true
  useEffect(() => {
    if (!crossRegion) {
      setCrossRegion(true)
      handleUpdate({ crossRegion: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleUpdate = (newSettings: UpdateSettings) => {
    const updatedSettings = {
      accessKeyId: newSettings.accessKeyId || accessKeyId,
      secretAccessKey: newSettings.secretAccessKey || secretAccessKey,
      region: newSettings.region || region,
      crossRegion: typeof newSettings.crossRegion !== 'undefined' ? newSettings.crossRegion : crossRegion
    }
    dispatch(setBedrockApikey(updatedSettings))
    // 确保始终包含 region 信息
    const regionValue = updatedSettings.region || 'us-east-1'

    const apiKeyParts = [
      updatedSettings.accessKeyId.trim(),
      updatedSettings.secretAccessKey.trim(),
      regionValue.trim(),
      `${crossRegion}`
    ]
    const apiKey = apiKeyParts.join(',')
    console.log('[BedrockSettings] apiKey', apiKey)
    onUpdate?.({
      apiKey,
      apiHost: `https://bedrock-runtime.${updatedSettings.region}.amazonaws.com`
    })
  }

  return (
    <>
      <SettingRow>
        <SettingRowTitle>Access Key ID</SettingRowTitle>
        <Input
          value={accessKeyId}
          onChange={(e) => setAccessKeyId(e.target.value)}
          onBlur={() => handleUpdate({ accessKeyId })}
          style={{ width: 400 }}
        />
      </SettingRow>

      <SettingRow style={{ marginTop: 10 }}>
        <SettingRowTitle>Secret Access Key</SettingRowTitle>
        <Input.Password
          value={secretAccessKey}
          onChange={(e) => setSecretAccessKey(e.target.value)}
          onBlur={() => handleUpdate({ secretAccessKey })}
          style={{ width: 400 }}
        />
      </SettingRow>

      <SettingRow style={{ marginTop: 10 }}>
        <SettingRowTitle>
          Region
          <Tooltip title="Select the AWS region where your Bedrock models are deployed">
            <InfoCircleOutlined style={{ marginLeft: 5 }} />
          </Tooltip>
        </SettingRowTitle>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', gap: '10px' }}>
            <Select
              value={region}
              onChange={(value) => {
                setRegion(value)
                // 强制更新所有设置，确保 region 被更新
                handleUpdate({
                  region: value,
                  accessKeyId,
                  secretAccessKey,
                  crossRegion
                })
              }}
              style={{ width: 200 }}
              options={REGIONS}
            />
          </div>
        </div>
      </SettingRow>

      <SettingRow style={{ marginTop: 10 }}>
        <SettingRowTitle>API Host</SettingRowTitle>
        <Input value={apiHost} disabled={true} style={{ width: 400 }} />
      </SettingRow>

      <SettingRow style={{ marginTop: 10 }}>
        <SettingRowTitle>
          Cross Region Access
          <Tooltip title="Enable to access models in different regions">
            <InfoCircleOutlined style={{ marginLeft: 5 }} />
          </Tooltip>
        </SettingRowTitle>
        <Switch
          checked={crossRegion}
          onChange={(checked) => {
            setCrossRegion(checked)
            handleUpdate({ crossRegion: checked })
          }}
        />
      </SettingRow>

      <SettingHelpText style={{ marginTop: 10 }}>
        Make sure you have enabled the Bedrock service in your AWS account and have the necessary permissions.
      </SettingHelpText>

      <SettingHelpText style={{ marginTop: 5 }}>
        Note: Cross Region Access is enabled by default. Model IDs will be prefixed with &ldquo;us.&rdquo; (e.g.,
        us.anthropic.claude-3-sonnet-20240229-v1:0)
      </SettingHelpText>
    </>
  )
}

export default BedrockSettings
