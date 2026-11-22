// Copies src/ to dist/ and writes dist/config.js from VITE_API_BASE_URL (set it in Netlify's environment variables).
import { cpSync, rmSync, writeFileSync, existsSync } from "node:fs";
if (!existsSync("src/index.html")) throw new Error("src/index.html missing - run from the frontend/ folder");
rmSync("dist", { recursive: true, force: true });
cpSync("src", "dist", { recursive: true });
const raw = process.env.VITE_API_BASE_URL || "http://localhost:8000/api";
if (!/^https?:\/\//.test(raw)) throw new Error("VITE_API_BASE_URL must start with http:// or https://");
const api = raw.replace(/\/+$/, "");
if (process.env.NETLIFY && !process.env.VITE_API_BASE_URL)
  console.warn("WARNING: VITE_API_BASE_URL is not set; the site will load but show 'Offline'.");
writeFileSync("dist/config.js", `window.RESQ_CONFIG = ${JSON.stringify({ API_BASE: api })};\n`);
console.log("Built dist/ - API base:", api);
