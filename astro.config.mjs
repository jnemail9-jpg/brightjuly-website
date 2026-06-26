// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import icon from "astro-icon";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  site: "https://brightjuly.com.au",
  // Cloudflare Pages serves `/page.html` at `/page` with no redirect, but
  // `/page/index.html` triggers a 308 redirect to add a trailing slash.
  // `format: "file"` + `trailingSlash: "never"` gives clean, redirect-free,
  // non-trailing-slash URLs that match our canonicals and sitemap.
  build: { format: "file" },
  trailingSlash: "never",
  integrations: [
    sitemap({
      // Keep noindex / post-submit pages out of the sitemap.
      filter: (page) => !page.includes("/competition/success"),
    }),
    icon(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
