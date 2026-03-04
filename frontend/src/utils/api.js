const BASE = process.env.REACT_APP_API_URL || "/api";

const getToken = () => localStorage.getItem("ads_token");

const request = async (method, path, body, options = {}) => {
  const headers = {
    "Content-Type": "application/json",
    ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    ...(options.headers || {}),
  };

  const config = {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  };

  const res = await fetch(`${BASE}${path}`, config);

  if (res.status === 401) {
    localStorage.removeItem("ads_token");
    localStorage.removeItem("ads_user");
    window.location.href = "/login";
    return;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
};

// ── Upload (multipart) ──────────────────────────────────────────────
const upload = async (path, formData) => {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken()}` },
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Upload failed");
  return data;
};

export const api = {
  get:    (path, params) => {
    const url = params ? `${path}?${new URLSearchParams(params)}` : path;
    return request("GET", url);
  },
  post:   (path, body)   => request("POST",   path, body),
  patch:  (path, body)   => request("PATCH",  path, body),
  put:    (path, body)   => request("PUT",    path, body),
  delete: (path)         => request("DELETE", path),
  upload,
};

// ── Resource helpers ────────────────────────────────────────────────
export const authApi = {
  login:          (body) => api.post("/auth/login",           body),
  me:             ()     => api.get("/auth/me"),
  logout:         ()     => api.post("/auth/logout"),
  forgotPassword: (body) => api.post("/auth/forgot-password", body),
  resetPassword:  (body) => api.post("/auth/reset-password",  body),
  changePassword: (body) => api.post("/auth/change-password", body),
};

export const customersApi = {
  list:     ()         => api.get("/customers"),
  template: ()         => api.get("/customers/template"),
  create:   (body)     => api.post("/customers", body),
  bulk:     (body)     => api.post("/customers/bulk", body),
  update:   (id, body) => api.patch(`/customers/${id}`, body),
  remove:   (id)       => api.delete(`/customers/${id}`),
  posture:  (id)       => api.get(`/customers/${id}/posture`),
};

export const alertsApi = {
  list:   (params) => api.get("/alerts", params),
  ack:    (id)     => api.patch(`/alerts/${id}/ack`),
  ackAll: (body)   => api.patch("/alerts/ack-all", body),
};

export const ticketsApi = {
  list:       (params)   => api.get("/tickets", params),
  get:        (id)       => api.get(`/tickets/${id}`),
  create:     (body)     => api.post("/tickets", body),
  update:     (id, body) => api.patch(`/tickets/${id}`, body),
  addComment: (id, body) => api.post(`/tickets/${id}/comments`, body),
  remove:     (id)       => api.delete(`/tickets/${id}`),
};

export const reportsApi = {
  types:           ()         => api.get("/reports/types"),
  generate:        (body)     => api.post("/reports/generate", body),
  history:         ()         => api.get("/reports/history"),
  requestDownload: (filename) => api.post("/reports/request-download", { filename }),
};

export const logoApi = {
  upload: (file) => {
    const form = new FormData();
    form.append("logo", file);
    return api.upload("/logo", form);
  },
  remove: () => api.delete("/logo"),
};

export const scanApi = {
  trigger:        (customerId) => api.post(`/scan/${customerId}`),
  testConnection: (body)       => api.post('/scan/test-connection', body),
  library:        (params)     => api.get('/scan/library', params),
  libraryStats:   ()           => api.get('/scan/library/stats'),
};

export const settingsApi = {
  get:    ()     => api.get('/settings'),
  schema: ()     => api.get('/settings/schema'),
  save:   (body) => api.put('/settings', body),
};

export const usersApi = {
  list:   ()         => api.get('/users'),
  create: (body)     => api.post('/users', body),
  remove: (id)       => api.delete(`/users/${id}`),
  toggle: (id, body) => api.patch(`/users/${id}`, body),
};

export const auditLogApi = {
  list: (params) => api.get('/audit-log', params),
};

// ── Download helper ────────────────────────────────────────────────
// Two-step flow:
//   1. POST /api/reports/request-download  → receives a short-lived dl_token
//   2. GET  /api/reports/download/:file?dl_token=<token>  → streams the file
//
// This avoids putting the session JWT in the URL (access logs, referrer headers).
export const downloadReport = async (downloadUrl, filename) => {
  try {
    // Extract just the bare filename from the download_url path
    const bare = (filename || downloadUrl.split("/").pop()).split("?")[0];

    // Step 1 — request a one-time download token from the backend
    const { download_url: signedUrl } = await reportsApi.requestDownload(bare);

    // Step 2 — fetch the file using the signed URL (no auth header needed)
    const fullUrl = signedUrl.startsWith("http")
      ? signedUrl
      : `${window.location.origin}${signedUrl}`;

    const res = await fetch(fullUrl);
    if (!res.ok) throw new Error(`Download failed: ${res.status}`);

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href     = blobUrl;
    a.download = bare;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
  } catch (err) {
    alert("Download failed: " + err.message);
  }
};

export const platformApi = {
  posture: () => api.get("/customers/platform-posture"),
};

export const adUsersApi = {
  list:          (params) => api.get("/ad-users", params),
  stats:         (params) => api.get("/ad-users/stats", params),
  platformStats: ()       => api.get("/ad-users/platform-stats"),
};

export const offboardingApi = {
  sync:           (customerId) => api.post(`/offboarding/sync/${customerId}`),
  crossReference: (customerId) => api.get(`/offboarding/cross-reference/${customerId}`),
  overview:       ()           => api.get("/offboarding/overview"),
  apiContract:    ()           => api.get("/offboarding/api-contract"),
  testUrl:        (body)       => api.post("/offboarding/test-url", body),
};
