// src/main/services/GoogleSearchService.ts
import * as https from 'https';

const GOOGLE_CSE_API_BASE_URL = 'https://www.googleapis.com/customsearch/v1';

// Interfaces for Google Custom Search API response
// See: https://developers.google.com/custom-search/v1/reference/rest/v1/cse/list
export interface GoogleSearchResultItem {
  kind: string; // e.g., "customsearch#result"
  title: string;
  htmlTitle: string;
  link: string;
  displayLink: string;
  snippet: string;
  htmlSnippet: string;
  cacheId?: string;
  formattedUrl?: string;
  htmlFormattedUrl?: string;
  pagemap?: {
    cse_thumbnail?: Array<{ src: string; width: string; height: string }>;
    metatags?: Array<Record<string, any>>;
    // Other pagemap properties
  };
  mime?: string;
  fileFormat?: string;
  // Add more fields as needed
}

export interface GoogleSearchResponse {
  kind: string; // e.g., "customsearch#search"
  url: {
    type: string; // "application/json"
    template: string;
  };
  queries: {
    request?: Array<{
      title: string;
      totalResults: string; // String number
      searchTerms: string;
      count: number;
      startIndex: number;
      inputEncoding: string;
      outputEncoding: string;
      safe: string;
      cx: string; // CSE ID
    }>;
    nextPage?: Array<{
      title: string;
      totalResults: string;
      searchTerms: string;
      count: number;
      startIndex: number;
      inputEncoding: string;
      outputEncoding: string;
      safe: string;
      cx: string;
    }>;
  };
  context?: {
    title: string;
  };
  searchInformation?: {
    searchTime: number;
    formattedSearchTime: string;
    totalResults: string; // String number
    formattedTotalResults: string;
  };
  items?: GoogleSearchResultItem[];
}

export class GoogleSearchService {
  private apiKey: string | null = null;
  private cseId: string | null = null; // Custom Search Engine ID

  constructor(apiKey?: string, cseId?: string) {
    if (apiKey) {
      this.apiKey = apiKey;
    }
    if (cseId) {
      this.cseId = cseId;
    }
    if (!this.apiKey || !this.cseId) {
        console.warn('GoogleSearchService: Initialized WITHOUT API Key or CSE ID. Search functionality will be disabled or fail.');
    } else {
        console.log('GoogleSearchService: Initialized with API Key and CSE ID.');
    }
  }

  private async request<T>(queryParams: URLSearchParams): Promise<T> {
    // API Key and CSE ID check is now primarily in the public search method
    // to allow constructor to not throw immediately if keys are missing (e.g. to be set later)

    const url = `${GOOGLE_CSE_API_BASE_URL}?${queryParams.toString()}`;

    const options: https.RequestOptions = {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      agent: new https.Agent({ keepAlive: true }),
    };

    console.log(`GoogleSearchService: Requesting GET ${url.substring(0, url.indexOf('key=') + 4)}REDACTED_KEY...`); // Avoid logging key

    return new Promise<T>((resolve, reject) => {
      const req = https.request(url, options, (res) => {
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
              console.error('GoogleSearchService: Failed to parse JSON response:', data, error);
              reject(new Error('Failed to parse Google Search API JSON response.'));
            }
          } else {
            console.error(`GoogleSearchService: API request failed with status ${res.statusCode}. Response: ${data.substring(0, 500)}`);
            try {
                const errorResponse = JSON.parse(data);
                const message = errorResponse?.error?.message || `Status ${res.statusCode}`;
                reject(new Error(`Google Search API request failed: ${message}`));
            } catch (e) {
                 reject(new Error(`Google Search API request failed: ${res.statusCode} - ${data.substring(0, 200)}`));
            }
          }
        });
      });

      req.on('error', (error) => {
        console.error('GoogleSearchService: Request error:', error);
        reject(new Error(`Google Search API request error: ${error.message}`));
      });
      req.end();
    });
  }

  /**
   * Performs a search using the Google Custom Search API.
   * @param query The search query.
   * @param numResults Optional number of results to return (default is 10, max is 10 per query for free tier usually).
   * @param startIndex Optional start index for results (default is 1).
   * @param customCseId Optional CSE ID to override the one set in constructor.
   * @param customApiKey Optional API Key to override the one set in constructor.
   * @returns A promise that resolves to the search results.
   */
  public async search(
    query: string,
    numResults: number = 10,
    startIndex: number = 1,
    customCseId?: string,
    customApiKey?: string
  ): Promise<GoogleSearchResponse> {
    const apiKeyToUse = customApiKey || this.apiKey;
    const cseIdToUse = customCseId || this.cseId;

    if (!apiKeyToUse) {
      throw new Error('GoogleSearchService: API Key is missing. Please configure it.');
    }
    if (!cseIdToUse) {
      throw new Error('GoogleSearchService: Custom Search Engine ID (cx) is missing. Please configure it.');
    }
    if (!query || query.trim() === '') { // Check for empty or whitespace-only query
        throw new Error('GoogleSearchService: Search query is required and cannot be empty.');
    }

    const params = new URLSearchParams({
      key: apiKeyToUse,
      cx: cseIdToUse,
      q: query.trim(),
      num: Math.max(1, Math.min(numResults, 10)).toString(), // Ensure num is between 1 and 10
      start: Math.max(1, startIndex).toString(), // Ensure start is at least 1
    });

    return this.request<GoogleSearchResponse>(params);
  }
}
