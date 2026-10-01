import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import Footer from '../components/Footer';
import { discardEmbeddedJson, readEmbeddedJson } from '../lib/embedded-data';
import routeMeta from '@/content/route-meta.json';

// Title and description come from src/content/route-meta.json, the file the
// prerender step writes into the HTML, so raw and JS-rendered meta agree.
const BLOG_META = routeMeta['/blog'];

// PERF-006: the list endpoint ships a computed excerpt + read time instead of
// full HTML bodies — the list never renders them (detail page has its own route).
interface BlogPost {
  id: string;
  slug: string;
  title: string;
  meta_description: string;
  excerpt: string;
  read_minutes: number;
  primary_keyword: string;
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

const EMBEDDED_LIST_ID = 'blog-list-data';

export default function BlogList() {
  // A hard load of /blog/ arrives with its post list rendered and embedded (F-F-01):
  // start from it, so replacing the server's HTML shows the same list, not a spinner.
  const [embedded] = useState(() => readEmbeddedJson<{ posts: BlogPost[] }>(EMBEDDED_LIST_ID));
  const [posts, setPosts] = useState<BlogPost[]>(embedded?.posts ?? []);
  const [loading, setLoading] = useState(embedded === null);
  const [error, setError] = useState<string | null>(null);
  const alreadyServed = useRef(embedded !== null);

  useEffect(() => {
    document.title = BLOG_META.title;
    const desc = document.querySelector('meta[name="description"]') as HTMLMetaElement;
    if (desc) desc.content = BLOG_META.description;
  }, []);

  useEffect(() => {
    discardEmbeddedJson(EMBEDDED_LIST_ID);
  }, []);

  useEffect(() => {
    // The first render already has the list from the server-rendered page.
    if (alreadyServed.current) {
      alreadyServed.current = false;
      return;
    }
    let cancelled = false;
    async function fetchPosts() {
      try {
        const resp = await fetch('/api/blog-posts');
        if (cancelled) return;
        if (!resp.ok) {
          setError('Failed to load blog posts');
          setLoading(false);
          return;
        }
        const json = await resp.json();
        setPosts((json.posts || []) as BlogPost[]);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load blog posts');
        setLoading(false);
      }
    }
    void fetchPosts();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex flex-col">
      <Header variant="marketing" />

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
                    <Link to={`/blog/${post.slug}/`} className="no-underline">
                      {post.title}
                    </Link>
                  </h2>
                  <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">
                    {post.excerpt}
                  </p>
                  <Link
                    to={`/blog/${post.slug}/`}
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