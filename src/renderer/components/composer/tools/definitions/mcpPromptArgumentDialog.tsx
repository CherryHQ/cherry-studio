import { type FormEvent, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
  Input,
  RequiredMark
} from '@cherrystudio/ui'
import type { McpPrompt } from '@shared/types/mcp'

export function mcpPromptNeedsArgumentForm(prompt: Pick<McpPrompt, 'arguments'>): boolean {
  return (prompt.arguments ?? []).length > 0
}

export function mcpPromptRequiredArgsFilled(
  prompt: Pick<McpPrompt, 'arguments'>,
  values: Record<string, string>
): boolean {
  return (prompt.arguments ?? [])
    .filter((argument) => argument.required)
    .every((argument) => (values[argument.name] ?? '').trim().length > 0)
}

/**
 * Values to send on `prompts/get`. Empty optionals are omitted so the server can apply its default;
 * empty required fields are the caller's problem (`mcpPromptRequiredArgsFilled`).
 */
export function collectMcpPromptArgs(
  prompt: Pick<McpPrompt, 'arguments'>,
  values: Record<string, string>
): Record<string, string> | undefined {
  const collected: Record<string, string> = {}
  for (const argument of prompt.arguments ?? []) {
    const value = values[argument.name] ?? ''
    if (!value.trim()) continue
    collected[argument.name] = value
  }
  return Object.keys(collected).length > 0 ? collected : undefined
}

type McpPromptArgumentDialogProps = {
  open: boolean
  prompt: McpPrompt | null
  values: Record<string, string>
  submitting: boolean
  onValuesChange: (name: string, value: string) => void
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
}

export function McpPromptArgumentDialog({
  open,
  prompt,
  values,
  submitting,
  onValuesChange,
  onOpenChange,
  onSubmit
}: McpPromptArgumentDialogProps) {
  const { t } = useTranslation()
  const uid = useId()
  const [attempted, setAttempted] = useState(false)
  const promptArguments = prompt?.arguments ?? []

  useEffect(() => {
    if (!open) setAttempted(false)
  }, [open])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!prompt) return
    setAttempted(true)
    if (!mcpPromptRequiredArgsFilled(prompt, values) || submitting) return
    onSubmit()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return
        onOpenChange(next)
      }}>
      <DialogContent closeOnOverlayClick={!submitting} size="sm">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('chat.input.mcp_prompts.fill_arguments')}</DialogTitle>
            <DialogDescription>{t('chat.input.mcp_prompts.fill_arguments_description')}</DialogDescription>
          </DialogHeader>
          {prompt?.description ? <p className="text-muted-foreground text-sm leading-5">{prompt.description}</p> : null}
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
            {promptArguments.map((argument, index) => {
              const inputId = `${uid}-${argument.name}`
              const missing = Boolean(argument.required) && !(values[argument.name] ?? '').trim()
              const showError = attempted && missing
              return (
                <Field key={argument.name} className="gap-2">
                  <FieldLabel htmlFor={inputId} className="text-[13px] text-foreground">
                    <span className="inline-flex items-center gap-1">
                      {argument.name}
                      {argument.required ? <RequiredMark /> : null}
                    </span>
                  </FieldLabel>
                  <Input
                    id={inputId}
                    autoFocus={index === 0}
                    value={values[argument.name] ?? ''}
                    aria-required={argument.required}
                    aria-invalid={showError}
                    disabled={submitting}
                    onChange={(event) => onValuesChange(argument.name, event.target.value)}
                  />
                  {showError ? (
                    <FieldError className="text-xs" errors={[{ message: t('common.required_field') }]} />
                  ) : argument.description ? (
                    <p className="text-muted-foreground text-xs leading-tight">{argument.description}</p>
                  ) : null}
                </Field>
              )
            })}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="emphasis" loading={submitting}>
              {t('chat.input.mcp_prompts.insert')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
