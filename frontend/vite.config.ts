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
});
