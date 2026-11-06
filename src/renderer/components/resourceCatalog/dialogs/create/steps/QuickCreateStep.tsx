import { Info, Sparkles } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type UseFormReturn, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  Button,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  ScrollArea,
  Textarea
} from '@cherrystudio/ui'
import type { ModelSelectorFilter } from '@renderer/components/ModelSelector'
import { EmojiAvatarPicker } from '@renderer/components/resourceCatalog/dialogs/components/DialogFormFields'
import {
  CompactModelField,
  type ModelLabels
} from '@renderer/components/resourceCatalog/dialogs/components/EditDialogShared'

import type { ResourceCreateWizardFormValues } from '../types'

const EMPTY_MODEL_LABELS: ModelLabels = {
  modelId: null,
  planModelId: null,
  smallModelId: null,
  contextCompressModelId: null
}

type QuickCreateStepProps = {
  form: UseFormReturn<ResourceCreateWizardFormValues>
  portalContainer: HTMLElement | null
  fallbackAvatar: string
  modelFilter?: ModelSelectorFilter
  onSettingsNavigate?: (navigate: () => void) => void
  onCancel: () => void
  onManualCreate: () => void
  onAutoCreate: () => void
}

/**
 * The Agent create entry: avatar, name, and purpose. The usable default model is preselected by the
 * wizard, so the model picker only appears while no model is resolved. The purpose is stored as the
 * description; "Manual create" hands every field to the guided wizard, "Agent create" configures the
 * rest automatically.
 */
export function QuickCreateStep({
  form,
  portalContainer,
  fallbackAvatar,
  modelFilter,
  onSettingsNavigate,
  onCancel,
  onManualCreate,
  onAutoCreate
}: QuickCreateStepProps) {
  const { t } = useTranslation()
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [modelLabels, setModelLabels] = useState<ModelLabels>(EMPTY_MODEL_LABELS)
  // Once shown, the picker stays so choosing a model does not make the control the user just used vanish.
  const [modelFieldShown, setModelFieldShown] = useState(false)
  const [avatar, name, modelId] = useWatch({ control: form.control, name: ['avatar', 'name', 'modelId'] })
  const canCreate = (name?.trim().length ?? 0) > 0 && Boolean(modelId)
  const showModelField = modelFieldShown || !modelId

  useEffect(() => {
    form.setFocus('name')
  }, [form])

  return (
    <>
      <ScrollArea viewportProps={{ className: 'px-8 pt-6 pb-5' }} className="min-h-0 flex-1">
        <div className="flex flex-col gap-5">
          <div className="flex justify-center">
            <EmojiAvatarPicker
              size="lg"
              value={avatar}
              fallback={fallbackAvatar}
              open={emojiPickerOpen}
              onOpenChange={setEmojiPickerOpen}
              onChange={(value) => form.setValue('avatar', value, { shouldDirty: true })}
              ariaLabel={t('library.config.dialogs.create.avatar_aria')}
              portalContainer={portalContainer}
              avatarClassName="rounded-[20%]"
            />
          </div>

          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-medium">{t('library.config.agent.field.name.label')}</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder={t('library.config.dialogs.create.quick.name_placeholder')}
                    className="h-10 rounded-lg bg-muted/40 px-3.5 focus-visible:bg-transparent"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="font-medium">{t('library.config.dialogs.create.quick.purpose_label')}</FormLabel>
                <FormControl>
                  <Textarea.Input
                    {...field}
                    rows={3}
                    placeholder={t('library.config.dialogs.create.quick.purpose_placeholder')}
                    className="min-h-20 resize-none rounded-lg bg-muted/40 px-3.5 py-2.5 text-sm focus-visible:bg-transparent"
                  />
                </FormControl>
              </FormItem>
            )}
          />

          {showModelField ? (
            <div className="flex flex-col gap-2">
              <CompactModelField
                form={form}
                name="modelId"
                includeAgentOnlyModels
                label={t('common.model')}
                labelClassName="font-medium"
                filter={modelFilter}
                portalContainer={portalContainer}
                modelLabels={modelLabels}
                setModelLabels={setModelLabels}
                onModelChange={(nextModelId) => {
                  form.setValue('modelId', nextModelId, { shouldDirty: true })
                  setModelFieldShown(true)
                }}
                onSettingsNavigate={onSettingsNavigate}
                triggerClassName="h-10 rounded-lg border border-input bg-transparent px-3.5 hover:bg-accent/50 aria-expanded:bg-accent/50"
              />
              {modelId ? null : (
                <p className="flex items-center gap-1.5 text-warning text-xs">
                  <Info className="size-3.5 shrink-0" />
                  {t('library.config.dialogs.create.quick.model_required')}
                </p>
              )}
            </div>
          ) : null}
        </div>
      </ScrollArea>

      <div className="flex shrink-0 items-center justify-between gap-3 border-border-subtle border-t px-6 py-3">
        <span className="min-w-0 truncate text-muted-foreground text-xs">
          {t('library.config.dialogs.create.quick.auto_hint')}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="ghost" className="text-muted-foreground" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="outline" disabled={!canCreate} onClick={onManualCreate}>
            {t('library.config.dialogs.create.quick.manual_create')}
          </Button>
          <Button type="button" disabled={!canCreate} onClick={onAutoCreate}>
            <Sparkles />
            {t('library.config.dialogs.create.quick.auto_create')}
          </Button>
        </div>
      </div>
    </>
  )
}
