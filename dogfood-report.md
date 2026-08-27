# EcoAuditor visual and interaction QA

Audit date: 2026-08-26. Target: `https://ecoauditor.io` baseline and local production candidate. Evidence: `dogfood-output/screenshots/`.

## Result

The public marketing, legal, blog, and authentication routes rendered coherently at desktop width; the landing, contact, and demo paths were exercised on mobile. Automated accessibility inspection found zero violations after the candidate fixes. Keyboard focus reached the primary hero CTA first, and invalid demo/contact submissions displayed required-field errors.

## Findings

| ID | Severity | Surface | Finding | Disposition |
|---|---|---|---|---|
| VQA-001 | High | Mobile consent | The floating chat launcher overlapped the cookie banner before consent. | Fixed: `ChatbotWidget` does not render until consent resolves. |
| VQA-002 | High | Shared marketing header | “Book a Demo” incorrectly routed to `/contact`. | Fixed at the partial generator; regression test asserts `/demo`. |
| VQA-003 | Medium | Authentication evidence | Local candidate auth actions were disabled because production-only public InsForge configuration was intentionally absent. | Not treated as a product defect; must be rechecked on the deployed build. |
| VQA-004 | Medium | Signup capture | The first desktop signup screenshot did not show the complete form within the initial viewport. | Use a full-page/focused production capture during final live verification. |
| VQA-005 | Low | Accessibility scanner | Gradient contrast and muted autoplay semantics were scanner-incomplete, not violations. | Manually inspected; retain as a future design regression watch item. |

## Candidate evidence

- Desktop route set: home, pricing, methodology, sample report, security, demo, contact, privacy, terms, DPA, blog, login, signup, and forgot-password.
- Mobile: landing, contact validation, demo validation, first-tab focus, and consent state.
- Build under test: 14/14 prerendered routes, 25/25 test files, 220/220 tests.

The final release gate requires fresh production captures after deployment so authentication configuration and the two fixed global controls are observed on the exact live build.

## Production closeout

Fresh production captures at merge SHA `5b493e3dceb36e784b91c2be1a1eb9afe75650fa` passed two independent visual reviews. Auth pages had no configuration warning, the full signup form was visible, unresolved consent hid chat, and the shared demo CTA reached `/demo`. The later `53be5f9` follow-up changed only Railway runtime table provisioning; its consent endpoint returned 202 with no deployment errors and did not change UI assets.
