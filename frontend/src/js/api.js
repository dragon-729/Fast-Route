// Centralised API client. Base URL comes from config.js (generated from VITE_API_BASE_URL at build time).
export const API_BASE = (window.RESQ_CONFIG?.API_BASE || "http://localhost:8000/api").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(path, { method = "GET", body, params } = {}) {
  const clean = params ? Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "") : [];
  const qs = clean.length ? "?" + new URLSearchParams(clean) : "";
  let res;
  try {
    res = await fetch(API_BASE + path + qs, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError("Can't reach the backend. Check that it is running and that the API URL is correct.", 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(data?.detail || `Request failed (${res.status})`, res.status);
  return data ?? {};
}

export const api = {
  get: (p, params) => request(p, { params }),
  post: (p, body = {}) => request(p, { method: "POST", body }),
  patch: (p, body) => request(p, { method: "PATCH", body }),
  del: (p) => request(p, { method: "DELETE" }),
};
