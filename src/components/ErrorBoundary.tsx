import { Component, type ErrorInfo, type ReactNode } from 'react';
import { isChunkLoadError, isOffline } from '../lib/chunkRecovery';
import { reportClientError } from '../lib/client-error-report';

type ErrorBoundaryProps = {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
  /** Fill the page area of the app shell instead of taking over the whole screen, so the sidebar survives. */
  readonly inShell?: boolean;
  /** While an error is showing, a change of this value (the route) retries the children. */
  readonly resetKey?: string;
  /** Runs just before the children are retried, e.g. to drop cached failed imports. */
  readonly onReset?: () => void;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught render error', { error, info });
    // The operator hears about it too, not only this visitor's console (F-G-08).
    reportClientError(error, 'boundary');
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) this.handleRetry();
  }

  private handleRetry = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  private handleReload = (): void => {
    this.setState({ error: null });
    if (typeof window !== 'undefined') window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    // A chunk that will not load is not a bug in the page: the connection
    // dropped, or the app was redeployed after this tab opened. Offline, a
    // reload would swap the app for the browser's own offline page, so the
    // answer there is to try again in place.
    const chunkFailure = isChunkLoadError(error);
    const offline = chunkFailure && isOffline();

    return (
      <div
        className={
          this.props.inShell
            ? 'flex min-h-[50vh] items-center justify-center p-6'
            : 'flex min-h-screen items-center justify-center bg-surface-50 p-6 dark:bg-surface-950'
        }
      >
        <div
          role="alert"
          className="mx-auto max-w-lg rounded-2xl border border-surface-200 bg-white p-8 text-center shadow-sm dark:border-surface-800 dark:bg-surface-900"
        >
          <h1 className="text-xl font-semibold text-surface-900 dark:text-white">
            {offline ? 'You appear to be offline' : chunkFailure ? 'This page needs a reload' : 'Something went wrong'}
          </h1>
          <p className="mt-2 text-sm text-surface-600 dark:text-surface-400">
            {offline ? (
              'This page could not be loaded because your connection dropped. Reconnect, then try again.'
            ) : chunkFailure ? (
              'Part of this page could not be loaded. That usually means Eco-Auditor was updated after this tab was opened. Reload to get the latest version.'
            ) : (
              <>
                An unexpected error occurred while rendering this page. Try reloading — if the problem
                persists,{' '}
                <a href="/contact/" className="underline underline-offset-2 text-brand-700 dark:text-brand-300">
                  contact support
                </a>
                .
              </>
            )}
          </p>
          {import.meta.env.DEV && (
            <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-surface-100 p-3 text-left text-xs text-risk-high dark:bg-surface-800">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
          )}
          <button type="button" onClick={offline ? this.handleRetry : this.handleReload} className="btn-primary mt-6">
            {offline ? 'Try again' : 'Reload page'}
          </button>
        </div>
      </div>
    );
  }
}
