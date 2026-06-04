import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/* Vite preview blocks "unknown" hosts by default as a CSRF-style guard.
 * For production where we serve behind custom domains and Railway's auto
 * generated *.up.railway.app subdomains, the allowedHosts list must include
 * every host that can reach the preview server. `true` disables the check
 * entirely; an array pins specific hosts.
 *
 * For dev (`vite dev`), `server.host` allows the same surface so the same
 * URLs work locally over LAN. */
export default defineConfig({
  plugins: [react()],
  preview: {
    allowedHosts: [
      "usehatch.xyz",
      "www.usehatch.xyz",
      ".up.railway.app",
      "localhost",
      "127.0.0.1",
    ],
  },
  build: {
    /* Split heavy vendor groups into separate chunks so the main bundle is
     * cacheable across releases and the cold-start payload is smaller. The
     * groups are picked to keep each chunk under ~1 MB pre-compression. */
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@privy-io") || id.includes("permissionless")) return "vendor-privy";
          if (id.includes("@metamask")) return "vendor-metamask";
          if (id.includes("@walletconnect") || id.includes("@reown")) return "vendor-walletconnect";
          if (id.includes("@story-protocol") || id.includes("@piplabs")) return "vendor-story";
          if (id.includes("wagmi") || id.includes("viem") || id.includes("abitype")) return "vendor-wagmi";
          if (id.includes("@solana") || id.includes("ox")) return "vendor-crypto";
          if (id.includes("framer-motion") || id.includes("gsap") || id.includes("lenis")) return "vendor-motion";
          if (id.includes("react-markdown") || id.includes("remark") || id.includes("rehype") || id.includes("highlight.js")) return "vendor-markdown";
          return "vendor";
        },
      },
    },
    /* Default Vite chunk-size warning is 500 KB; bump so we do not get noise
     * for vendor splits that are intentionally larger. */
    chunkSizeWarningLimit: 1500,
  },
});
