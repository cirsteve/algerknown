import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { ThemeProvider } from '../../context/ThemeContext';

vi.mock('../../lib/ragApi', () => ({
  checkRagConnection: vi.fn(),
  getRagApiUrl: vi.fn(() => 'http://localhost:4735'),
  setRagApiUrl: vi.fn(),
}));

import { checkRagConnection } from '../../lib/ragApi';

const navItems = [
  { path: '/', label: 'Dashboard', icon: '📊', requiresRag: false },
  { path: '/search', label: 'Search', icon: '🔍', requiresRag: false },
  { path: '/jobs', label: 'Jobs', icon: '⚡', requiresRag: true, badge: 3 },
  { path: '/traces', label: 'Traces', icon: '📡', requiresRag: true },
];

interface ShellOptions {
  route?: string;
  connected?: boolean;
}

async function renderShell({ route = '/', connected = true }: ShellOptions = {}) {
  vi.mocked(checkRagConnection).mockResolvedValue({
    connected,
    status: connected ? { documents_indexed: 12 } : undefined,
  } as Awaited<ReturnType<typeof checkRagConnection>>);

  const utils = render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[route]}>
        <Sidebar navItems={navItems} />
      </MemoryRouter>
    </ThemeProvider>
  );

  // Let the mount-time connection check settle before anything is asserted.
  await act(async () => {
    await Promise.resolve();
  });

  return utils;
}

const openMenu = () => screen.getByRole('button', { name: 'Open navigation menu' });
const drawer = () => screen.queryByRole('dialog', { name: 'Main navigation' });

beforeEach(() => {
  vi.mocked(checkRagConnection).mockResolvedValue({
    connected: true,
    status: { documents_indexed: 12 },
  } as Awaited<ReturnType<typeof checkRagConnection>>);
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('Sidebar shell', () => {
  it('switches surfaces at the md breakpoint rather than at a custom width', async () => {
    const { container } = await renderShell();

    // The 768px switch is the cohort's contract; pin it so a refactor that
    // silently moves the breakpoint fails here instead of on a phone.
    const header = container.querySelector('header');
    expect(header?.className).toContain('md:hidden');

    const aside = container.querySelector('aside');
    expect(aside?.className).toContain('hidden');
    expect(aside?.className).toContain('md:flex');
    expect(aside?.className).toContain('w-64');
  });

  it('keeps every route reachable from the drawer', async () => {
    await renderShell();
    await userEvent.click(openMenu());

    const panel = drawer();
    expect(panel).not.toBeNull();
    for (const item of navItems) {
      expect(within(panel!).getByText(item.label)).toBeDefined();
    }
  });

  it('marks the active route in the drawer as well as the sidebar', async () => {
    await renderShell({ route: '/jobs' });

    // Sidebar only while the drawer is closed, both surfaces once it is open.
    expect(screen.getAllByRole('link', { current: 'page' })).toHaveLength(1);
    await userEvent.click(openMenu());
    expect(screen.getAllByRole('link', { current: 'page' })).toHaveLength(2);
  });

  it('carries the job badge and the connection readout into the drawer', async () => {
    await renderShell();
    await userEvent.click(openMenu());

    const panel = within(drawer()!);
    expect(panel.getByText('3')).toBeDefined();
    expect(panel.getByText('RAG (12 docs)')).toBeDefined();
  });

  it('explains RAG routes that are unreachable while the backend is offline', async () => {
    await renderShell({ connected: false });
    await userEvent.click(openMenu());

    const traces = within(drawer()!).getByText('Traces').closest('[aria-disabled="true"]');
    expect(traces).not.toBeNull();
    expect(traces?.getAttribute('title')).toBe('RAG backend offline');

    // A disabled route must not be a link in either surface.
    expect(screen.queryByRole('link', { name: /Traces/ })).toBeNull();
  });

  it('moves focus into the drawer on open and back to the trigger on close', async () => {
    await renderShell();
    const trigger = openMenu();

    await userEvent.click(trigger);
    const close = screen.getByRole('button', { name: 'Close navigation menu' });
    expect(document.activeElement).toBe(close);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    await userEvent.click(close);
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('dismisses on Escape and on the backdrop', async () => {
    const { container } = await renderShell();

    await userEvent.click(openMenu());
    await userEvent.keyboard('{Escape}');
    expect(drawer()).toBeNull();
    expect(document.activeElement).toBe(openMenu());

    await userEvent.click(openMenu());
    const backdrop = container.querySelector('[aria-hidden="true"].absolute.inset-0');
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);
    expect(drawer()).toBeNull();
  });

  it('dismisses when a route is selected', async () => {
    await renderShell();
    await userEvent.click(openMenu());

    await userEvent.click(within(drawer()!).getByRole('link', { name: /Search/ }));
    expect(drawer()).toBeNull();
  });

  it('suppresses background scrolling and restores what the document had', async () => {
    document.body.style.overflow = 'auto';
    await renderShell();

    await userEvent.click(openMenu());
    expect(document.body.style.overflow).toBe('hidden');

    await userEvent.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('auto');
  });

  it('cycles Tab within the drawer instead of leaking to the page behind it', async () => {
    await renderShell();
    await userEvent.click(openMenu());

    const panel = drawer()!;
    const focusable = Array.from(
      panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    expect(first).not.toBe(last);

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('shows the proxied endpoint read-only instead of a settings form that does nothing', async () => {
    await renderShell();
    await userEvent.click(openMenu());

    const panel = within(drawer()!);
    await userEvent.click(panel.getByRole('button', { name: /RAG \(12 docs\)/ }));

    // setRagApiUrl is a no-op and the endpoint is fixed by the server-side
    // proxy, so an editable field and a Save button would only pretend to
    // reconfigure it.
    expect(panel.queryByRole('textbox')).toBeNull();
    expect(panel.queryByRole('button', { name: /save/i })).toBeNull();
    expect(panel.getByText('http://localhost:4735')).toBeDefined();

    // Re-checking the connection is the one action that was ever real.
    vi.mocked(checkRagConnection).mockClear();
    await userEvent.click(panel.getByRole('button', { name: 'Retry' }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(checkRagConnection).toHaveBeenCalled();
  });

  it('offers the theme control in every navigation surface', async () => {
    const { container } = await renderShell();

    // Mobile header and desktop sidebar footer both carry one, so the control
    // is reachable at any width without opening anything.
    const header = container.querySelector('header')!;
    const aside = container.querySelector('aside')!;
    expect(within(header).getByRole('group', { name: 'Color theme' })).toBeDefined();
    expect(within(aside).getByRole('group', { name: 'Color theme' })).toBeDefined();
    expect(screen.getAllByRole('group', { name: 'Color theme' })).toHaveLength(2);

    await userEvent.click(openMenu());
    expect(within(drawer()!).getByRole('group', { name: 'Color theme' })).toBeDefined();

    const dark = within(header).getByRole('button', { name: 'Dark theme' });
    await userEvent.click(dark);
    expect(dark.getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    // The surfaces share one preference rather than each holding their own.
    const drawerDark = within(drawer()!).getByRole('button', { name: 'Dark theme' });
    expect(drawerDark.getAttribute('aria-pressed')).toBe('true');
  });
});
