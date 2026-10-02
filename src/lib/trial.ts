import { PLANS, TRIAL_PLAN_ID } from '@/content/pricing';
import { pluralize } from './format';

// The card-free trial as the app shows it. The plan name and length come from
// content/pricing.ts, like every other surface that names the trial, so the owner's
// pending decision on the trial tier (D2) changes the wording in one place.

const DAY_MS = 24 * 60 * 60 * 1000;

const trialPlanName = () => PLANS[TRIAL_PLAN_ID].name;

function formatDay(iso: string): string | null {
  return Number.isNaN(Date.parse(iso)) ? null : new Date(iso).toLocaleDateString();
}

/**
 * Whole days left in a trial, rounded up: the last day reads 1, the moment of
 * expiry and everything after reads 0, never negative. null when there is no
 * usable end date.
 */
export function trialDaysLeft(trialEndsAt: string | null | undefined, now: Date = new Date()): number | null {
  if (!trialEndsAt) return null;
  const end = Date.parse(trialEndsAt);
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - now.getTime()) / DAY_MS));
}

/** The trial fields of the billing state. All optional so a partial reply never breaks the shell. */
export interface TrialFields {
  trialActive?: boolean | undefined;
  trialEndsAt?: string | null | undefined;
  trialEnded?: boolean | undefined;
}

export interface TrialPillModel {
  kind: 'running' | 'ended';
  /** "Starter trial: 9 days left" or "Starter trial ended". */
  label: string;
  /** The same without the plan name, for a narrow header. */
  shortLabel: string;
  /** Tooltip with the date behind the countdown, when there is one. */
  detail: string | undefined;
}

/**
 * What the app shell shows for the card-free trial, or null for nothing (a paid
 * plan, a Stripe trial, a cancelled subscription, or a reply with no trial data).
 * Computed from the end date against the clock, so a tab left open across the
 * expiry flips to "ended" without waiting for another reply.
 */
export function trialPillModel(billing: TrialFields | null | undefined, now: Date = new Date()): TrialPillModel | null {
  if (!billing) return null;
  const name = trialPlanName();
  const endedOn = billing.trialEndsAt ? formatDay(billing.trialEndsAt) : null;
  const ended: TrialPillModel = {
    kind: 'ended',
    label: `${name} trial ended`,
    shortLabel: 'Trial ended',
    detail: endedOn ? `Your ${name} trial ended on ${endedOn}.` : undefined,
  };

  if (billing.trialActive) {
    const days = trialDaysLeft(billing.trialEndsAt, now);
    if (days === null) return null;
    if (days === 0) return ended;
    const left = `${pluralize(days, 'day')} left`;
    return {
      kind: 'running',
      label: `${name} trial: ${left}`,
      shortLabel: `Trial: ${left}`,
      detail: endedOn ? `Your ${name} trial ends on ${endedOn}.` : undefined,
    };
  }
  return billing.trialEnded ? ended : null;
}

/** "Your Starter trial has ended" */
export function trialEndedHeading(): string {
  return `Your ${trialPlanName()} trial has ended`;
}

/**
 * "Your Starter trial ended on 9/28/2026." The date is the trial's end date, the same
 * field the countdown runs to (companies.trial_ends_at, as /api/billing's
 * `trialEndsAt` and the 402's `trialEndedAt`); it is left out only when there is none.
 */
export function trialEndedSentence(endedAt?: string | null): string {
  const day = endedAt ? formatDay(endedAt) : null;
  return `Your ${trialPlanName()} trial ended${day ? ` on ${day}` : ''}.`;
}

/** The paywall text for an ended trial: what happened, when, and what to do. */
export function trialEndedMessage(endedAt?: string | null): string {
  return `${trialEndedSentence(endedAt)} Choose a plan to keep importing data, viewing your dashboard and generating reports.`;
}
