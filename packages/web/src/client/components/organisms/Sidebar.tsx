import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { Link, useLocation } from 'react-router-dom';
import { NavItem, NavGroup } from '../molecules/NavItem';
import { StatusIndicator } from '../atoms/StatusIndicator';
import { checkRagConnection, getRagApiUrl } from '../../lib/ragApi';
import { Button } from '../atoms/Button';
import { useTheme, type ThemePreference } from '../../context/ThemeContext';

interface NavItemConfig {
  path: string;
  label: string;
  icon: ReactNode;
  requiresRag?: boolean;
  badge?: number;
}

interface SidebarProps {
  navItems: NavItemConfig[];
  className?: string;
}

type ConnectionStatus = 'online' | 'offline' | 'checking' | 'unknown';

/** What Tab cycles through while the drawer holds focus. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/*
 * Deliberately not `offsetParent !== null`: that is null for everything inside a
 * `position: fixed` subtree, which is exactly where the drawer lives, so it
 * would empty the tab ring instead of filtering it.
 */
function isVisible(element: HTMLElement): boolean {
  if (element.hasAttribute('hidden')) return false;
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

/**
 * Polls the RAG backend once for the whole shell.
 *
 * The desktop sidebar and the mobile drawer are two views of this single state,
 * so they can never disagree about which routes are reachable or how many
 * documents are indexed - and opening the drawer does not start a second poll.
 */
function useRagConnection() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [documentsIndexed, setDocumentsIndexed] = useState<number>(0);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    setChecking(true);
    const result = await checkRagConnection();
    setConnected(result.connected);
    if (result.status) {
      setDocumentsIndexed(result.status.documents_indexed);
    }
    setChecking(false);
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  const status: ConnectionStatus = checking
    ? 'checking'
    : connected === null
      ? 'unknown'
      : connected
        ? 'online'
        : 'offline';

  return { connected, documentsIndexed, checking, status, refresh };
}

type RagConnection = ReturnType<typeof useRagConnection>;

const THEME_CHOICES: ReadonlyArray<{ value: ThemePreference; label: string; icon: string }> = [
  { value: 'light', label: 'Light', icon: '☀' },
  { value: 'dark', label: 'Dark', icon: '☾' },
  { value: 'system', label: 'System', icon: '🖵' },
];

/**
 * ThemeControl - the shell's compact Light/Dark/System switch.
 *
 * Mirrors `ThemeToggle` from ThemeContext and shares its state, but only the
 * selected option carries a visible label. That keeps the group under ~130px so
 * it still fits beside the brand and the menu trigger in a 320px header, while
 * the current choice stays readable rather than being encoded in an icon alone.
 * The unselected options keep their names in `aria-label`/`title`.
 */
function ThemeControl({ className = '' }: { className?: string }) {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="group"
      aria-label="Color theme"
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-lg border border-edge bg-surface-raised p-0.5 ${className}`}
    >
      {THEME_CHOICES.map((option) => {
        const selected = preference === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            aria-label={`${option.label} theme`}
            title={`${option.label} theme`}
            onClick={() => setPreference(option.value)}
            className={`
              inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium transition-colors
              focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface-raised
              ${selected
                ? 'bg-accent text-accent-fg'
                : 'text-content-muted hover:bg-control hover:text-content active:bg-control-hover'
              }
            `}
          >
            <span aria-hidden="true">{option.icon}</span>
            {selected && <span>{option.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

interface NavListProps {
  navItems: NavItemConfig[];
  connection: RagConnection;
  /** Supplied by the drawer so activating a route dismisses it. */
  onNavigate?: () => void;
}

/** The route list, rendered the same way in the sidebar and in the drawer. */
function NavList({ navItems, connection, onNavigate }: NavListProps) {
  const { connected, status } = connection;

  return (
    <NavGroup>
      {navItems.map(item => (
        <li key={item.path}>
          <NavItem
            to={item.path}
            icon={item.icon}
            label={item.label}
            badge={item.badge}
            onClick={onNavigate}
            disabled={item.requiresRag && connected === false}
            disabledReason={
              !item.requiresRag
                ? undefined
                : status === 'offline'
                  ? 'RAG backend offline'
                  : status === 'checking' || status === 'unknown'
                    ? 'Checking RAG backend...'
                    : undefined
            }
          />
        </li>
      ))}
    </NavGroup>
  );
}

/**
 * RagStatusFooter - connection readout plus backend details.
 *
 * Each mount keeps its own popover state, but they all read the one shared
 * connection from `useRagConnection`.
 *
 * The endpoint is shown, not edited. RAG requests are proxied through the web
 * server, so `getRagApiUrl()` is the fixed `/rag` prefix and `setRagApiUrl` is a
 * no-op - an editable field and a "Save" button here would only pretend to
 * reconfigure anything. Re-checking the connection is the one action that was
 * ever real, so that is the one the popover offers.
 */
function RagStatusFooter({ connection }: { connection: RagConnection }) {
  const { connected, documentsIndexed, checking, status, refresh } = connection;
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setSettingsOpen(!settingsOpen)}
        aria-expanded={settingsOpen}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <StatusIndicator status={status} />
        <span className="min-w-0 flex-1 truncate text-left text-content-muted">
          {checking
            ? 'Checking...'
            : connected === null
              ? 'RAG Unknown'
              : connected
                ? `RAG (${documentsIndexed} docs)`
                : 'RAG Offline'}
        </span>
        <span aria-hidden="true" className="text-content-subtle">⚙️</span>
      </button>

      {settingsOpen && (
        <div className="absolute bottom-full left-0 right-0 z-50 mb-2 rounded-lg border border-edge bg-surface-raised p-4 shadow-xl">
          <h3 className="mb-3 font-medium text-content-strong">RAG Backend</h3>

          <div className="space-y-3">
            <div>
              <span className="mb-1 block text-xs text-content-muted">Endpoint</span>
              <p className="break-all rounded border border-edge bg-surface-sunken px-2 py-1 font-mono text-sm text-content">
                {getRagApiUrl()}
              </p>
            </div>

            <p className="text-xs text-content-subtle">
              Requests are proxied through the web server, so the endpoint is fixed.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => refresh()}
                size="sm"
                loading={checking}
                className="flex-1"
              >
                Retry
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setSettingsOpen(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Sidebar organism - the application's whole navigation chrome.
 *
 * Below `md` (768px) nothing persistent eats content width: a compact sticky
 * header carries the brand, the menu trigger and the theme control, and the
 * routes live in a modal drawer. From `md` up the familiar 16rem sidebar is
 * back and the mobile chrome is gone. Both surfaces render the same NavList
 * over the same connection state, so the active route, the disabled RAG routes
 * and the job badge always agree.
 */
export function Sidebar({ navItems, className = '' }: SidebarProps) {
  const connection = useRagConnection();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const location = useLocation();
  const drawerId = useId();

  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  // Only pull focus back to the trigger for a drawer that was actually open,
  // never on the initial mount.
  const wasOpenRef = useRef(false);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Dismiss on navigation. This covers redirects and the brand link as well as
  // the nav items, which also close the drawer directly so that re-selecting
  // the current route - which may not produce a new location - still dismisses.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.key]);

  // Suppress background scrolling for as long as the drawer is up, restoring
  // whatever the document had before rather than assuming it was unset.
  useEffect(() => {
    if (!drawerOpen) return;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previousOverflow;
    };
  }, [drawerOpen]);

  // Move focus into the drawer on open, and hand it back to the trigger on
  // every close path - Escape, backdrop, close button or route change.
  useEffect(() => {
    if (drawerOpen) {
      wasOpenRef.current = true;
      const target =
        closeButtonRef.current ??
        drawerRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
        null;
      target?.focus();
      return;
    }
    if (wasOpenRef.current) {
      wasOpenRef.current = false;
      menuButtonRef.current?.focus();
    }
  }, [drawerOpen]);

  const handleDrawerKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      closeDrawer();
      return;
    }
    if (event.key !== 'Tab') return;

    const container = drawerRef.current;
    if (!container) return;

    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    ).filter(isVisible);

    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey) {
      if (active === first || !container.contains(active)) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (active === last || !container.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      {/* Compact mobile header - the only persistent chrome below md */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-edge bg-surface-raised px-3 py-2 md:hidden">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={drawerOpen}
          aria-haspopup="dialog"
          {...(drawerOpen ? { 'aria-controls': drawerId } : {})}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-content transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span aria-hidden="true" className="text-lg leading-none">☰</span>
        </button>

        <Link
          to="/"
          className="min-w-0 flex-1 truncate rounded-sm text-base font-bold text-link focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Algerknown
        </Link>

        <ThemeControl />
      </header>

      {/* Mobile navigation drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-slate-900/60 dark:bg-black/70"
            onClick={closeDrawer}
            aria-hidden="true"
          />

          <div
            id={drawerId}
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Main navigation"
            onKeyDown={handleDrawerKeyDown}
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-edge bg-surface-raised shadow-xl"
          >
            <div className="flex items-start gap-2 border-b border-edge p-4">
              <Link to="/" onClick={closeDrawer} className="block min-w-0 flex-1">
                <span className="block truncate text-xl font-bold text-link">Algerknown</span>
                <span className="mt-1 block truncate text-xs text-content-subtle">Knowledge Base</span>
              </Link>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeDrawer}
                aria-label="Close navigation menu"
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-content transition-colors hover:bg-surface-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span aria-hidden="true" className="text-lg leading-none">✕</span>
              </button>
            </div>

            <nav aria-label="Primary" className="flex-1 overflow-y-auto overscroll-contain p-4">
              <NavList navItems={navItems} connection={connection} onNavigate={closeDrawer} />
            </nav>

            <div className="space-y-3 border-t border-edge p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs uppercase tracking-wider text-content-subtle">Theme</span>
                <ThemeControl />
              </div>
              <RagStatusFooter connection={connection} />
            </div>
          </div>
        </div>
      )}

      {/* Persistent desktop sidebar - unchanged from md up */}
      <aside
        className={`hidden w-64 shrink-0 flex-col border-r border-edge bg-surface-raised md:flex ${className}`}
      >
        <div className="border-b border-edge p-4">
          <Link to="/" className="block">
            <h1 className="text-xl font-bold text-link">Algerknown</h1>
            <p className="mt-1 text-xs text-content-subtle">Knowledge Base</p>
          </Link>
        </div>

        <nav aria-label="Primary" className="flex-1 overflow-y-auto p-4">
          <NavList navItems={navItems} connection={connection} />
        </nav>

        <div className="space-y-3 border-t border-edge p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs uppercase tracking-wider text-content-subtle">Theme</span>
            <ThemeControl />
          </div>

          <RagStatusFooter connection={connection} />

          <div className="px-3 text-xs text-content-subtle">
            YAML-first knowledge base
          </div>
        </div>
      </aside>
    </>
  );
}
