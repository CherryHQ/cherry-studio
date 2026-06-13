import {
  Button,
  FieldHeader,
  FieldHeaderAction,
  Form,
  FormActions,
  FormControl,
  FormDescription,
  FormField,
  FormGrid,
  FormItem,
  FormLabel,
  FormMessage,
  FormSection,
  InfoTooltip,
  InlineSettingField,
  Input,
  Switch
} from '@cherrystudio/ui'
import type { Meta, StoryObj } from '@storybook/react'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'

const meta: Meta<typeof Form> = {
  title: 'Components/Composites/Form',
  component: Form,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Form is a thin wrapper over react-hook-form that wires labels, controls, descriptions, and error messages with consistent aria attributes. Compose with FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage, and the layout composites below.'
      }
    }
  },
  tags: ['autodocs']
}

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: function DefaultStory() {
    const form = useForm({ defaultValues: { email: '' } })
    return (
      <Form {...form}>
        <form className="w-80 space-y-4">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Email</FormLabel>
                <FormControl>
                  <Input type="email" placeholder="you@example.com" {...field} />
                </FormControl>
                <FormDescription>We will only use this for account recovery.</FormDescription>
              </FormItem>
            )}
          />
        </form>
      </Form>
    )
  }
}

export const Required: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'A required field. The red asterisk uses `text-destructive` to stay consistent with FormMessage error colors.'
      }
    }
  },
  render: function RequiredStory() {
    const form = useForm({ defaultValues: { id: '' } })
    return (
      <Form {...form}>
        <form className="w-80 space-y-4">
          <FormField
            control={form.control}
            name="id"
            rules={{ required: '请输入 ID' }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  <span className="text-destructive mr-1" aria-hidden="true">
                    *
                  </span>
                  ID
                </FormLabel>
                <FormControl>
                  <Input placeholder="请输入 ID" {...field} />
                </FormControl>
              </FormItem>
            )}
          />
        </form>
      </Form>
    )
  }
}

export const WithError: Story = {
  render: function WithErrorStory() {
    const form = useForm({ defaultValues: { name: '' } })

    useEffect(() => {
      form.setError('name', { message: 'Name is required' })
    }, [form])

    return (
      <Form {...form}>
        <form className="w-80 space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input placeholder="Enter name" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    )
  }
}

export const WithFormSection: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'FormSection groups related fields with an optional title/description. Separate sections with parent-level spacing (`space-y-8` here) — no divider needed.'
      }
    }
  },
  render: function WithFormSectionStory() {
    const form = useForm({ defaultValues: { name: '', email: '', notifyA: '', notifyB: '' } })
    return (
      <Form {...form}>
        <form className="w-[480px] space-y-8">
          <FormSection title="账户信息" description="基础身份字段。">
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>姓名</FormLabel>
                    <FormControl>
                      <Input placeholder="请输入姓名" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>邮箱</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="you@example.com" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
          </FormSection>
          <FormSection title="通知设置" description="决定哪些事件会通过邮件提醒。">
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="notifyA"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>事件 A</FormLabel>
                    <FormControl>
                      <Input placeholder="频率，例如 daily" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="notifyB"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>事件 B</FormLabel>
                    <FormControl>
                      <Input placeholder="频率，例如 weekly" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
          </FormSection>
        </form>
      </Form>
    )
  }
}

export const WithFormSectionDivided: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Pass `divided` for the dense, attached layout used by drawer settings (e.g. McpSettings). Each section grows a `border-border-muted` top divider; the first divided section drops it automatically.'
      }
    }
  },
  render: function WithFormSectionDividedStory() {
    const form = useForm({ defaultValues: { name: '', email: '', notifyA: '' } })
    return (
      <Form {...form}>
        <form className="w-[480px]">
          <FormSection divided title="账户信息" description="基础身份字段。">
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>姓名</FormLabel>
                    <FormControl>
                      <Input placeholder="请输入姓名" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>邮箱</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="you@example.com" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
          </FormSection>
          <FormSection divided title="通知设置" description="决定哪些事件会通过邮件提醒。">
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="notifyA"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>事件 A</FormLabel>
                    <FormControl>
                      <Input placeholder="频率，例如 daily" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </div>
          </FormSection>
        </form>
      </Form>
    )
  }
}

export const WithFormGrid: Story = {
  parameters: {
    docs: {
      description: {
        story: 'FormGrid responsively splits fields into 1 column (default) or 2 columns at the `xl` breakpoint.'
      }
    }
  },
  render: function WithFormGridStory() {
    const form = useForm({ defaultValues: { firstName: '', lastName: '', email: '', phone: '' } })
    return (
      <Form {...form}>
        <form className="w-[640px]">
          <FormGrid>
            <FormField
              control={form.control}
              name="firstName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>名字</FormLabel>
                  <FormControl>
                    <Input placeholder="名字" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="lastName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>姓氏</FormLabel>
                  <FormControl>
                    <Input placeholder="姓氏" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>邮箱</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="you@example.com" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>手机</FormLabel>
                  <FormControl>
                    <Input placeholder="+86" {...field} />
                  </FormControl>
                </FormItem>
              )}
            />
          </FormGrid>
        </form>
      </Form>
    )
  }
}

export const WithFormActions: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'FormActions is the form footer button row for Drawer/Page contexts. For Dialogs, use the existing `DialogFooter`.'
      }
    }
  },
  render: function WithFormActionsStory() {
    const form = useForm({ defaultValues: { name: '' } })
    return (
      <Form {...form}>
        <form className="w-[420px] space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>名称</FormLabel>
                <FormControl>
                  <Input placeholder="请输入名称" {...field} />
                </FormControl>
              </FormItem>
            )}
          />
          <FormActions>
            <Button variant="outline" type="button">
              取消
            </Button>
            <Button type="submit">保存</Button>
          </FormActions>
        </form>
      </Form>
    )
  }
}

export const WithFieldHeader: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'FieldHeader composes a label, optional tooltip, and an optional trailing action (push-right via FieldHeaderAction).'
      }
    }
  },
  render: function WithFieldHeaderStory() {
    const form = useForm({ defaultValues: { apiKey: '' } })
    return (
      <Form {...form}>
        <form className="w-[420px] space-y-4">
          <FormField
            control={form.control}
            name="apiKey"
            render={({ field }) => (
              <FormItem>
                <FieldHeader>
                  <FormLabel>API Key</FormLabel>
                  <InfoTooltip content="在服务商控制台创建，以 sk- 开头。" />
                  <FieldHeaderAction>
                    <Button variant="link" size="sm" type="button">
                      如何获取?
                    </Button>
                  </FieldHeaderAction>
                </FieldHeader>
                <FormControl>
                  <Input placeholder="sk-..." {...field} />
                </FormControl>
              </FormItem>
            )}
          />
        </form>
      </Form>
    )
  }
}

export const WithInlineSettingField: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'InlineSettingField pairs a left-aligned title/description with a right-aligned control (switch, input, select, etc.).'
      }
    }
  },
  render: () => (
    <div className="flex w-[480px] flex-col gap-3">
      <InlineSettingField title="开启自动同步" description="每 15 分钟同步一次，关闭后仅手动同步。">
        <Switch defaultChecked />
      </InlineSettingField>
      <InlineSettingField title="只在 WiFi 下同步">
        <Switch />
      </InlineSettingField>
    </div>
  )
}

export const CompactDensity: Story = {
  parameters: {
    docs: {
      description: {
        story: 'FormItem + Input both support `density="compact"`. Use it for dense settings panels and embedded forms.'
      }
    }
  },
  render: function CompactDensityStory() {
    const form = useForm({ defaultValues: { d1: '', d2: '', c1: '', c2: '' } })
    return (
      <Form {...form}>
        <div className="flex w-[640px] gap-8">
          <div className="flex-1">
            <p className="mb-3 text-sm font-medium">Default</p>
            <form className="space-y-4">
              <FormField
                control={form.control}
                name="d1"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>名称</FormLabel>
                    <FormControl>
                      <Input placeholder="default" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="d2"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>邮箱</FormLabel>
                    <FormControl>
                      <Input placeholder="default" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </form>
          </div>
          <div className="flex-1">
            <p className="mb-3 text-sm font-medium">Compact</p>
            <form className="space-y-4">
              <FormField
                control={form.control}
                name="c1"
                render={({ field }) => (
                  <FormItem density="compact">
                    <FormLabel>名称</FormLabel>
                    <FormControl>
                      <Input density="compact" placeholder="compact" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="c2"
                render={({ field }) => (
                  <FormItem density="compact">
                    <FormLabel>邮箱</FormLabel>
                    <FormControl>
                      <Input density="compact" placeholder="compact" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </form>
          </div>
        </div>
      </Form>
    )
  }
}

export const FullForm: Story = {
  parameters: {
    docs: {
      description: {
        story:
          'Putting it all together: FormSection groups, FormGrid responsive layout, FieldHeader for labelled fields with tooltip, InlineSettingField for toggle rows, and FormActions for the submit footer.'
      }
    }
  },
  render: function FullFormStory() {
    const form = useForm({
      defaultValues: { id: '', firstName: '', lastName: '', email: '', autoSync: true }
    })
    const onSubmit = form.handleSubmit(() => {})
    return (
      <Form {...form}>
        <form onSubmit={onSubmit} className="w-[640px] space-y-8">
          <FormSection title="账户信息" description="必填字段。">
            <FormGrid>
              <FormField
                control={form.control}
                name="id"
                rules={{ required: '请输入 ID' }}
                render={({ field }) => (
                  <FormItem>
                    <FieldHeader>
                      <FormLabel>
                        <span className="text-destructive mr-1" aria-hidden="true">
                          *
                        </span>
                        ID
                      </FormLabel>
                      <InfoTooltip content="唯一标识符，不可重复。" />
                    </FieldHeader>
                    <FormControl>
                      <Input placeholder="请输入 ID" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>邮箱</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="you@example.com" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="firstName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>名字</FormLabel>
                    <FormControl>
                      <Input placeholder="名字" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="lastName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>姓氏</FormLabel>
                    <FormControl>
                      <Input placeholder="姓氏" {...field} />
                    </FormControl>
                  </FormItem>
                )}
              />
            </FormGrid>
          </FormSection>
          <FormSection title="偏好">
            <InlineSettingField title="开启自动同步" description="每 15 分钟同步一次。">
              <FormField
                control={form.control}
                name="autoSync"
                render={({ field }) => <Switch checked={field.value} onCheckedChange={field.onChange} />}
              />
            </InlineSettingField>
          </FormSection>
          <FormActions>
            <Button variant="outline" type="button">
              取消
            </Button>
            <Button type="submit">保存</Button>
          </FormActions>
        </form>
      </Form>
    )
  }
}
