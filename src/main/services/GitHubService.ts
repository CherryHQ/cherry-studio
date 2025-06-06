// src/main/services/GitHubService.ts
import * as https from 'https';

const GITHUB_API_BASE_URL = 'https://api.github.com';

// Basic interfaces for expected GitHub API responses
// These can be expanded based on specific needs
interface GitHubRepoInfo {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  owner: { login: string; html_url: string; avatar_url: string };
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  // Add more fields as needed
}

interface GitHubContentFile {
  type: 'file';
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string; // API URL for this content
  html_url: string; // HTML URL for this content
  download_url: string | null; // URL to download the raw file
  content?: string; // Base64 encoded content if type is file and requested
  encoding?: 'base64';
}

interface GitHubContentDirectory {
  type: 'dir';
  name: string;
  path: string;
  sha: string;
  size: number;
  url: string;
  html_url: string;
  download_url: null; // Typically null for directories
  // Add more fields as needed
}

type GitHubContent = GitHubContentFile | GitHubContentDirectory;

export class GitHubService {
  private apiKey: string | null = null;
  private userAgent: string = 'SkyscopeAI/1.0'; // Standard practice to set a User-Agent

  constructor(apiKey?: string) {
    if (apiKey) {
      this.apiKey = apiKey;
    }
    console.log('GitHubService: Initialized' + (apiKey ? ' with API key.' : ' (unauthenticated).'));
  }

  private async request<T>(endpoint: string, method: 'GET' | 'POST' = 'GET', bodyData?: any): Promise<T> {
    const url = `${GITHUB_API_BASE_URL}${endpoint}`;

    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3+json', // Recommended by GitHub
      'User-Agent': this.userAgent,
    };

    if (method === 'POST' || method === 'PUT' || method === 'PATCH') { // Methods that typically send a body
        headers['Content-Type'] = 'application/json';
    }

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const payload = bodyData ? JSON.stringify(bodyData) : null;
    if (payload) {
        headers['Content-Length'] = Buffer.byteLength(payload).toString();
    }


    const options: https.RequestOptions = {
      method: method,
      headers: headers,
      agent: new https.Agent({ keepAlive: true }),
    };

    console.log(`GitHubService: Requesting ${method} ${url}`);

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
              // Handle cases where response might be empty (e.g., 204 No Content)
              if (data.length === 0 && (res.statusCode === 204 || res.statusCode === 205)) {
                resolve(null as unknown as T); // Or an appropriate empty response type
                return;
              }
              resolve(JSON.parse(data) as T);
            } catch (error) {
              console.error('GitHubService: Failed to parse JSON response:', data, error);
              reject(new Error('Failed to parse GitHub API JSON response.'));
            }
          } else {
            console.error(`GitHubService: API request failed with status ${res.statusCode}. Response: ${data.substring(0, 500)}`);
            reject(new Error(`GitHub API request failed: ${res.statusCode} - ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error('GitHubService: Request error:', error);
        reject(new Error(`GitHub API request error: ${error.message}`));
      });

      if (payload && (options.method === 'POST' || options.method === 'PUT' || options.method === 'PATCH')) {
        req.write(payload);
      }
      req.end();
    });
  }

  /**
   * Gets information about a specific repository.
   * @param owner The owner of the repository.
   * @param repo The name of the repository.
   */
  public async getRepoInfo(owner: string, repo: string): Promise<GitHubRepoInfo> {
    if (!owner || !repo) throw new Error('Owner and repo name are required.');
    const endpoint = `/repos/${owner}/${repo}`;
    return this.request<GitHubRepoInfo>(endpoint);
  }

  /**
   * Gets the contents of a directory or a file in a repository.
   * @param owner The owner of the repository.
   * @param repo The name of the repository.
   * @param contentPath The path to the content (file or directory). Defaults to root.
   * @param ref Optional: The name of the commit/branch/tag. Default: the repository’s default branch.
   */
  public async getRepoContents(owner: string, repo: string, contentPath: string = '', ref?: string): Promise<GitHubContent[] | GitHubContentFile> {
    if (!owner || !repo) throw new Error('Owner and repo name are required.');
    let endpoint = `/repos/${owner}/${repo}/contents/${contentPath.startsWith('/') ? contentPath.substring(1) : contentPath}`;
    if (ref) {
      endpoint += `?ref=${encodeURIComponent(ref)}`;
    }
    // This endpoint returns an array if path is a directory, or a single object if it's a file.
    return this.request<GitHubContent[] | GitHubContentFile>(endpoint);
  }

  /**
   * Gets the content of a file.
   * For files, the 'content' property will be Base64 encoded.
   * @param owner The owner of the repository.
   * @param repo The name of the repository.
   * @param filePath The path to the file.
   * @param ref Optional: The name of the commit/branch/tag.
   */
  public async getFileContent(owner: string, repo: string, filePath: string, ref?: string): Promise<string | null> {
    if (!owner || !repo || !filePath) throw new Error('Owner, repo name, and file path are required.');

    const contentData = await this.getRepoContents(owner, repo, filePath, ref);

    // Type guard to check if it's a single file response
    if (Array.isArray(contentData)) {
        console.warn(`GitHubService: Expected a file but received a directory listing for path ${filePath}.`);
        return null;
    }
    const fileData = contentData as GitHubContentFile;


    if (fileData && fileData.type === 'file' && fileData.content && fileData.encoding === 'base64') {
      return Buffer.from(fileData.content, 'base64').toString('utf8');
    } else if (fileData && fileData.type === 'file' && !fileData.content) {
        console.warn(`GitHubService: File content for ${filePath} was not directly available (possibly too large). Check download_url.`);
        if (fileData.download_url) {
            console.log(`GitHubService: File is available for download at ${fileData.download_url}. Direct download not yet implemented here.`);
            // To implement direct download:
            // return this.downloadFile(fileData.download_url);
            return null; // Placeholder until download is implemented
        }
        return null;
    }
    console.warn(`GitHubService: Path ${filePath} is not a file or content is missing/not base64 encoded.`);
    return null;
  }

  /**
   * Lists public repositories for a specified user.
   * @param username The GitHub username.
   * @param type Can be one of all, owner, member. Default: owner.
   * @param sort Can be one of created, updated, pushed, full_name. Default: pushed for users.
   * @param direction Can be one of asc or desc. Default: desc for created, updated, pushed; asc for full_name.
   */
  public async listUserRepos(
    username: string,
    type: 'all' | 'owner' | 'member' = 'owner',
    sort: 'created' | 'updated' | 'pushed' | 'full_name' = 'pushed',
    direction?: 'asc' | 'desc', // Default depends on sort
    perPage: number = 30,
    page: number = 1
  ): Promise<GitHubRepoInfo[]> {
    if (!username) throw new Error('Username is required.');
    let actualDirection = direction;
    if (!actualDirection) {
        actualDirection = sort === 'full_name' ? 'asc' : 'desc';
    }
    const endpoint = `/users/${username}/repos?type=${type}&sort=${sort}&direction=${actualDirection}&per_page=${perPage}&page=${page}`;
    return this.request<GitHubRepoInfo[]>(endpoint);
  }
}
