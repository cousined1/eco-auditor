import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';

type ErrorBoundaryProps = {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  private alertRef = createRef<HTMLDivElement>();

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught render error', { error, info });
  }

  private handleReload = (): void => {
    this.setState({ error: null });
    if (typeof window !== 'undefined') window.location.reload();
  };

  // EB-02: App.tsx focuses #main-content on every navigation, but
  // TrackPageViews lives INSIDE this boundary, so it is unmounted by the very
  // error it would have announced. Without moving focus here, focus falls back
  // to <body>, a screen reader announces nothing, and the role="alert" fires
  // before the user has any reason to be listening.
  componentDidUpdate(_prevProps: ErrorBoundaryProps, prevState: ErrorBoundaryState): void {
    if (!prevState.error && this.state.error && this.alertRef.current) {
      this.alertRef.current.focus();
    }
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <div
        className="flex min-h-screen items-center justify-center bg-surface-50 p-6 dark:bg-surface-950"
        role="alert"
        aria-live="assertive"
      >
        <div
          id="main-content"
          ref={this.alertRef}
          tabIndex={-1}
          className="mx-auto max-w-lg rounded-2xl border border-surface-200 bg-white p-8 text-center shadow-sm dark:border-surface-800 dark:bg-surface-900"
        >
          <h1 className="text-xl font-semibold text-surface-900 dark:text-white">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-surface-600 dark:text-surface-400">
            An unexpected error occurred while rendering this page. Try reloading — if the problem
            persists, contact support.
          </p>
          {import.meta.env.DEV && (
            <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-surface-100 p-3 text-left text-xs text-risk-high dark:bg-surface-800">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
          )}
          {/* EB-01: reloading is the only control this screen used to have, and
              when the crash is deterministic for the URL — a malformed record, a
              lazy() chunk that a deploy replaced — it reproduces the identical
              screen. The copy said "contact support" while unmounting every
              support affordance in the product with the tree, leaving a customer
              with no way forward but the address bar. These are the same
              affordances Footer.tsx offers, so the error screen can actually
              keep the promise its own copy makes. */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button type="button" onClick={this.handleReload} className="btn-primary">
              Reload page
            </button>
            <a href="/" className="btn-secondary">
              Go to home
            </a>
            <a href="/contact" className="btn-secondary">
              Contact support
            </a>
            <a
              href="mailto:hello@developer312.com?subject=Error%20on%20ecoauditor.io"
              className="text-xs text-surface-500 underline underline-offset-2 hover:text-surface-800 dark:text-surface-400 dark:hover:text-surface-200"
            >
              hello@developer312.com
            </a>
          </div>
        </div>
      </div>
    );
  }
}