import { ComingSoon } from '../components/ComingSoon';

// ponytail: gated instead of rebuilt. This page previously rendered
// METHODOLOGY_SETTINGS and FACILITIES from mockData — fictional facilities
// ("Sacramento HQ", "Fresno Packaging", "Portland Distribution"), a fabricated
// boundary/base-year card, hardcoded "active" factor-library rows, and a
// hardcoded Scope 3 category list — to every authenticated user with no
// "sample data" label. Showing invented facilities as a customer's own config
// is the one thing a carbon-accounting product cannot do.
// Rebuild against real data (GET /api/companies/:id/facilities already exists)
// before ungating; do not restore the mockData imports.
export default function Methodology() {
  return <ComingSoon featureName="Methodology & Boundaries" />;
}
