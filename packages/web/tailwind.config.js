/** @type {import('tailwindcss').Config} */

/**
 * Semantic color tokens are backed by CSS custom properties declared in
 * `src/client/index.css` for the light scheme and re-declared under the `.dark`
 * class for the dark scheme. Each variable holds a space-separated RGB triple so
 * Tailwind's `<alpha-value>` opacity modifiers keep working (`bg-surface/60`).
 *
 * Dark mode is class-based: the `dark` class is put on <html> by the pre-paint
 * bootstrap in `index.html` and kept in sync by `context/ThemeContext.tsx`.
 */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/client/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Backgrounds, ordered from the page canvas outward.
        surface: {
          DEFAULT: token('surface'),
          raised: token('surface-raised'),
          hover: token('surface-hover'),
          sunken: token('surface-sunken'),
          muted: token('surface-muted'),
        },
        // Foreground text, ordered from most to least prominent.
        content: {
          DEFAULT: token('content'),
          strong: token('content-strong'),
          muted: token('content-muted'),
          subtle: token('content-subtle'),
        },
        // Hairlines and dividers.
        edge: {
          DEFAULT: token('edge'),
          strong: token('edge-strong'),
        },
        // Neutral interactive fills (secondary/ghost buttons, chips).
        control: {
          DEFAULT: token('control'),
          hover: token('control-hover'),
          active: token('control-active'),
        },
        // Solid brand fill plus the foreground that stays legible on it.
        accent: {
          DEFAULT: token('accent'),
          hover: token('accent-hover'),
          fg: token('accent-fg'),
        },
        // Brand-colored text drawn directly on a surface.
        link: {
          DEFAULT: token('link'),
          hover: token('link-hover'),
        },
      },
    },
  },
  plugins: [],
}
