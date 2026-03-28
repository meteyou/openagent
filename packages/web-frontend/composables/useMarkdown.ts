import { marked } from 'marked'

// Configure marked for clean, minimal output
marked.setOptions({
  breaks: true,
  gfm: true,
})

/**
 * Render markdown string to HTML.
 * For use with v-html in chat bubbles.
 */
export function useMarkdown() {
  function renderMarkdown(text: string): string {
    if (!text) return ''
    const html = marked.parse(text) as string
    return html
  }

  return { renderMarkdown }
}
