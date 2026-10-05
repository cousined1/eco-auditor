import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { useTheme } from '../hooks/useTheme';
import { getPrerenderBlogPosts, type PrerenderBlogPost } from '../lib/ssrData';
import { formatPublishedDate as formatDate } from '../lib/formatDate';

// PERF-006: the list endpoint ships a computed excerpt + read time instead of
// full HTML bodies — the list never renders them (detail page has its own route).
// The list endpoint also returns content_score and geo_score, which this card
// never renders. Typing the state to just what is displayed keeps the
// prerendered payload assignable without fabricating values to satisfy the
// compiler — see PrerenderBlogPost in src/lib/ssrData.ts.
type BlogPost = PrerenderBlogPost;

export default function BlogList() {
  const { theme, toggle } = useTheme();
  // Build-time posts when prerendering (see src/lib/ssrData.ts), otherwise null
  // and the fetch below fills the list as usual.
  const prerendered = getPrerenderBlogPosts();
  const [posts, setPosts] = useState<BlogPost[]>(prerendered ?? []);
  // Only "loading" when there is genuinely nothing prerendered to show.
  const [loading, setLoading] = useState(prerendered === null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // These strings must match scripts/prerender.mjs HEAD['/blog'] exactly.
    // They diverged once ("Carbon Accounting Insights" vs "Carbon Accounting
    // for SMBs"), so /blog advertised two different titles and descriptions
    // depending on whether a crawler read the static HTML or the live DOM.
    // tests/blog-prerender.test.ts asserts the two agree.
    document.title = 'Blog — Eco-Auditor | Carbon Accounting for SMBs';
    const desc = document.querySelector('meta[name="description"]') as HTMLMetaElement;
    if (desc) {
      desc.content =
        'Eco-Auditor blog: practical carbon accounting guidance for small and mid-size businesses — Scope 1-3 baselines, supplier data collection, and disclosure readiness.';
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchPosts() {
      try {
        const resp = await fetch('/api/blog-posts', { signal: AbortSignal.timeout(15000) });
        if (cancelled) return;
        if (!resp.ok) {
          // Show the server's reason, not a browser-internal string. A 15s
          // timeout rejects with a DOMException whose message is things like
          // "signal timed out" — which is not a thing to tell a reader.
          setError(resp.status >= 500
            ? 'Our blog is temporarily unavailable. Please try again shortly.'
            : 'Unable to load blog posts.');
          setLoading(false);
          return;
        }
        const json = await resp.json();
        setPosts((json.posts || []) as BlogPost[]);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        // An aborted fetch is almost always our own 15s timeout; name the
        // condition rather than leaking "signal timed out" into the page.
        const name = err instanceof Error ? err.name : '';
        setError(
          name === 'TimeoutError' || name === 'AbortError'
            ? 'The blog took too long to respond. Please try again.'
            : 'Unable to load blog posts.'
        );
        setLoading(false);
      }
    }
    void fetchPosts();
    return () => { cancelled = true; };
  }, []);

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
        {/* Hero */}
        <section className="border-b border-surface-200 dark:border-surface-800 bg-gradient-to-b from-brand-50/40 to-surface-50 dark:from-brand-950/20 dark:to-surface-950">
          <div className="max-w-4xl mx-auto px-6 py-16">
            <h1 className="text-4xl font-bold text-surface-900 dark:text-white tracking-tight">
              Eco-Auditor Blog
            </h1>
            <p className="mt-3 text-lg text-surface-600 dark:text-surface-400 max-w-2xl">
              Carbon accounting insights, compliance updates, and practical guides for SMBs navigating SB 253, CBAM, and supply chain emissions reporting.
            </p>
          </div>
        </section>

        {/* Posts */}
        <section className="max-w-4xl mx-auto px-6 py-12">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <div className="text-sm text-surface-500" role="status">Loading posts…</div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-risk-high/20 bg-risk-high/5 p-6 text-center">
              <p className="text-sm text-risk-high font-medium">Unable to load blog posts</p>
              <p className="text-xs text-surface-500 mt-1">{error}</p>
            </div>
          )}

          {!loading && !error && posts.length === 0 && (
            <div className="text-center py-20">
              <p className="text-sm text-surface-500">No posts yet. Check back soon for carbon accounting insights.</p>
            </div>
          )}

          {!loading && !error && posts.length > 0 && (
            <div className="space-y-8">
              {posts.map((post) => (
                <article
                  key={post.id}
                  className="group rounded-xl border border-surface-200 dark:border-surface-800 bg-white dark:bg-surface-900 p-6 hover:border-brand-300 dark:hover:border-brand-700 transition-colors"
                >
                  <div className="flex items-center gap-3 text-xs text-surface-500 mb-3">
                    <time dateTime={post.published_at}>{formatDate(post.published_at)}</time>
                    <span aria-hidden="true">·</span>
                    <span>{post.read_minutes} min read</span>
                    {post.primary_keyword && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="capitalize">{post.primary_keyword}</span>
                      </>
                    )}
                  </div>
                  <h2 className="text-xl font-semibold text-surface-900 dark:text-white mb-2 group-hover:text-brand-600 dark:group-hover:text-brand-400 transition-colors">
                    <Link to={`/blog/${post.slug}`} className="no-underline">
                      {post.title}
                    </Link>
                  </h2>
                  <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                    {post.excerpt}
                  </p>
                  <Link
                    to={`/blog/${post.slug}`}
                    className="inline-flex items-center gap-1 mt-4 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
                  >
                    Read more
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M3 8h10M9 4l4 4-4 4" />
                    </svg>
                  </Link>
                </article>
              ))}
            </div>
          )}
        </section>
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
