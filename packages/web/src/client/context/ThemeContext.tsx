import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/** What the visitor picked. `system` follows the operating-system setting. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** What is actually painted once `system` has been resolved. */
export type EffectiveTheme = 'light' | 'dark';

/**
 * Shared with the pre-paint bootstrap in `index.html`. Both must agree on the
 * key and on how a stored value resolves to a scheme, or a reload flashes.
 */
export const THEME_STORAGE_KEY = 'algerknown-theme';

const DARK_MEDIA_QUERY = '(prefers-color-scheme: dark)';

const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

/**
 * Read the saved preference. Anything unreadable or malformed - blocked
 * storage, a hand-edited value, a leftover key from an older build - resolves
 * to `system` rather than throwing.
 */
function readStoredPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function persistPreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* storage unavailable - the choice still applies for this session */
  }
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia(DARK_MEDIA_QUERY).matches;
  } catch {
    return false;
  }
}

function applyTheme(theme: EffectiveTheme): void {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.style.colorScheme = theme;
}

interface ThemeContextValue {
  /** The visitor's choice, including `system`. */
  preference: ThemePreference;
  /** The resolved scheme currently painted. */
  theme: EffectiveTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * ThemeProvider - Owns the Light/Dark/System preference.
 *
 * Persists the choice to localStorage, keeps `system` live by listening for
 * `prefers-color-scheme` changes, and mirrors the resolved scheme onto <html>
 * as the `dark` class plus a matching `color-scheme`.
 */
export function ThemeProvider({ children }: ThemeProviderProps) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [prefersDark, setPrefersDark] = useState<boolean>(systemPrefersDark);

  // Only track the OS while System is selected; an explicit choice wins.
  useEffect(() => {
    if (preference !== 'system') return;

    let query: MediaQueryList;
    try {
      query = window.matchMedia(DARK_MEDIA_QUERY);
    } catch {
      return;
    }

    // Re-sync on subscribe: the OS may have changed while another mode was set.
    setPrefersDark(query.matches);

    const handleChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches);

    // Safari < 14 and other older engines expose only the legacy listener API,
    // where `addEventListener` is undefined. Subscribing must never throw out of
    // this effect - losing live updates is survivable, a failed mount is not.
    try {
      if (typeof query.addEventListener === 'function') {
        query.addEventListener('change', handleChange);
        return () => query.removeEventListener('change', handleChange);
      }
      if (typeof query.addListener === 'function') {
        query.addListener(handleChange);
        return () => query.removeListener(handleChange);
      }
    } catch {
      /* no usable listener API - System keeps the scheme it resolved to above */
    }

    return undefined;
  }, [preference]);

  const theme: EffectiveTheme =
    preference === 'system' ? (prefersDark ? 'dark' : 'light') : preference;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    persistPreference(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, theme, setPreference }),
    [preference, theme, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string; icon: string }> = [
  { value: 'light', label: 'Light', icon: '☀' },
  { value: 'dark', label: 'Dark', icon: '☾' },
  { value: 'system', label: 'System', icon: '🖵' },
];

interface ThemeToggleProps {
  className?: string;
}

/**
 * ThemeToggle - Visible Light/Dark/System control.
 *
 * A pressed-button group rather than an ARIA radio group: the radio roles imply
 * arrow-key navigation and a roving tabindex, and `aria-pressed` describes what
 * plain Tab traversal actually does here. Switching applies immediately, without
 * a reload.
 */
export function ThemeToggle({ className = '' }: ThemeToggleProps) {
  const { preference, setPreference } = useTheme();

  return (
    <div
      role="group"
      aria-label="Color theme"
      className={`inline-flex items-center gap-1 rounded-lg border border-edge bg-surface-raised p-1 ${className}`}
    >
      {THEME_OPTIONS.map((option) => {
        const selected = preference === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            title={`${option.label} theme`}
            onClick={() => setPreference(option.value)}
            className={`
              inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors
              focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised
              ${selected
                ? 'bg-accent text-accent-fg'
                : 'text-content-muted hover:bg-control hover:text-content active:bg-control-hover'
              }
            `}
          >
            <span aria-hidden="true">{option.icon}</span>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
