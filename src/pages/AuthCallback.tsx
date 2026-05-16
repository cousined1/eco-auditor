import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { insforge } from '../lib/insforge';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function finishOAuth() {
      const { data, error: authError } = await insforge.auth.getCurrentUser();
      if (cancelled) return;

      if (authError || !data?.user) {
        setError(authError?.message || 'We could not finish signing you in. Please try again.');
        return;
      }

      navigate('/app', { replace: true });
    }

    void finishOAuth();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-surface-50 dark:bg-surface-950 flex items-center justify-center px-6">
      <div className="card max-w-md text-center">
        <div className="mx-auto mb-4 h-10 w-10 rounded-full border-2 border-brand-600 border-t-transparent animate-spin" />
        <h1 className="text-lg font-semibold text-surface-900 dark:text-white">
          {error ? 'Sign-in needs another try' : 'Finishing sign-in'}
        </h1>
        <p className="mt-2 text-sm text-surface-500">
          {error || 'Securely confirming your Eco-Auditor session.'}
        </p>
        {error && (
          <Link to="/login" className="btn-primary mt-5 inline-flex">
            Back to login
          </Link>
        )}
      </div>
    </div>
  );
}
