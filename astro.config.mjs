import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  site: "https://csmap.mycodingdays.com",
  adapter: cloudflare({
    imageService: "compile",
  }),
  integrations: [
    mdx(),
    // /dev/* are scratch pages and /admin/* is the private newsletter console —
    // keep both out of the sitemap.
    sitemap({
      filter: (page) => !page.includes("/dev/") && !page.includes("/admin/"),
    }),
    react(),
  ],
  markdown: {
    syntaxHighlight: {
      type: "shiki",
      // Leave ```mermaid fences as plain <pre><code class="language-mermaid">
      // blocks so MermaidRenderer can pick them up client-side.
      excludeLangs: ["mermaid"],
    },
  },
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    format: "directory",
  },
  trailingSlash: "ignore",
});
