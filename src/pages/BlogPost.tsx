import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { useTheme } from '../hooks/useTheme';
import { formatPublishedDate } from '../lib/formatDate';
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

function estimateReadTime(html: string): string {
  // Guard the null body: this runs during render, so a post whose body_html is
  // missing threw a TypeError here and took the whole page into the
  // ErrorBoundary — an empty article reads far better than a blank site.
  const bounded = String(html || '').slice(0, 100_000);
  const text = bounded.replace(/<[^\n>]*>/g, ' ');
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const mins = Math.max(1, Math.round(words / 200));
  return `${mins} min read`;
}

/** Post state, tagged with the slug it describes so it can be discarded. */
type PostState = {
  slug: string | null;
  post: BlogPost | null;
  loading: boolean;
  error: string | null;
};

export default function BlogPostPage() {
  const { slug } = useParams<{ slug: string }>();
  const { theme, toggle } = useTheme();
  // One state object, tagged with the slug it belongs to. A param change on
  // the same route (/blog/a -> /blog/b) REUSES this component instead of
  // remounting it, so state describing the previous slug used to survive: the
  // error and article blocks are independent conditions, so arriving at a
  // second post after a 404 left "Post not found" rendered above an article
  // that had loaded correctly, and `loading` never went back to true so that
  // stale error was shown during the next fetch instead of "Loading...".
  //
  // Discarding it during render (rather than in an effect) is React's
  // documented adjustment pattern: the component re-renders immediately with
  // the reset state and never commits a frame showing the old slug's post.
  const [state, setState] = useState<PostState>({ slug: null, post: null, loading: true, error: null });
  const currentSlug = slug ?? null;
  if (state.slug !== currentSlug) {
    setState({ slug: currentSlug, post: null, loading: true, error: null });
  }
  const { post, loading, error } = state;

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    // Snapshot the shell's own description before this page overwrites it. The
    // old cleanup restored document.title but not the meta description, so a
    // post's description leaked onto every page navigated to afterwards.
    const descEl = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    const previousDescription = descEl ? descEl.content : null;

    async function fetchPost() {
      try {
        const resp = await fetch(`/api/blog-posts/${encodeURIComponent(slug ?? '')}`, { signal: AbortSignal.timeout(15000) });
        if (cancelled) return;
        if (!resp.ok) {
          setState((s) => (s.slug === slug ? { ...s, error: resp.status === 404 ? 'Post not found' : 'Failed to load post', loading: false } : s));
          return;
        }
        const json = await resp.json();
        const p = json.post as BlogPost;
        if (cancelled) return;
        setState((s) => (s.slug === slug ? { ...s, post: p, loading: false } : s));
        document.title = p.meta_title || `${p.title} — Eco-Auditor Blog`;
        if (descEl) descEl.content = p.meta_description || '';
      } catch (err) {
        if (cancelled) return;
        setState((s) => (s.slug === slug ? { ...s, error: err instanceof Error ? err.message : 'Failed to load post', loading: false } : s));
      }
    }
    void fetchPost();
    return () => {
      cancelled = true;
      document.title = 'Eco-Auditor Blog';
      if (descEl && previousDescription !== null) descEl.content = previousDescription;
    };
  }, [slug]);

  // Inject FAQ structured data if available
  useEffect(() => {
    if (!post?.faq || post.faq.length === 0) return;
    const faqSchema = {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: post.faq.map((f) => ({
        '@type': 'Question',
        name: f.question,
        acceptedAnswer: { '@type': 'Answer', text: f.answer },
      })),
    };
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(faqSchema);
    document.head.appendChild(script);
    return () => {
      document.head.removeChild(script);
    };
  }, [post]);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex flex-col">
      <Header
        variant="marketing"
        extra={
          <button
            type="button"
            onClick={toggle}
            className="p-1.5 rounded-lg hover:bg-surface-100 dark:hover:bg-surface-800 text-surface-500 transition-colors"
            aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          >
            {theme === 'light' ? <MoonIcon /> : <SunIcon />}
          </button>
        }
      />

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
            <Link to="/blog" className="btn-primary text-sm !py-2 !px-5 inline-flex">
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
                    to="/blog"
                    className="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 transition-colors mb-6"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M13 8H3M7 4L3 8l4 4" />
                    </svg>
                    All posts
                  </Link>
                  <div className="flex items-center gap-3 text-xs text-surface-500 mb-4">
                    <time dateTime={post.published_at}>{formatPublishedDate(post.published_at)}</time>
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
                  dangerouslySetInnerHTML={{ __html: post.body_html }}
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
                {post.cta && post.cta.href && (
                  <section className="mt-12 rounded-xl bg-brand-50 dark:bg-brand-900/20 border border-brand-200 dark:border-brand-800 p-8 text-center">
                    <Link
                      to={post.cta.href}
                      className="btn-primary text-sm !py-3 !px-8 inline-flex"
                    >
                      {post.cta.label || 'Get started'}
                    </Link>
                  </section>
                )}

                {/* Back link */}
                <div className="mt-12 pt-8 border-t border-surface-200 dark:border-surface-800">
                  <Link
                    to="/blog"
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

function MoonIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 12.5A5.5 5.5 0 018 2.5a5.5 5.5 0 010 11z"/></svg>;
}
function SunIcon() {
  return <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="3.5"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41"/></svg>;
}
