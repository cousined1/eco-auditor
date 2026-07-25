import { Link } from 'react-router-dom';

type NotFoundProps = {
  readonly title?: string;
  readonly message?: string;
  readonly homeHref?: string;
};

function NotFound({ title, message, homeHref = '/' }: NotFoundProps) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="mx-auto max-w-lg text-center">
        <p className="text-5xl font-bold text-brand-600 dark:text-brand-400">404</p>
        <h1 className="mt-4 text-xl font-semibold text-surface-900 dark:text-white">
          {title ?? 'Page not found'}
        </h1>
        <p className="mt-2 text-sm text-surface-500 dark:text-surface-400">
          {message ?? 'The page you are looking for does not exist or has moved.'}
        </p>
        <Link to={homeHref} className="btn-primary mt-6">
          Back to home
        </Link>
      </div>
    </div>
  );
}

export default NotFound;