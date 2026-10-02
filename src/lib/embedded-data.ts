// The server renders /blog/ and /blog/<slug>/ itself (server-blog-render.cjs) and
// embeds the data it rendered from as <script type="application/json" id="...">.
// The client's first render starts from it, so replacing the server's HTML with
// React's shows the same page instead of a loading state.

export function readEmbeddedJson<T>(id: string): T | null {
  if (typeof document === 'undefined') return null;
  try {
    const text = document.getElementById(id)?.textContent;
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

/** The embedded data describes the page as first served: once it has been used, a later visit fetches fresh data. */
export function discardEmbeddedJson(id: string): void {
  document.getElementById(id)?.remove();
}
