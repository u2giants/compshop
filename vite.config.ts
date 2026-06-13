import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "child_process";

function gitInfo() {
  if (process.env.VITE_COMMIT_HASH && process.env.VITE_COMMIT_DATE) {
    return {
      hash: process.env.VITE_COMMIT_HASH,
      date: process.env.VITE_COMMIT_DATE,
    };
  }

  try {
    const hash = execSync("git rev-parse --short HEAD").toString().trim();
    const date = execSync("git show -s --format=%cd --date=format-local:'%Y-%m-%d %I:%M %p %Z' HEAD", {
      env: { ...process.env, TZ: "America/New_York" },
    }).toString().trim();
    return { hash, date };
  } catch {
    return { hash: "unknown", date: "unknown" };
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const { hash: COMMIT_HASH, date: COMMIT_DATE } = gitInfo();
const BUILD_STAMP = `Commit ${COMMIT_HASH} - ${COMMIT_DATE}`;

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
    {
      name: "build-stamp-html",
      transformIndexHtml(html) {
        const stamp = escapeHtml(BUILD_STAMP);
        return html.replace(
          "<body>",
          `<body>\n    <div id="build-stamp" style="border-bottom:1px solid hsl(30 18% 86%);background:hsl(30 18% 94%);padding:4px 12px;text-align:center;font:10px/1.2 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;color:hsl(25 8% 40%);user-select:all;">${stamp}</div>`
        );
      },
    },
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico"],
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
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
