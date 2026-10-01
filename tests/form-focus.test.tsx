// F-C-25: after a submit on /contact and /demo, keyboard focus stayed on the
// submit button, so a screen reader announced nothing new and a keyboard user
// had to hunt for what to fix. Focus now moves to the message that says what
// happened: the error summary or the first field with an error, the failed-send
// message, or the confirmation.
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ContactUs from '../src/pages/ContactUs';
import Demo from '../src/pages/Demo';
import { ConsentProvider } from '../src/lib/consent-context';
import { buttonNamed, press, setField } from './helpers/form-dom';

const leads = vi.hoisted(() => ({ submitLead: vi.fn() }));
vi.mock('../src/lib/leads', () => leads);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  leads.submitLead.mockReset().mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount(node: ReactNode) {
  await act(async () =>
    root.render(
      <MemoryRouter>
        <ConsentProvider>{node}</ConsentProvider>
      </MemoryRouter>,
    ),
  );
}

const byId = <T extends HTMLElement>(id: string) => container.querySelector<T>(`#${id}`)!;
const active = () => document.activeElement as HTMLElement;

describe('Contact form focus', () => {
  const fillValid = async () => {
    await setField(byId<HTMLInputElement>('contact-name'), 'Jane Smith');
    await setField(byId<HTMLInputElement>('contact-email'), 'jane@acme.com');
    await setField(byId<HTMLSelectElement>('contact-subject'), 'sales');
    await setField(byId<HTMLTextAreaElement>('contact-message'), 'Do you support two facilities?');
  };

  it('a failed validation puts focus on the error summary, which lists the fields to fix', async () => {
    await mount(<ContactUs />);
    await press(buttonNamed(container, /^Send message$/));

    expect(active().getAttribute('role')).toBe('alert');
    expect(active().textContent).toContain('Please fix the following');
    expect(active().textContent).toContain('Your name is required.');
    // The summary's links point at fields that exist.
    for (const link of active().querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      expect(container.querySelector(link.getAttribute('href')!), link.textContent ?? '').not.toBeNull();
    }
  });

  it('a second failed attempt moves focus back to the summary', async () => {
    await mount(<ContactUs />);
    await press(buttonNamed(container, /^Send message$/));
    byId<HTMLInputElement>('contact-name').focus();
    await press(buttonNamed(container, /^Send message$/));
    expect(active().textContent).toContain('Please fix the following');
  });

  it('a sent message puts focus on the confirmation', async () => {
    await mount(<ContactUs />);
    await fillValid();
    await press(buttonNamed(container, /^Send message$/));

    expect(leads.submitLead).toHaveBeenCalledTimes(1);
    expect(active().getAttribute('role')).toBe('status');
    expect(active().textContent).toContain('Message sent');
  });

  it('a failed send puts focus on the error, which still offers the mailbox', async () => {
    leads.submitLead.mockRejectedValue(new Error('Too many requests'));
    await mount(<ContactUs />);
    await fillValid();
    await press(buttonNamed(container, /^Send message$/));

    expect(active().getAttribute('role')).toBe('alert');
    expect(active().textContent).toContain('Too many requests');
    expect(active().querySelector('a[href^="mailto:"]')).not.toBeNull();
  });
});

describe('Demo form focus', () => {
  const submit = () => press(buttonNamed(container, /^Request demo$/));

  it('a failed validation puts focus on the first field with an error, in form order', async () => {
    await mount(<Demo />);

    await submit();
    expect(active().id).toBe('demo-name');
    expect(active().getAttribute('aria-invalid')).toBe('true');
    expect(active().getAttribute('aria-describedby')).toBe('demo-name-error');

    await setField(byId<HTMLInputElement>('demo-name'), 'Jane Smith');
    await submit();
    expect(active().id).toBe('demo-email');

    await setField(byId<HTMLInputElement>('demo-email'), 'jane@acme.com');
    await submit();
    expect(active().id).toBe('demo-company');

    await setField(byId<HTMLInputElement>('demo-company'), 'Acme Corp');
    await submit();
    // The goal is a radio group: focus lands on its first option.
    expect(active().getAttribute('name')).toBe('demo-goal');
    expect(active().getAttribute('type')).toBe('radio');
  });

  const fillValid = async () => {
    await setField(byId<HTMLInputElement>('demo-name'), 'Jane Smith');
    await setField(byId<HTMLInputElement>('demo-email'), 'jane@acme.com');
    await setField(byId<HTMLInputElement>('demo-company'), 'Acme Corp');
    await press(container.querySelector<HTMLInputElement>('input[name="demo-goal"]')!);
  };

  it('a sent request puts focus on the confirmation', async () => {
    await mount(<Demo />);
    await fillValid();
    await submit();

    expect(leads.submitLead).toHaveBeenCalledTimes(1);
    expect(active().getAttribute('role')).toBe('status');
    expect(active().textContent).toContain('Request received');
  });

  it('a failed send puts focus on the error, which still offers the mailbox', async () => {
    leads.submitLead.mockRejectedValue(new Error('Too many requests'));
    await mount(<Demo />);
    await fillValid();
    await submit();

    expect(active().getAttribute('role')).toBe('alert');
    expect(active().textContent).toContain('Too many requests');
    expect(active().querySelector('a[href^="mailto:"]')).not.toBeNull();
  });
});
