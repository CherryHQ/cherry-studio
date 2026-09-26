import * as z from 'zod'

import { application } from '@application'
import type {
  UarA2uiComponent,
  UarA2uiComponentSave,
  UarArtifactSchema,
  UarArtifactSchemaSave,
  UarPresentation,
  UarPresentationAdministrationSnapshot,
  UarPresentationSave,
  UarPresentationSelection
} from '@shared/types/prometheusIntegration'

const rawTemplateSchema = z.object({
  version: z.string(),
  catalog_id: z.string(),
  components: z.array(z.record(z.string(), z.unknown())),
  default_data: z.record(z.string(), z.unknown())
})
const rawPresentationSchema = z.object({
  id: z.string(),
  owner_id: z.string(),
  revision: z.number().int().nonnegative(),
  content: z.object({
    title: z.string(),
    description: z.string(),
    enabled: z.boolean(),
    template: rawTemplateSchema
  }),
  created_at: z.string(),
  updated_at: z.string()
})
const rawArtifactSchema = z.object({
  schema_id: z.string(),
  title: z.string(),
  description: z.string(),
  artifact_type: z.enum(['form', 'confirm', 'select', 'text_input', 'display', 'chart', 'media']),
  json_schema: z.record(z.string(), z.unknown()),
  render_hint: z.string().optional(),
  builtin: z.boolean()
})
const rawCustomSchemaRecord = z.object({ schema: rawArtifactSchema, revision: z.string() })
const rawComponentSchema = z.object({
  id: z.string(),
  slug: z.string(),
  primitive_type: z.string(),
  category: z.string(),
  schema: z.record(z.string(), z.unknown()),
  description: z.string().nullable().optional(),
  usage_examples: z.record(z.string(), z.unknown()).nullable().optional(),
  updated_at: z.string()
})
const rawBuiltinComponentSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  builtin: z.literal(true)
})
const rawSelectionSchema = z.object({
  mode: z.enum(['inherit', 'auto', 'all', 'none', 'selected']),
  ids: z.array(z.string()),
  denied_ids: z.array(z.string())
})

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  let body: unknown
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
        ? body.error
        : typeof body === 'string' && body
          ? body
          : `UAR presentation request failed with HTTP ${response.status}`
    throw new Error(message)
  }
  return body
}

async function request(path: string, init: RequestInit = {}): Promise<void> {
  const sidecar = application.get('UarSidecarService')
  const endpoint = await sidecar.ensureReady()
  await responseBody(await sidecar.adminRequest(path, init, endpoint.generation))
}

function projectPresentation(input: z.infer<typeof rawPresentationSchema>): UarPresentation {
  return {
    id: input.id,
    ownerId: input.owner_id,
    revision: input.revision,
    title: input.content.title,
    description: input.content.description,
    enabled: input.content.enabled,
    template: input.content.template,
    createdAt: input.created_at,
    updatedAt: input.updated_at
  }
}

function projectSchema(input: z.infer<typeof rawArtifactSchema>, revision?: string): UarArtifactSchema {
  return {
    schemaId: input.schema_id,
    title: input.title,
    description: input.description,
    artifactType: input.artifact_type,
    jsonSchema: input.json_schema,
    ...(input.render_hint ? { renderHint: input.render_hint } : {}),
    builtin: input.builtin,
    ...(revision ? { revision } : {})
  }
}

function projectComponent(input: z.infer<typeof rawComponentSchema>): UarA2uiComponent {
  const source = input.usage_examples?.source
  const messages = input.schema.messages
  return {
    id: input.id,
    title: input.slug,
    ...(input.description ? { description: input.description } : {}),
    source:
      typeof source === 'string'
        ? source
        : Array.isArray(messages)
          ? messages.map((message) => JSON.stringify(message)).join('\n')
          : '',
    category: input.category,
    primitiveType: input.primitive_type,
    revision: input.updated_at,
    builtin: false
  }
}

export async function readUarPresentations(): Promise<UarPresentationAdministrationSnapshot> {
  const sidecar = application.get('UarSidecarService')
  const endpoint = await sidecar.ensureReady()
  const read = async (path: string) => responseBody(await sidecar.adminRequest(path, {}, endpoint.generation))
  const [catalogBody, schemaBody, customSchemaBody, builtinBody, componentBody, policyBody] = await Promise.all([
    read('/api/uar/presentations'),
    read('/api/uar/a2ui/schemas'),
    read('/api/uar/a2ui/custom-schemas'),
    read('/api/uar/a2ui/components/builtins'),
    read('/api/uar/a2ui/components'),
    read('/api/uar/settings/presentation-policy')
  ])
  const catalog = z.object({ owner_id: z.string(), presentations: z.array(rawPresentationSchema) }).parse(catalogBody)
  const schemas = z.array(rawArtifactSchema).parse(schemaBody)
  const customSchemas = z.array(rawCustomSchemaRecord).parse(customSchemaBody)
  const customRevisions = new Map(customSchemas.map((record) => [record.schema.schema_id, record.revision]))
  const builtins = z.array(rawBuiltinComponentSchema).parse(builtinBody)
  const components = z.array(rawComponentSchema).parse(componentBody)
  const policy = z.object({ policy: z.record(z.string(), z.unknown()) }).parse(policyBody).policy
  const selection = rawSelectionSchema.parse(policy.presentations)
  return {
    schemaVersion: 1,
    generation: endpoint.generation,
    ownerId: catalog.owner_id,
    presentations: catalog.presentations.map(projectPresentation),
    schemas: schemas.map((schema) => projectSchema(schema, customRevisions.get(schema.schema_id))),
    components: [
      ...builtins.map((component) => ({
        id: component.id,
        title: component.title,
        category: component.category,
        primitiveType: component.id,
        source: '',
        revision: 'builtin',
        builtin: true as const
      })),
      ...components.map(projectComponent)
    ],
    policy: selection,
    policyBaseline: policy
  }
}

function presentationDraft(input: UarPresentationSave) {
  return {
    title: input.title,
    description: input.description,
    enabled: input.enabled,
    template: input.template
  }
}

export async function saveUarPresentation(input: UarPresentationSave) {
  await request(input.id ? `/api/uar/presentations/${encodeURIComponent(input.id)}` : '/api/uar/presentations', {
    method: input.id ? 'PUT' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      input.id
        ? { expected_revision: input.expectedRevision, content: presentationDraft(input) }
        : presentationDraft(input)
    )
  })
  return readUarPresentations()
}

export async function deleteUarPresentation(id: string, expectedRevision: number) {
  const query = new URLSearchParams({ expected_revision: String(expectedRevision) })
  await request(`/api/uar/presentations/${encodeURIComponent(id)}?${query}`, { method: 'DELETE' })
  return readUarPresentations()
}

function artifactSchema(input: UarArtifactSchemaSave) {
  return {
    schema_id: input.schemaId,
    title: input.title,
    description: input.description,
    artifact_type: input.artifactType,
    json_schema: input.jsonSchema,
    ...(input.renderHint ? { render_hint: input.renderHint } : {}),
    builtin: false
  }
}

export async function saveUarArtifactSchema(input: UarArtifactSchemaSave) {
  const path =
    input.mode === 'create'
      ? '/api/uar/a2ui/custom-schemas'
      : `/api/uar/a2ui/custom-schemas/${encodeURIComponent(input.schemaId)}`
  await request(path, {
    method: input.mode === 'create' ? 'POST' : 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      input.mode === 'create'
        ? { schema: artifactSchema(input) }
        : { expected_revision: input.expectedRevision, schema: artifactSchema(input) }
    )
  })
  return readUarPresentations()
}

export async function deleteUarArtifactSchema(schemaId: string, expectedRevision: string) {
  const query = new URLSearchParams({ expected_revision: expectedRevision })
  await request(`/api/uar/a2ui/custom-schemas/${encodeURIComponent(schemaId)}?${query}`, { method: 'DELETE' })
  return readUarPresentations()
}

export async function saveUarA2uiComponent(input: UarA2uiComponentSave) {
  await request(input.id ? `/api/uar/a2ui/components/${encodeURIComponent(input.id)}` : '/api/uar/a2ui/components', {
    method: input.id ? 'PUT' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(input.id ? { expected_revision: input.expectedRevision } : {}),
      title: input.title,
      source: input.source,
      ...(input.description ? { description: input.description } : {})
    })
  })
  return readUarPresentations()
}

export async function deleteUarA2uiComponent(id: string, expectedRevision: string) {
  const query = new URLSearchParams({ expected_revision: expectedRevision })
  await request(`/api/uar/a2ui/components/${encodeURIComponent(id)}?${query}`, { method: 'DELETE' })
  return readUarPresentations()
}

export async function saveUarPresentationPolicy(
  expectedPolicy: Record<string, unknown>,
  selection: UarPresentationSelection
) {
  await request('/api/uar/settings/presentation-policy', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expected_policy: expectedPolicy, presentations: selection })
  })
  return readUarPresentations()
}
