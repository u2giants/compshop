import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "child_process";

function gitInfo() {
  try {
    const hash = execSync("git rev-parse --short HEAD").toString().trim();
    const date = execSync("git log -1 --format=%cd --date=short").toString().trim();
    return { hash, date };
  } catch {
    return { hash: "unknown", date: "unknown" };
  }
}

const { hash: COMMIT_HASH, date: COMMIT_DATE } = gitInfo();

export default defineConfig((_env) => ({
  define: {
    __COMMIT_HASH__: JSON.stringify(COMMIT_HASH),
    __COMMIT_DATE__: JSON.stringify(COMMIT_DATE),
  },
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico"],
      workbox: {
        navigateFallbackDenylist: [/^\/~oauth/],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
      },
      manifest: {
        name: "CompShop - Comparison Shopping Intel",
        short_name: "CompShop",
        description: "Collaborative comparison shopping intelligence for your team",
        theme_color: "#b85c1e",
        background_color: "#f7f4f0",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
