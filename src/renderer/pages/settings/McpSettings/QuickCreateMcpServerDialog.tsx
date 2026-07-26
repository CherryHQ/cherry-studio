import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Form,
  Scrollbar
} from '@cherrystudio/ui'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from '@renderer/services/toast'
import type { CreateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'
import { type FC, useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  buildMcpSchema,
  MCP_FORM_DEFAULT_VALUES,
  McpEndpointField,
  type McpFormValues,
  McpIdentityFields,
  McpRuntimeFields,
  McpTransportFields,
  toMcpServerFields,
  useMcpRegistryState
} from './McpServerFields'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingServers: McpServer[]
  onCreate: (dto: CreateMcpServerDto) => Promise<void>
}

const QuickCreateMcpServerDialog: FC<Props> = ({ open, onOpenChange, existingServers, onCreate }) => {
  const { t } = useTranslation()
  const [serverType, setServerType] = useState<McpServer['type']>('stdio')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const form = useForm<McpFormValues>({
    resolver: zodResolver(buildMcpSchema(t)) as any,
    defaultValues: MCP_FORM_DEFAULT_VALUES
  })
  const registryState = useMcpRegistryState(form)

  useEffect(() => {
    if (!open) return
    form.reset(MCP_FORM_DEFAULT_VALUES)
    setServerType('stdio')
    setAdvancedOpen(false)
  }, [open, form])

  const fieldsProps = {
    form,
    serverType,
    onServerTypeChange: setServerType,
    registryState,
    singleColumn: true
  }

  const handleSubmit = async () => {
    if (submitting) return
    if (!(await form.trigger())) return

    const values = form.getValues()
    const name = values.name.trim()
    if (existingServers.some((server) => server.name === name)) {
      form.setError('name', {
        type: 'manual',
        message: t('settings.mcp.addServer.importFrom.nameExists', { name })
      })
      return
    }

    setSubmitting(true)
    try {
      await onCreate({ ...toMcpServerFields(values), name, isActive: false, installSource: 'manual' })
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent size="xl" closeOnOverlayClick={!submitting}>
        <DialogHeader>
          <DialogTitle>{t('settings.mcp.addServer.create')}</DialogTitle>
          <DialogDescription>{t('settings.mcp.addServer.createDescription')}</DialogDescription>
        </DialogHeader>

        <Scrollbar className="-m-1 max-h-[60vh] p-1 pr-3">
          <Form {...form}>
            <form className="flex flex-col gap-7" id="mcp-quick-create-form">
              <McpIdentityFields {...fieldsProps} />
              <McpEndpointField {...fieldsProps} />

              <Accordion
                type="single"
                collapsible
                value={advancedOpen ? 'advanced' : ''}
                onValueChange={(value) => setAdvancedOpen(value === 'advanced')}>
                <AccordionItem value="advanced" className="border-t border-b-0 pt-1">
                  <AccordionTrigger className="py-3">{t('settings.mcp.addServer.advanced')}</AccordionTrigger>
                  <AccordionContent contentClassName="text-foreground" className="flex flex-col gap-6 pt-1 pb-1">
                    <McpTransportFields {...fieldsProps} />
                    <McpRuntimeFields {...fieldsProps} inlineCards={false} />
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </form>
          </Form>
        </Scrollbar>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button type="button" disabled={submitting} loading={submitting} onClick={() => void handleSubmit()}>
            {t('common.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default QuickCreateMcpServerDialog
