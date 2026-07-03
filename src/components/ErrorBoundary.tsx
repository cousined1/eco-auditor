import { Component, type ErrorInfo, type ReactNode } from 'react';

type ErrorBoundaryProps = {
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
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
  }

  private handleReload = (): void => {
    this.setState({ error: null });
    if (typeof window !== 'undefined') window.location.reload();
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-50 p-6 dark:bg-surface-950">
        <div className="mx-auto max-w-lg rounded-2xl border border-surface-200 bg-white p-8 text-center shadow-sm dark:border-surface-800 dark:bg-surface-900">
          <h1 className="text-xl font-semibold text-surface-900 dark:text-white">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-surface-500 dark:text-surface-400">
            An unexpected error occurred while rendering this page. Try reloading — if the problem
            persists, contact support.
          </p>
          {import.meta.env.DEV && (
            <pre className="mt-4 max-h-48 overflow-auto rounded-lg bg-surface-100 p-3 text-left text-xs text-risk-high dark:bg-surface-800">
              {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
          )}
          <button type="button" onClick={this.handleReload} className="btn-primary mt-6">
            Reload page
          </button>
        </div>
      </div>
    );
  }
}