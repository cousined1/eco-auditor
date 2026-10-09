/**
 * Build-time data channel for prerendered routes.
 *
 * The blog index used to prerender as literally "Loading posts…" with zero
 * /blog/<slug> links. renderToString never runs effects, so BlogList's
 * useEffect fetch could not execute during the static render and the shipped
 * HTML contained no posts at all — the primary content page of the content
 * marketing surface reached crawlers and no-JS visitors empty, while the
 * in-app version worked fine. A byte-length smoke check passed, because the
 * hero markup is long enough.
 *
 * Threading this through App() as route props would mean changing the props of
 * every component between App and BlogList. A module-level channel is the
 * smaller change and is the standard shape for SSR data: prerender.mjs fills it
 * before calling render(), BlogList reads it as its initial state, and on the
 * client the module is simply empty so the ordinary fetch runs as before.
 */

/**
 * The shape BlogList's card actually renders. This is the BlogPost row as
 * scripts/prerender.mjs projects it — same columns and ordering as
 * server.cjs /api/blog-posts, so the static index and the live endpoint render
 * the same thing.
 *
 * Deliberately a separate interface from BlogPost: `content_score` and
 * `geo_score` exist on the API type but the index card never shows them, and
 * typing the prerender payload as the full BlogPost would force fabricated
 * values into the static HTML to satisfy the compiler.
 */
export interface PrerenderBlogPost {
  id: string;
  slug: string;
  title: string;
  meta_description: string;
  excerpt: string;
  read_minutes: number;
  primary_keyword: string | null;
  published_at: string;
}

let blogPosts: PrerenderBlogPost[] | null = null;
let blogDetail: PrerenderBlogDetail | null = null;

export interface PrerenderBlogDetail {
  id: string;
  slug: string;
  title: string;
  meta_title: string;
  meta_description: string;
  body_html: string;
  primary_keyword: string;
  faq: Array<{ question: string; answer: string }>;
  cta: { label: string; href: string } | null;
  published_at: string;
}

export function setPrerenderBlogPosts(posts: PrerenderBlogPost[] | null): void {
  blogPosts = posts;
}

export function getPrerenderBlogPosts(): PrerenderBlogPost[] | null {
  return blogPosts;
}

export function setPrerenderBlogDetail(post: PrerenderBlogDetail | null): void {
  blogDetail = post;
}

export function getPrerenderBlogDetail(): PrerenderBlogDetail | null {
  return blogDetail;
}