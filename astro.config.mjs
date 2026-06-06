import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

// https://astro.build/config
export default defineConfig({
  site: "https://computer-atlas.mrb-bayat.workers.dev",
  adapter: cloudflare({
    imageService: "compile",
  }),
  integrations: [mdx(), sitemap(), react()],
  vite: {
    plugins: [tailwindcss()],
  },
  build: {
    format: "directory",
  },
  trailingSlash: "ignore",
});
