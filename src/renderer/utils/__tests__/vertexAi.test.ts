import { describe, expect, it } from 'vitest'

import { getMissingVertexAIConfigFields, parseVertexAIServiceAccountJson } from '../vertexAi'

describe('parseVertexAIServiceAccountJson', () => {
  it('extracts service account fields from Google JSON key content', () => {
    const parsed = parseVertexAIServiceAccountJson(
      JSON.stringify({
        type: 'service_account',
        project_id: 'vertex-project',
        private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
        client_email: 'vertex@vertex-project.iam.gserviceaccount.com'
      })
    )

    expect(parsed).toEqual({
      projectId: 'vertex-project',
      privateKey: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----',
      clientEmail: 'vertex@vertex-project.iam.gserviceaccount.com'
    })
  })

  it('ignores plain private key input', () => {
    expect(
      parseVertexAIServiceAccountJson('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')
    ).toBeUndefined()
  })

  it('ignores JSON without required service account credentials', () => {
    expect(parseVertexAIServiceAccountJson(JSON.stringify({ project_id: 'vertex-project' }))).toBeUndefined()
  })
})

describe('getMissingVertexAIConfigFields', () => {
  it('reports all missing required fields including location', () => {
    expect(
      getMissingVertexAIConfigFields({
        projectId: ' ',
        location: '',
        serviceAccount: {
          privateKey: '',
          clientEmail: ' '
        }
      })
    ).toEqual(['projectId', 'location', 'clientEmail', 'privateKey'])
  })

  it('returns an empty list when the configuration is complete', () => {
    expect(
      getMissingVertexAIConfigFields({
        projectId: 'vertex-project',
        location: 'us-central1',
        serviceAccount: {
          privateKey: '-----BEGIN PRIVATE KEY-----',
          clientEmail: 'vertex@vertex-project.iam.gserviceaccount.com'
        }
      })
    ).toEqual([])
  })
})
