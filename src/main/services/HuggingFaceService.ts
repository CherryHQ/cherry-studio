// src/main/services/HuggingFaceService.ts
import * as https from 'https';

// Base URL for Hugging Face Hub API
const HF_API_BASE_URL = 'https://huggingface.co/api';

interface HFModelInfo {
  modelId: string;
  sha?: string;
  lastModified?: string;
  tags?: string[];
  pipeline_tag?: string;
  siblings?: Array<{ rfilename: string }>;
  private?: boolean;
  author?: string;
  config?: Record<string, any>;
  securityStatus?: Record<string, any>;
  // Add more fields as needed from the API response
}

interface HFSpaceInfo {
    id: string; // Typically author_name/space_name
    author: string;
    sha: string;
    lastModified: string;
    private: boolean;
    gated: boolean;
    disabled: boolean;
    subdomain?: string; // This is the key for direct URL if available
    title?: string;
    // Add more fields as needed
}


export class HuggingFaceService {
  private apiKey: string | null = null; // Store API key if provided by user

  constructor(apiKey?: string) {
    if (apiKey) {
      this.apiKey = apiKey;
    }
    console.log('HuggingFaceService: Initialized' + (apiKey ? ' with API key.' : '.'));
  }

  private async request<T>(endpoint: string, options: https.RequestOptions = {}, bodyData?: any): Promise<T> {
    const url = `${HF_API_BASE_URL}${endpoint}`;

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        // Add Authorization header if API key is present
        ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
    };

    const payload = bodyData ? JSON.stringify(bodyData) : null;
    if (payload) {
        headers['Content-Length'] = Buffer.byteLength(payload).toString();
    }

    const mergedOptions: https.RequestOptions = {
      method: 'GET', // Default method
      ...options, // User-provided options override defaults
      headers: { ...headers, ...options.headers }, // Merge headers, user's headers take precedence
      agent: new https.Agent({ keepAlive: true }), // Use keep-alive
    };


    console.log(`HuggingFaceService: Requesting ${mergedOptions.method} ${url}`);

    return new Promise<T>((resolve, reject) => {
      const req = https.request(url, mergedOptions, (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(data) as T);
            } catch (error) {
              console.error('HuggingFaceService: Failed to parse JSON response:', data, error);
              reject(new Error('Failed to parse Hugging Face API JSON response.'));
            }
          } else {
            console.error(`HuggingFaceService: API request failed with status ${res.statusCode}. Response: ${data.substring(0, 200)}`);
            reject(new Error(`Hugging Face API request failed: ${res.statusCode} - ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error('HuggingFaceService: Request error:', error);
        reject(new Error(`Hugging Face API request error: ${error.message}`));
      });

      if (payload && (mergedOptions.method === 'POST' || mergedOptions.method === 'PUT')) {
        req.write(payload);
      }
      req.end();
    });
  }

  /**
   * Lists models from the Hugging Face Hub.
   * @param search Optional search query for models.
   * @param author Optional author to filter by.
   * @param tags Optional tags to filter by (e.g., "text-generation"). Pass as an array.
   * @param limit Optional limit for number of results.
   * @param full Optional to get full model info.
   * @param sort Optional sort order e.g. 'downloads', 'likes', 'lastModified'.
   * @param direction Optional sort direction: 1 for asc, -1 for desc.
   * @returns A promise that resolves to an array of model info.
   */
  public async listModels(
    search?: string,
    author?: string,
    tags?: string[],
    limit: number = 25,
    full: boolean = true,
    sort?: string, // e.g., 'downloads', 'likes', 'lastModified'
    direction?: 1 | -1 // 1 for asc, -1 for desc
  ): Promise<HFModelInfo[]> {
    let endpoint = `/models?limit=${limit}&full=${full}`;
    if (search) endpoint += `&search=${encodeURIComponent(search)}`;
    if (author) endpoint += `&author=${encodeURIComponent(author)}`;
    if (tags && tags.length > 0) endpoint += `&filter=${tags.map(tag => encodeURIComponent(tag)).join(',')}`;
    if (sort) endpoint += `&sort=${sort}`;
    if (direction !== undefined) endpoint += `&direction=${direction}`;

    return this.request<HFModelInfo[]>(endpoint);
  }

  /**
   * Gets detailed information about a specific model.
   * @param modelId The ID of the model (e.g., "gpt2" or "openai-community/gpt2").
   * @returns A promise that resolves to the model's information.
   */
  public async getModelInfo(modelId: string): Promise<HFModelInfo> {
    const endpoint = `/models/${modelId.includes('/') ? modelId : `models/${modelId}`}`; // Handle if 'models/' prefix is already there
    return this.request<HFModelInfo>(endpoint.replace('models/models/', 'models/')); // Correct potential double 'models/'
  }

  /**
   * Gets information about a Hugging Face Space.
   * @param spaceId The ID of the space (e.g., "huggingface-projects/diffuse-the-rest").
   * @returns A promise that resolves to the space's information.
   */
  public async getSpaceInfo(spaceId: string): Promise<HFSpaceInfo> {
      const endpoint = `/spaces/${spaceId}`;
      return this.request<HFSpaceInfo>(endpoint);
  }

  /**
   * Constructs the direct URL for a Hugging Face Space.
   * If spaceInfo.subdomain is available, it's the most reliable.
   * @param spaceIdOrInfo The ID of the space (e.g., "user/space-name") or an HFSpaceInfo object.
   * @returns The direct URL to the Space.
   */
  public getSpaceUrl(spaceIdOrInfo: string | HFSpaceInfo): string {
    let spaceId: string;
    let subdomain: string | undefined;

    if (typeof spaceIdOrInfo === 'string') {
        spaceId = spaceIdOrInfo;
    } else {
        spaceId = spaceIdOrInfo.id;
        subdomain = spaceIdOrInfo.subdomain;
    }

    if (subdomain) {
        return `https://${subdomain}.hf.space`;
    }

    // Fallback heuristics if subdomain is not provided
    if (spaceId.startsWith('http')) return spaceId; // Already a URL
    if (spaceId.includes('.hf.space')) return `https://${spaceId.replace(/^https?:\/\//, '')}`; // Ensure https and clean

    // Common pattern: "user/space-name" -> "user-space-name.hf.space"
    // Or for some official spaces, just "spacename" -> "spacename.hf.space"
    const parts = spaceId.split('/');
    const presumedSubdomain = parts.join('-');

    console.warn(`HuggingFaceService: Could not reliably determine subdomain for spaceId "${spaceId}". Using guessed URL: https://${presumedSubdomain}.hf.space`);
    return `https://${presumedSubdomain}.hf.space`;
  }
}
