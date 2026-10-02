// Applies a page's head tags after a client-side navigation. The values are not
// derived here: for a blog post the server computes them once (postHead in
// server-blog-render.cjs) and sends them with the post, in the page's embedded
// JSON and in GET /api/blog-posts/:slug, so what a crawler reads in the raw HTML
// and what this sets after JavaScript runs cannot drift apart (F-F-11).

export interface PageHead {
  title: string;
  description: string;
  canonical: string;
}

type Tag = [selector: string, attribute: 'content' | 'href', value: string];

/** Sets the tags the document already has and returns a function that puts back what was there. */
export function applyPageHead(head: PageHead): () => void {
  const tags: Tag[] = [
    ['meta[name="description"]', 'content', head.description],
    ['link[rel="canonical"]', 'href', head.canonical],
    ['meta[property="og:url"]', 'content', head.canonical],
    ['meta[name="twitter:url"]', 'content', head.canonical],
    ['meta[property="og:title"]', 'content', head.title],
    ['meta[name="twitter:title"]', 'content', head.title],
    ['meta[property="og:description"]', 'content', head.description],
    ['meta[name="twitter:description"]', 'content', head.description],
  ];

  const previousTitle = document.title;
  document.title = head.title;
  const restores: Array<() => void> = [
    () => {
      document.title = previousTitle;
    },
  ];

  for (const [selector, attribute, value] of tags) {
    const element = document.head.querySelector(selector);
    if (!element) continue;
    const previous = element.getAttribute(attribute);
    element.setAttribute(attribute, value);
    restores.push(() => {
      if (previous === null) element.removeAttribute(attribute);
      else element.setAttribute(attribute, previous);
    });
  }

  return () => {
    for (const restore of restores) restore();
  };
}
