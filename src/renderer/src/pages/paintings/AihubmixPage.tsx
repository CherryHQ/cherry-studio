import { RedoOutlined } from '@ant-design/icons'
import { InfoTooltip, RowFlex, Switch } from '@cherrystudio/ui'
import { resolveProviderIcon } from '@cherrystudio/ui/icons'
import { loggerService } from '@logger'
import IcImageUp from '@renderer/assets/images/paintings/ic_ImageUp.svg'
import { useTheme } from '@renderer/context/ThemeProvider'
import { usePaintings } from '@renderer/hooks/usePaintings'
import { useAllProviders } from '@renderer/hooks/useProvider'
import FileManager from '@renderer/services/FileManager'
import type { FileMetadata } from '@renderer/types'
import type { PaintingAction, PaintingsState } from '@renderer/types'
import { getErrorMessage, uuid } from '@renderer/utils'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { Input, InputNumber, Radio, Segmented, Select, Slider, Upload } from 'antd'
import TextArea from 'antd/es/input/TextArea'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingHelpLink, SettingTitle } from '../settings'
import Artboard from './components/Artboard'
import PaintingPageShell from './components/PaintingPageShell'
import PaintingPromptBar from './components/PaintingPromptBar'
import PaintingsList from './components/PaintingsList'
import ProviderSelect from './components/ProviderSelect'
import { usePaintingGenerationTask } from './hooks/usePaintingGenerationTask'
import { usePaintingPromptTranslation } from './hooks/usePaintingPromptTranslation'
import { type AihubmixMode, type ConfigItem, createModeConfigs, DEFAULT_PAINTING } from './providers/aihubmix/config'
import { generateAihubmixImages } from './providers/aihubmix/provider'
import { checkProviderEnabled } from './utils'
import { saveGeneratedPaintingFiles, savePaintingGenerationResult } from './utils/imageFiles'

const logger = loggerService.withContext('AihubmixPage')

// 使用函数创建配置项
const modeConfigs = createModeConfigs()

const AihubmixPage: FC<{ Options: string[] }> = ({ Options }) => {
  const [mode, setMode] = useState<keyof PaintingsState>('aihubmix_image_generate')
  const {
    addPainting,
    removePainting,
    updatePainting,
    aihubmix_image_generate,
    aihubmix_image_remix,
    aihubmix_image_edit,
    aihubmix_image_upscale
  } = usePaintings()

  const paintings = useMemo(() => {
    return {
      aihubmix_image_generate,
      aihubmix_image_remix,
      aihubmix_image_edit,
      aihubmix_image_upscale
    }
  }, [aihubmix_image_generate, aihubmix_image_remix, aihubmix_image_edit, aihubmix_image_upscale])

  const filteredPaintings = useMemo(() => paintings[mode] || [], [paintings, mode])
  const [painting, setPainting] = useState<PaintingAction>(filteredPaintings[0] || DEFAULT_PAINTING)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [fileMap, setFileMap] = useState<{ [key: string]: FileMetadata }>({})

  const { t } = useTranslation()
  const { theme } = useTheme()
  const providers = useAllProviders()
  const navigate = useNavigate()
  const location = useLocation()
  const aihubmixProvider = providers.find((p) => p.id === 'aihubmix')!

  const modeOptions = [
    { label: t('paintings.mode.generate'), value: 'aihubmix_image_generate' },
    { label: t('paintings.mode.remix'), value: 'aihubmix_image_remix' },
    { label: t('paintings.mode.upscale'), value: 'aihubmix_image_upscale' }
  ]

  const getNewPainting = useCallback(() => {
    return {
      ...DEFAULT_PAINTING,
      model: mode === 'aihubmix_image_generate' ? 'gemini-3-pro-image-preview' : 'V_3',
      id: uuid()
    }
  }, [mode])

  const textareaRef = useRef<any>(null)

  const updatePaintingState = (updates: Partial<PaintingAction>) => {
    const updatedPainting = { ...painting, ...updates }
    setPainting(updatedPainting)
    updatePainting(mode, updatedPainting)
  }

  const handleError = (error: unknown) => {
    if (error instanceof Error && error.name !== 'AbortError') {
      window.modal.error({
        content: getErrorMessage(error),
        centered: true
      })
    }
  }
  const { isLoading, setIsLoading, generating, runGeneration, cancelGeneration } = usePaintingGenerationTask({
    onError: handleError
  })

  const onGenerate = async () => {
    await checkProviderEnabled(aihubmixProvider, t)

    if (painting.files.length > 0) {
      const confirmed = await window.modal.confirm({
        content: t('paintings.regenerate.confirm'),
        centered: true
      })

      if (!confirmed) return
      await FileManager.deleteFiles(painting.files)
    }

    const prompt = textareaRef.current?.resizableTextArea?.textArea?.value || ''
    updatePaintingState({ prompt })

    if (!aihubmixProvider.apiKey) {
      window.modal.error({
        content: t('error.no_api_key'),
        centered: true
      })
      return
    }

    if (!painting.model || !painting.prompt) {
      return
    }

    await runGeneration(async (signal) => {
      if (mode === 'aihubmix_image_remix' || mode === 'aihubmix_image_upscale') {
        if (!painting.imageFile) {
          window.modal.error({
            content: t('paintings.image_file_required'),
            centered: true
          })
          return
        }
        if (!fileMap[painting.imageFile]) {
          window.modal.error({
            content: t('paintings.image_file_retry'),
            centered: true
          })
          return
        }
      }

      const result = await generateAihubmixImages({
        provider: aihubmixProvider,
        mode: mode as AihubmixMode,
        painting,
        prompt,
        fileMap,
        generateFailedMessage: t('paintings.generate_failed'),
        imageMixFailedMessage: t('paintings.image_mix_failed'),
        signal
      })

      const savedResult = await savePaintingGenerationResult(result, {
        t,
        emptyUrlLogMessage: '图像URL为空，可能是提示词违禁',
        errorLogMessage: '下载图像失败:'
      })

      if (savedResult) {
        updatePaintingState({
          files: savedResult.files,
          urls: savedResult.urls
        })
      }
    })
  }

  const handleRetry = async (painting: PaintingAction) => {
    setIsLoading(true)
    try {
      const validFiles = await saveGeneratedPaintingFiles({
        urls: painting.urls,
        t,
        emptyUrlLogMessage: '图像URL为空，可能是提示词违禁',
        errorLogMessage: '下载图像失败:'
      })
      updatePaintingState({ files: validFiles, urls: painting.urls })
    } catch (error) {
      handleError(error)
    } finally {
      setIsLoading(false)
    }
  }

  const onCancel = () => {
    cancelGeneration()
  }

  const nextImage = () => {
    setCurrentImageIndex((prev) => (prev + 1) % painting.files.length)
  }

  const prevImage = () => {
    setCurrentImageIndex((prev) => (prev - 1 + painting.files.length) % painting.files.length)
  }

  const handleAddPainting = () => {
    const newPainting = addPainting(mode, getNewPainting())
    updatePainting(mode, newPainting)
    setPainting(newPainting)
    return newPainting
  }

  const onDeletePainting = (paintingToDelete: PaintingAction) => {
    if (paintingToDelete.id === painting.id) {
      const currentIndex = filteredPaintings.findIndex((p) => p.id === paintingToDelete.id)

      if (currentIndex > 0) {
        setPainting(filteredPaintings[currentIndex - 1])
      } else if (filteredPaintings.length > 1) {
        setPainting(filteredPaintings[1])
      }
    }

    void removePainting(mode, paintingToDelete)
  }

  const { isTranslating, handleKeyDown } = usePaintingPromptTranslation({
    prompt: painting.prompt,
    onTranslated: (translatedText) => updatePaintingState({ prompt: translatedText }),
    onError: (error) => logger.error('Translation failed:', error as Error)
  })

  const handleProviderChange = (providerId: string) => {
    const routeName = location.pathname.split('/').pop()
    if (providerId !== routeName) {
      void navigate({ to: '../' + providerId, replace: true })
    }
  }

  // 处理模式切换
  const handleModeChange = (value: string) => {
    setMode(value as keyof PaintingsState)
    if (paintings[value as keyof PaintingsState] && paintings[value as keyof PaintingsState].length > 0) {
      setPainting(paintings[value as keyof PaintingsState][0])
    } else {
      setPainting(DEFAULT_PAINTING)
    }
  }

  // 处理随机种子的点击事件 >=0<=2147483647
  const handleRandomSeed = () => {
    const randomSeed = Math.floor(Math.random() * 2147483647).toString()
    updatePaintingState({ seed: randomSeed })
    return randomSeed
  }

  // 渲染配置项的函数
  const renderConfigForm = (item: ConfigItem) => {
    switch (item.type) {
      case 'select': {
        // 处理函数类型的disabled属性
        const isDisabled = typeof item.disabled === 'function' ? item.disabled(item, painting) : item.disabled

        // 处理函数类型的options属性
        const selectOptions =
          typeof item.options === 'function'
            ? item.options(item, painting).map((option) => ({
                ...option,
                label: option.labelKey ? t(option.labelKey) : option.label
              }))
            : item.options?.map((option) => ({
                ...option,
                label: option.labelKey ? t(option.labelKey) : option.label
              }))

        return (
          <Select
            style={{ width: '100%' }}
            listHeight={500}
            disabled={isDisabled}
            value={painting[item.key!] || item.initialValue}
            options={selectOptions as any}
            onChange={(v) => updatePaintingState({ [item.key!]: v })}
          />
        )
      }
      case 'radio': {
        // 处理函数类型的options属性
        const radioOptions =
          typeof item.options === 'function'
            ? item.options(item, painting).map((option) => ({
                ...option,
                label: option.labelKey ? t(option.labelKey) : option.label
              }))
            : item.options?.map((option) => ({
                ...option,
                label: option.labelKey ? t(option.labelKey) : option.label
              }))

        return (
          <Radio.Group
            value={painting[item.key!] || item.initialValue}
            onChange={(e) => updatePaintingState({ [item.key!]: e.target.value })}>
            {radioOptions!.map((option) => (
              <Radio.Button key={option.value} value={option.value}>
                {option.label}
              </Radio.Button>
            ))}
          </Radio.Group>
        )
      }
      case 'slider': {
        return (
          <div className="flex items-center gap-4 [&_.ant-slider]:flex-1">
            <Slider
              min={item.min}
              max={item.max}
              step={item.step}
              value={(painting[item.key!] || item.initialValue) as number}
              onChange={(v) => updatePaintingState({ [item.key!]: v })}
            />
            <InputNumber
              className="w-17.5!"
              min={item.min}
              max={item.max}
              step={item.step}
              value={(painting[item.key!] || item.initialValue) as number}
              onChange={(v) => updatePaintingState({ [item.key!]: v })}
            />
          </div>
        )
      }
      case 'input':
        return (
          <Input
            value={(painting[item.key!] || item.initialValue) as string}
            onChange={(e) => updatePaintingState({ [item.key!]: e.target.value })}
            suffix={
              item.key === 'seed' ? (
                <RedoOutlined
                  onClick={handleRandomSeed}
                  style={{ cursor: 'pointer', color: 'var(--color-foreground-secondary)' }}
                />
              ) : (
                item.suffix
              )
            }
          />
        )
      case 'inputNumber':
        return (
          <InputNumber
            min={item.min}
            max={item.max}
            style={{ width: '100%' }}
            value={(painting[item.key!] || item.initialValue) as number}
            onChange={(v) => updatePaintingState({ [item.key!]: v })}
          />
        )
      case 'textarea':
        return (
          <TextArea
            value={(painting[item.key!] || item.initialValue) as string}
            onChange={(e) => updatePaintingState({ [item.key!]: e.target.value })}
            spellCheck={false}
            rows={4}
          />
        )
      case 'switch':
        return (
          <RowFlex>
            <Switch
              checked={(painting[item.key!] || item.initialValue) as boolean}
              onCheckedChange={(checked) => updatePaintingState({ [item.key!]: checked })}
            />
          </RowFlex>
        )
      case 'image': {
        return (
          <Upload
            className="[&_.ant-upload-list-item-container]:aspect-square! [&_.ant-upload-list-item-container]:h-full! [&_.ant-upload-list-item-container]:w-full! [&_.ant-upload.ant-upload-select]:aspect-square! [&_.ant-upload.ant-upload-select]:h-full! [&_.ant-upload.ant-upload-select]:w-full!"
            accept="image/png, image/jpeg, image/gif"
            maxCount={1}
            showUploadList={false}
            listType="picture-card"
            beforeUpload={(file) => {
              const path = URL.createObjectURL(file)
              setFileMap({ ...fileMap, [path]: file as unknown as FileMetadata })
              updatePaintingState({ [item.key!]: path })
              return false // 阻止默认上传行为
            }}>
            {painting[item.key!] ? (
              <div className="relative h-full w-full overflow-hidden rounded-md hover:after:absolute hover:after:inset-0 hover:after:flex hover:after:cursor-pointer hover:after:items-center hover:after:justify-center hover:after:bg-black/50 hover:after:text-white hover:after:content-['点击替换']">
                <img src={painting[item.key!]} alt="预览图" className="h-full w-full object-cover" />
              </div>
            ) : (
              <img src={IcImageUp} alt="" className={theme === 'dark' ? 'mt-2 invert' : 'mt-2'} />
            )}
          </Upload>
        )
      }
      default:
        return null
    }
  }

  // 渲染配置项的函数
  const renderConfigItem = (item: ConfigItem, index: number) => {
    return (
      <div key={index}>
        <SettingTitle style={{ marginBottom: 5, marginTop: 15 }}>
          {t(item.title!)}
          {item.tooltip && <InfoTooltip content={t(item.tooltip)} />}
        </SettingTitle>
        {renderConfigForm(item)}
      </div>
    )
  }

  const onSelectPainting = (newPainting: PaintingAction) => {
    if (generating) return
    setPainting(newPainting)
    setCurrentImageIndex(0)
  }

  useEffect(() => {
    if (filteredPaintings.length === 0) {
      const newPainting = getNewPainting()
      addPainting(mode, newPainting)
      setPainting(newPainting)
    }
  }, [filteredPaintings, mode, addPainting, painting, getNewPainting])

  return (
    <PaintingPageShell
      title={t('paintings.title')}
      addButtonLabel={t('paintings.button.new.image')}
      onAddPainting={handleAddPainting}
      navbarRightClassName="justify-end"
      settings={
        <>
          <div className="mb-1.25 flex items-center justify-between">
            <SettingTitle style={{ marginBottom: 5 }}>{t('common.provider')}</SettingTitle>
            <SettingHelpLink target="_blank" href={aihubmixProvider.apiHost}>
              {t('paintings.learn_more')}
              {(() => {
                const Icon = resolveProviderIcon(aihubmixProvider.id)
                return Icon ? <Icon.Avatar size={16} className="ml-1.25" /> : null
              })()}
            </SettingHelpLink>
          </div>
          <ProviderSelect
            provider={aihubmixProvider}
            options={Options}
            onChange={handleProviderChange}
            className={'mb-4'}
          />

          {/* 使用JSON配置渲染设置项 */}
          {modeConfigs[mode].filter((item) => (item.condition ? item.condition(painting) : true)).map(renderConfigItem)}
        </>
      }
      artboard={
        <>
          {/* 添加功能切换分段控制器 */}
          <div className="flex justify-center pt-6">
            <Segmented shape="round" value={mode} onChange={handleModeChange} options={modeOptions} />
          </div>
          <Artboard
            painting={painting}
            isLoading={isLoading}
            currentImageIndex={currentImageIndex}
            onPrevImage={prevImage}
            onNextImage={nextImage}
            onCancel={onCancel}
            retry={handleRetry}
          />
        </>
      }
      promptBar={
        <PaintingPromptBar
          textareaRef={textareaRef}
          value={painting.prompt}
          disabled={isLoading}
          placeholder={
            isTranslating
              ? t('paintings.translating')
              : painting.model?.startsWith('imagen-') || painting.model?.startsWith('FLUX')
                ? t('paintings.prompt_placeholder_en')
                : t('paintings.prompt_placeholder_edit')
          }
          onChange={(prompt) => updatePaintingState({ prompt })}
          onKeyDown={handleKeyDown}
          onGenerate={onGenerate}
          translate={{
            onTranslated: (translatedText) => updatePaintingState({ prompt: translatedText }),
            disabled: isLoading || isTranslating,
            isLoading: isTranslating
          }}
        />
      }
      history={
        <PaintingsList
          namespace={mode}
          paintings={filteredPaintings}
          selectedPainting={painting}
          onSelectPainting={onSelectPainting}
          onDeletePainting={onDeletePainting}
          onNewPainting={handleAddPainting}
        />
      }
    />
  )
}

export default AihubmixPage
