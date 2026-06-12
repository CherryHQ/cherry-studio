import { describe, expect, it } from 'vitest'

import {
  getMissingVertexAiConfigFields,
  mergeVertexAiLocationOptions,
  parseVertexAiServiceAccountJson
} from '../vertexAi'

describe('parseVertexAiServiceAccountJson', () => {
  it('extracts service account fields from Google JSON key content', () => {
    const parsed = parseVertexAiServiceAccountJson(
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
      parseVertexAiServiceAccountJson('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')
    ).toBeUndefined()
  })

  it('ignores JSON without required service account credentials', () => {
    expect(parseVertexAiServiceAccountJson(JSON.stringify({ project_id: 'vertex-project' }))).toBeUndefined()
  })
})

describe('mergeVertexAiLocationOptions', () => {
  it('keeps the current location and removes duplicates', () => {
    expect(
      mergeVertexAiLocationOptions(
        [
          { value: 'us-central1', label: 'US Central' },
          { value: 'europe-west8', label: 'europe-west8' }
        ],
        'europe-west8'
      ).map((option) => option.value)
    ).toEqual([
      'europe-west8',
      'global',
      'us-central1',
      'us-east1',
      'us-west1',
      'europe-west1',
      'europe-west4',
      'asia-east1',
      'asia-northeast1',
      'asia-southeast1'
    ])
  })
})

describe('getMissingVertexAiConfigFields', () => {
  it('reports all missing required fields including location', () => {
    expect(
      getMissingVertexAiConfigFields({
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
      getMissingVertexAiConfigFields({
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
