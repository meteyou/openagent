import type { AgentTool } from '@mariozechner/pi-agent-core'
import { Type } from '@mariozechner/pi-ai'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

export interface WebSearchConfig {
  provider?: 'duckduckgo'
}

export interface WebFetchConfig {
  // Currently no provider-specific config needed
}

export interface BuiltinToolsConfig {
  webSearch?: { enabled?: boolean; provider?: string }
  webFetch?: { enabled?: boolean }
}

// ─── HTML-to-Text Extraction ─────────────────────────────────────────────────

/**
 * Extract readable text from HTML by stripping tags, scripts, styles,
 * and normalizing whitespace. Simple, zero-dependency approach.
 */
export function extractTextFromHtml(html: string): string {
  let text = html

  // Remove script and style blocks entirely
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '')
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '')

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '')

  // Replace common block elements with newlines
  text = text.replace(/<\/?(?:div|p|br|hr|h[1-6]|li|tr|blockquote|pre|section|article|header|footer|nav|main|aside|figure|figcaption|details|summary)\b[^>]*>/gi, '\n')

  // Remove all remaining tags
  text = text.replace(/<[^>]+>/g, '')

  // Decode common HTML entities
  text = text.replace(/&nbsp;/gi, ' ')
  text = text.replace(/&amp;/gi, '&')
  text = text.replace(/&lt;/gi, '<')
  text = text.replace(/&gt;/gi, '>')
  text = text.replace(/&quot;/gi, '"')
  text = text.replace(/&#39;/gi, "'")
  text = text.replace(/&#x27;/gi, "'")
  text = text.replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))

  // Normalize whitespace: collapse multiple spaces/tabs on same line
  text = text.replace(/[ \t]+/g, ' ')

  // Collapse 3+ consecutive newlines into 2
  text = text.replace(/\n{3,}/g, '\n\n')

  // Trim each line
  text = text.split('\n').map(line => line.trim()).join('\n')

  return text.trim()
}

// ─── DuckDuckGo Search Provider ──────────────────────────────────────────────

/**
 * Search DuckDuckGo using the HTML lite interface.
 * Parses results from the lite HTML page (no API key needed).
 */
export async function searchDuckDuckGo(
  query: string,
  count: number = 5,
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<WebSearchResult[]> {
  const url = 'https://lite.duckduckgo.com/lite/'
  const body = new URLSearchParams({ q: query })

  const response = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (compatible; OpenAgent/1.0)',
    },
    body: body.toString(),
  })

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed: HTTP ${response.status}`)
  }

  const html = await response.text()
  return parseDuckDuckGoLiteHtml(html, count)
}

/**
 * Parse DuckDuckGo Lite HTML results page.
 *
 * The lite page has a table-based layout where results appear as:
 * - A link in a <a rel="nofollow" ...> tag (title + URL)
 * - A snippet in a subsequent <td> with class "result-snippet"
 */
export function parseDuckDuckGoLiteHtml(html: string, count: number): WebSearchResult[] {
  const results: WebSearchResult[] = []

  // Match result links: <a rel="nofollow" href="..." class="result-link">Title</a>
  const linkPattern = /<a[^>]+rel="nofollow"[^>]+href="([^"]*)"[^>]*class="result-link"[^>]*>([\s\S]*?)<\/a>/gi
  // Also try alternative pattern where class comes before rel
  const linkPattern2 = /<a[^>]+class="result-link"[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi

  const snippetPattern = /<td[^>]*class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi

  // Collect all links
  const links: { url: string; title: string }[] = []
  for (const pattern of [linkPattern, linkPattern2]) {
    let match
    while ((match = pattern.exec(html)) !== null) {
      const url = match[1].replace(/&amp;/g, '&')
      const title = match[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
      // Avoid duplicates
      if (title && url && !links.some(l => l.url === url)) {
        links.push({ url, title })
      }
    }
  }

  // Collect all snippets
  const snippets: string[] = []
  let snippetMatch
  while ((snippetMatch = snippetPattern.exec(html)) !== null) {
    const snippet = snippetMatch[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim()
    snippets.push(snippet)
  }

  // Combine links with snippets
  for (let i = 0; i < Math.min(links.length, count); i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] ?? '',
    })
  }

  return results
}

// ─── Tool Factories ──────────────────────────────────────────────────────────

/**
 * Create the web_search AgentTool.
 * Currently supports DuckDuckGo as the search provider.
 */
export function createWebSearchTool(config?: WebSearchConfig): AgentTool {
  const _provider = config?.provider ?? 'duckduckgo'

  return {
    name: 'web_search',
    label: 'Web Search',
    description:
      'Search the web for information. Returns a list of results with title, URL, and snippet. ' +
      'Use this to find current information, documentation, facts, or any web content.',
    parameters: Type.Object({
      query: Type.String({ description: 'The search query' }),
      count: Type.Optional(Type.Number({ description: 'Number of results to return (default: 5, max: 20)' })),
    }),
    execute: async (_toolCallId, params) => {
      const { query, count: rawCount } = params as { query: string; count?: number }
      const count = Math.min(Math.max(rawCount ?? 5, 1), 20)

      try {
        const results = await searchDuckDuckGo(query, count)

        if (results.length === 0) {
          return {
            content: [{ type: 'text' as const, text: `No results found for: "${query}"` }],
            details: { query, count: 0, provider: 'duckduckgo' },
          }
        }

        const formatted = results
          .map((r, i) => `${i + 1}. **${r.title}**\n   URL: ${r.url}\n   ${r.snippet}`)
          .join('\n\n')

        return {
          content: [{ type: 'text' as const, text: formatted }],
          details: { query, count: results.length, provider: 'duckduckgo', results },
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: `Search failed: ${message}` }],
          details: { error: true, query },
        }
      }
    },
  }
}

/**
 * Create the web_fetch AgentTool.
 * Fetches a URL and extracts readable text content.
 */
export function createWebFetchTool(_config?: WebFetchConfig): AgentTool {
  return {
    name: 'web_fetch',
    label: 'Web Fetch',
    description:
      'Fetch a web page and extract its text content. Use this to read articles, documentation, ' +
      'blog posts, or any web page. Returns the extracted text without HTML tags.',
    parameters: Type.Object({
      url: Type.String({ description: 'The URL to fetch' }),
      maxLength: Type.Optional(Type.Number({ description: 'Maximum length of extracted text (default: 50000)' })),
    }),
    execute: async (_toolCallId, params) => {
      const { url, maxLength: rawMaxLength } = params as { url: string; maxLength?: number }
      const maxLength = rawMaxLength ?? 50000

      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; OpenAgent/1.0)',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(30000),
        })

        if (!response.ok) {
          return {
            content: [{ type: 'text' as const, text: `Failed to fetch URL: HTTP ${response.status} ${response.statusText}` }],
            details: { error: true, url, status: response.status },
          }
        }

        const contentType = response.headers.get('content-type') ?? ''
        const body = await response.text()

        let text: string
        if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
          text = extractTextFromHtml(body)
        } else {
          // Plain text, JSON, etc. — return as-is
          text = body
        }

        const truncated = text.length > maxLength
        if (truncated) {
          text = text.slice(0, maxLength) + '\n\n[Content truncated at ' + maxLength + ' characters]'
        }

        return {
          content: [{ type: 'text' as const, text }],
          details: { url, length: text.length, truncated, contentType },
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        return {
          content: [{ type: 'text' as const, text: `Failed to fetch URL: ${message}` }],
          details: { error: true, url },
        }
      }
    },
  }
}

// ─── Builtin Tools Factory ───────────────────────────────────────────────────

/**
 * Create all enabled built-in web tools based on config.
 * This is the main entry point for AgentCore integration.
 */
export function createBuiltinWebTools(config?: BuiltinToolsConfig): AgentTool[] {
  const tools: AgentTool[] = []

  // web_search — enabled by default
  if (config?.webSearch?.enabled !== false) {
    const provider = (config?.webSearch?.provider ?? 'duckduckgo') as 'duckduckgo'
    tools.push(createWebSearchTool({ provider }))
  }

  // web_fetch — enabled by default
  if (config?.webFetch?.enabled !== false) {
    tools.push(createWebFetchTool())
  }

  return tools
}
