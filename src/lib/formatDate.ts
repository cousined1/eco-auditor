/**
 * Single source of truth for rendering a published date to a reader.
 *
 * This function existed twice — once in BlogList.tsx and once in BlogPost.tsx —
 * and only one of the two copies was ever fixed. `new Date(badString)` does not
 * throw: it yields an Invalid Date, and `toLocaleDateString()` on that returns
 * the literal string "Invalid Date" rather than raising, so the try/catch the
 * second copy wrapped around it could never fire. `new Date(null)` is the epoch,
 * so a null published_at rendered as "January 1, 1970".
 *
 * A reader could see "Undated" on the blog index and "Invalid Date" under the
 * same post's title on the post itself. One copy, one behaviour.
 */
export function formatPublishedDate(iso: string | null | undefined): string {
  if (iso == null || iso === '') return 'Undated';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Undated';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}