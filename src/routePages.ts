// The public pages App.tsx routes to, imported statically.
//
// This is the module the prerender step, the tests and the dev server use.
// scripts/prerender.mjs renders with renderToString(), which cannot wait for a
// lazy chunk, so every page must be present when the tree is rendered.
//
// The production client build replaces it with ./routePages.lazy.ts (see
// vite.config.ts), which exports the SAME names and loads most of them as
// route-level chunks, so a visitor on the landing page no longer downloads the
// legal pages, the sign-in forms and the rest (F-F-14). Add a page to both;
// tests/route-pages.test.ts fails when they drift.
export { default as LandingPage } from './pages/LandingPage';
export { default as Pricing } from './pages/Pricing';
export { default as NotFound } from './pages/NotFound';
export { default as BlogList } from './pages/BlogList';
export { default as BlogPostPage } from './pages/BlogPost';
export { default as MethodologyPublic } from './pages/MethodologyPublic';
export { default as SampleReport } from './pages/SampleReport';
export { default as Security } from './pages/Security';
export { default as PrivacyPolicy } from './pages/PrivacyPolicy';
export { default as TermsOfService } from './pages/TermsOfService';
export { default as ContactUs } from './pages/ContactUs';
export { default as Demo } from './pages/Demo';
export { default as DataProcessingAddendum } from './pages/DataProcessingAddendum';
export { default as Login } from './pages/Login';
export { default as Signup } from './pages/Signup';
export { default as ForgotPassword } from './pages/ForgotPassword';
export { default as AuthCallback } from './pages/AuthCallback';
export { default as VerifyEmailCode } from './pages/VerifyEmailCode';
