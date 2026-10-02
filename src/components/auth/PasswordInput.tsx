import { useId, useState } from 'react';
import { authInputClass, authLabelClass } from './authHelpers';

type PasswordInputProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Optional: the visible label names the field, so no placeholder is needed. */
  placeholder?: string;
  autoComplete: 'current-password' | 'new-password';
  disabled?: boolean;
  required?: boolean;
  /** Forwarded to the input so Signup keeps its native length constraint. */
  minLength?: number;
  /** Set when the field currently fails validation (e.g. passwords differ). */
  invalid?: boolean;
  /** id of an external error element, listed first in aria-describedby. */
  errorId?: string;
  /** id of static helper text (e.g. the password rule), listed after the error. */
  hintId?: string;
  /** Lets a form validate when the user leaves the field instead of on every keystroke. */
  onBlur?: () => void;
  label: string;
  /** Rendered under the field — hint text, strength meter, or a link row. */
  children?: React.ReactNode;
};

/**
 * Password field with a show/hide toggle.
 *
 * A masked field with no way to reveal it makes typos invisible, which is worst
 * on the signup and reset screens where the value cannot be verified against
 * anything. All four password inputs in the app previously had no toggle.
 *
 * Accessibility notes:
 * - The button is a real <button type="button"> so it never submits the form,
 *   and it stays in the tab order between the field and whatever follows.
 * - aria-pressed communicates the toggle state; aria-label says what the button
 *   will DO, which is what screen readers announce on focus.
 * - The icon is aria-hidden: the button already has an accessible name, so
 *   exposing the SVG would just repeat it.
 * - Toggling does not move focus, so a keyboard user can reveal, keep typing,
 *   and re-hide without leaving the field.
 */
export function PasswordInput({
  id,
  value,
  onChange,
  placeholder,
  autoComplete,
  disabled = false,
  required = true,
  minLength,
  invalid = false,
  errorId,
  hintId,
  onBlur,
  label,
  children,
}: PasswordInputProps) {
  const [revealed, setRevealed] = useState(false);
  const visibilityHintId = useId();
  const describedBy = [errorId, hintId, visibilityHintId].filter(Boolean).join(' ');

  return (
    <div>
      <label htmlFor={id} className={authLabelClass}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={revealed ? 'text' : 'password'}
          autoComplete={autoComplete}
          required={required}
          {...(minLength === undefined ? {} : { minLength })}
          {...(placeholder === undefined ? {} : { placeholder })}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...(onBlur ? { onBlur } : {})}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          // pr-12 keeps the text clear of the toggle button.
          className={`${authInputClass} pr-12`}
        />
        <button
          type="button"
          onClick={() => setRevealed((shown) => !shown)}
          disabled={disabled}
          aria-pressed={revealed}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          aria-controls={id}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-surface-500 transition-colors hover:text-surface-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-r-lg disabled:opacity-60 dark:text-surface-400 dark:hover:text-surface-200"
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
      <span id={visibilityHintId} className="sr-only">
        {revealed ? 'Password is visible' : 'Password is hidden'}
      </span>
      {children}
    </div>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1 1 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178a1 1 0 0 1 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243" />
    </svg>
  );
}
