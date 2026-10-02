// The production client build's version of ./routePages.ts: same names, but every
// public page except the three below is its own chunk, loaded when its route is
// first visited. vite.config.ts aliases '@/routePages' to this file for
// `vite build`; the prerender step, the tests and the dev server keep the static
// module (renderToString cannot wait for a lazy chunk).
//
// Kept eager on purpose:
//  - LandingPage is the entry's own page, and Pricing the page a visitor goes to next;
//  - Pricing also renders inside the app shell, with a prop that lazyRoute does not forward;
//  - NotFound is a few lines and answers every unknown URL.
//
// No <Suspense> wraps the public routes, on purpose. A lazy page that suspends
// with no boundary above it keeps the DOM that is already on screen until the
// chunk arrives, so a hard load of a prerendered page stays visible while its
// chunk loads instead of being replaced by a fallback; client-side navigations
// are transitions and keep the old page the same way. lazyRoute keeps the
// chunk-load recovery (retry, one reload per session) the /app pages use.
import { lazyRoute } from './lib/chunkRecovery';

export { default as LandingPage } from './pages/LandingPage';
export { default as Pricing } from './pages/Pricing';
export { default as NotFound } from './pages/NotFound';

export const BlogList = lazyRoute(() => import('./pages/BlogList'), 'BlogList');
export const BlogPostPage = lazyRoute(() => import('./pages/BlogPost'), 'BlogPost');
export const MethodologyPublic = lazyRoute(() => import('./pages/MethodologyPublic'), 'MethodologyPublic');
export const SampleReport = lazyRoute(() => import('./pages/SampleReport'), 'SampleReport');
export const Security = lazyRoute(() => import('./pages/Security'), 'Security');
export const PrivacyPolicy = lazyRoute(() => import('./pages/PrivacyPolicy'), 'PrivacyPolicy');
export const TermsOfService = lazyRoute(() => import('./pages/TermsOfService'), 'TermsOfService');
export const ContactUs = lazyRoute(() => import('./pages/ContactUs'), 'ContactUs');
export const Demo = lazyRoute(() => import('./pages/Demo'), 'Demo');
export const DataProcessingAddendum = lazyRoute(() => import('./pages/DataProcessingAddendum'), 'DataProcessingAddendum');
export const Login = lazyRoute(() => import('./pages/Login'), 'Login');
export const Signup = lazyRoute(() => import('./pages/Signup'), 'Signup');
export const ForgotPassword = lazyRoute(() => import('./pages/ForgotPassword'), 'ForgotPassword');
export const AuthCallback = lazyRoute(() => import('./pages/AuthCallback'), 'AuthCallback');
export const VerifyEmailCode = lazyRoute(() => import('./pages/VerifyEmailCode'), 'VerifyEmailCode');
