import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { safeHref, singleH1Body } from '../lib/blog-html';
import { discardEmbeddedJson, readEmbeddedJson } from '../lib/embedded-data';
import { applyPageHead, type PageHead } from '../lib/page-head';

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  meta_title: string;
  meta_description: string;
  body_html: string;
  primary_keyword: string;
  faq: Array<{ question: string; answer: string }>;
  internal_links: Array<{ url: string; anchor: string }>;
  external_links: Array<{ url: string; anchor: string }>;
  cta: { label: string; href: string };
  content_score: number | null;
  geo_score: number | null;
  published_at: string;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
}

function estimateReadTime(html: string): string {
  const bounded = html.length > 100_000 ? html.slice(0, 100_000) : html;
  const text = bounded.replace(/<[^\n>]*>/g, ' ');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const mins = Math.max(1, Math.round(words / 200));
  return `${mins} min read`;
}

// A post as the server sends it: embedded in the server-rendered page and returned
// by GET /api/blog-posts/:slug. `head` is the title, description and canonical the
// server rendered the page with.
interface PostPayload {
  post: BlogPost;
  head: PageHead;
}

const EMBEDDED_POST_ID = 'blog-post-data';

export default function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  // A hard load of /blog/<slug>/ arrives with its post rendered and embedded: start
  // from it, so replacing the server's HTML shows the same article, not a spinner.
  const [embedded] = useState(() => {
    const served = readEmbeddedJson<PostPayload>(EMBEDDED_POST_ID);
    return served && served.post.slug === slug ? served : null;
  });
  const [payload, setPayload] = useState<PostPayload | null>(embedded);
  const [loading, setLoading] = useState(embedded === null);
  const [error, setError] = useState<string | null>(null);
  const servedSlug = useRef(embedded?.post.slug);
  const post = payload?.post ?? null;
  const head = payload?.head;
  // The page header owns the post's single H1; stored bodies repeat it (F-C-21).
  const bodyHtml = useMemo(() => (post ? singleH1Body(post.body_html, post.title) : ''), [post]);
  // The server already empties a call to action that is not a path or an https URL;
  // the page checks again before it makes a link of one (D-W2A-5).
  const ctaHref = safeHref(post?.cta?.href);

  useEffect(() => {
    discardEmbeddedJson(EMBEDDED_POST_ID);
  }, []);

  useEffect(() => {
    if (!slug) return;
    // The first render already has this post from the server-rendered page.
    const alreadyServed = servedSlug.current === slug;
    servedSlug.current = undefined;
    if (alreadyServed) return;
    let cancelled = false;
    async function fetchPost() {
      try {
        const resp = await fetch(`/api/blog-posts/${encodeURIComponent(slug ?? '')}`);
        if (cancelled) return;
        if (!resp.ok) {
          setError(resp.status === 404 ? 'Post not found' : 'Failed to load post');
          setLoading(false);
          return;
        }
        setPayload((await resp.json()) as PostPayload);
        setError(null);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load post');
        setLoading(false);
      }
    }
    void fetchPost();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Title, description, canonical and og:* for a post reached by client-side
  // navigation. The server's JSON-LD (Article, FAQPage) is part of the page it
  // rendered; this page no longer adds its own FAQPage, which made every post
  // declare two.
  useEffect(() => {
    if (!head) return;
    return applyPageHead(head);
  }, [head]);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex flex-col">
      <Header variant="marketing" />

      <main id="main-content" tabIndex={-1} className="flex-1">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="text-sm text-surface-500" role="status">Loading…</div>
          </div>
        )}

        {error && !loading && (
          <div className="max-w-2xl mx-auto px-6 py-20 text-center">
            <h1 className="text-2xl font-bold text-surface-900 dark:text-white mb-3">{error}</h1>
            <p className="text-sm text-surface-500 mb-6">
              The post you're looking for may have been moved or doesn't exist.
            </p>
            <Link to="/blog/" className="btn-primary text-sm !py-2 !px-5 inline-flex">
              Back to blog
            </Link>
          </div>
        )}

        {post && !loading && (
          <>
            {/* Hero */}
            <article>
              <header className="border-b border-surface-200 dark:border-surface-800 bg-gradient-to-b from-brand-50/40 to-surface-50 dark:from-brand-950/20 dark:to-surface-950">
                <div className="max-w-3xl mx-auto px-6 py-12">
                  <Link
                    to="/blog/"
                    className="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 transition-colors mb-6"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M13 8H3M7 4L3 8l4 4" />
                    </svg>
                    All posts
                  </Link>
                  <div className="flex items-center gap-3 text-xs text-surface-500 mb-4">
                    <time dateTime={post.published_at}>{formatDate(post.published_at)}</time>
                    <span aria-hidden="true">·</span>
                    <span>{estimateReadTime(post.body_html)}</span>
                    {post.primary_keyword && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="capitalize">{post.primary_keyword}</span>
                      </>
                    )}
                  </div>
                  <h1 className="text-3xl md:text-4xl font-bold text-surface-900 dark:text-white tracking-tight leading-tight">
                    {post.title}
                  </h1>
                  <p className="mt-4 text-lg text-surface-600 dark:text-surface-400 leading-relaxed">
                    {post.meta_description}
                  </p>
                </div>
              </header>

              {/* Body */}
              <div className="max-w-3xl mx-auto px-6 py-12">
                <div
                  className="max-w-none [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-surface-900 dark:[&_h2]:text-white [&_h2]:mt-10 [&_h2]:mb-4 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-surface-900 dark:[&_h3]:text-white [&_h3]:mt-8 [&_h3]:mb-3 [&_p]:text-surface-700 dark:[&_p]:text-surface-300 [&_p]:leading-relaxed [&_p]:my-4 [&_a]:text-brand-600 dark:[&_a]:text-brand-400 [&_a]:no-underline hover:[&_a]:underline [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_li]:text-surface-700 dark:[&_li]:text-surface-300 [&_strong]:text-surface-900 dark:[&_strong]:text-white [&_blockquote]:border-l-4 [&_blockquote]:border-brand-400 [&_blockquote]:pl-4 [&_blockquote]:text-surface-600 dark:[&_blockquote]:text-surface-400 [&_blockquote]:italic"
                  dangerouslySetInnerHTML={{ __html: bodyHtml }}
                />

                {/* FAQ section */}
                {post.faq && post.faq.length > 0 && (
                  <section className="mt-12 pt-8 border-t border-surface-200 dark:border-surface-800">
                    <h2 className="text-2xl font-semibold text-surface-900 dark:text-white mb-6">
                      Frequently Asked Questions
                    </h2>
                    <div className="space-y-6">
                      {post.faq.map((f, i) => (
                        <div key={i}>
                          <h3 className="text-lg font-medium text-surface-900 dark:text-white mb-2">
                            {f.question}
                          </h3>
                          <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                            {f.answer}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* CTA */}
                {ctaHref && (
                  <section className="mt-12 rounded-xl bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 p-8 text-center">
                    <Link
                      to={ctaHref}
                      className="btn-primary text-sm !py-3 !px-8 inline-flex"
                    >
                      {post.cta.label || 'Get started'}
                    </Link>
                  </section>
                )}

                {/* Back link */}
                <div className="mt-12 pt-8 border-t border-surface-200 dark:border-surface-800">
                  <Link
                    to="/blog/"
                    className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M13 8H3M7 4L3 8l4 4" />
                    </svg>
                    Back to all posts
                  </Link>
                </div>
              </div>
            </article>
          </>
        )}
      </main>

      <Footer />
    </div>
  );
}