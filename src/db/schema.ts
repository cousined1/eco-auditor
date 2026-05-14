import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Maps InsForge user identity to Stripe customer ID for server-side billing.
// Server derives stripe_customer_id from the authenticated user — never trusts client input.
// InsForge is the canonical datastore for all other application data; this table exists
// only because Stripe customer mapping needs a Postgres lookup the InsForge SDK does not provide.
export const users = pgTable('users', {
  insforgeUserId: uuid('insforge_user_id').primaryKey(),
  stripeCustomerId: text('stripe_customer_id'),
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
