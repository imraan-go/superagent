/**
 * Tailwind v4 via its PostCSS plugin rather than the Turbopack CSS loader.
 * The loader rule applies to every `*.css`, which would also intercept
 * `*.module.css` — and the design-system primitives are built on CSS Modules.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
