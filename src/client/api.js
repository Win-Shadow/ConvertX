const webroot = document.querySelector('meta[name="webroot"]')?.content || "";
export const url = (p) => `${webroot}${p}`;

async function j(method, path, body) {
  const res = await fetch(url(path), {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const err = new Error(data?.message || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  session: () => j("GET", "/api/session"),
  createJob: () => j("POST", "/api/jobs"),
  job: (id) => j("GET", `/api/jobs/${id}`),
  start: (id, items, keepHours) => j("POST", `/api/jobs/${id}/start`, { items, keepHours }),
  retry: (id, itemId, tolerant) => j("POST", `/api/jobs/${id}/items/${itemId}/retry`, { tolerant }),
  keep: (id, hours) => j("POST", `/api/jobs/${id}/keep`, { hours }),
  removeUpload: (id, name) => j("DELETE", `/api/jobs/${id}/uploads/${encodeURIComponent(name)}`),
  deleteJob: (id) => j("DELETE", `/api/jobs/${id}`),
  history: () => j("GET", "/api/history"),
  targets: (exts) => j("GET", `/api/targets?exts=${encodeURIComponent(exts.join(","))}`),
  storage: () => j("GET", "/api/storage"),
  queue: () => j("GET", "/api/queue"),
  importUrl: (id, link) => j("POST", `/api/jobs/${id}/import`, { url: link }),
  share: (id, choice, itemId) => j("POST", `/api/jobs/${id}/share`, itemId ? { choice, itemId } : { choice }),
  unshare: (id, token) => j("DELETE", `/api/jobs/${id}/share/${token}`),
};

export const fileUrl = (jobId, itemId, dl) => url(`/api/jobs/${jobId}/items/${itemId}/file${dl ? "?dl=1" : ""}`);
export const zipUrl = (jobId) => url(`/api/jobs/${jobId}/zip`);

// Cloudflare's free plan rejects request bodies over 100 MB, so big files go up in slices.
const CHUNK = 32 * 1024 * 1024;

export async function uploadFile(jobId, file, name, onProgress, signal) {
  let offset = 0;
  let last;
  while (offset < file.size || (file.size === 0 && offset === 0)) {
    const slice = file.slice(offset, Math.min(file.size, offset + CHUNK));
    last = await sendChunk(jobId, name, offset, Math.max(1, file.size), slice, (loaded) => onProgress((offset + loaded) / Math.max(1, file.size)), signal);
    offset += slice.size;
    if (file.size === 0) break;
  }
  return last;
}

function sendChunk(jobId, name, offset, total, blob, onLoaded, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url(`/api/jobs/${jobId}/upload?name=${encodeURIComponent(name)}&offset=${offset}&total=${total}`));
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onLoaded(e.loaded);
    xhr.onload = () => {
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignore */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(Object.assign(new Error(data?.message || `Upload failed (${xhr.status})`), { status: xhr.status }));
    };
    xhr.onerror = () => reject(new Error("Network error while uploading"));
    xhr.onabort = () => reject(Object.assign(new Error("Cancelled"), { aborted: true }));
    signal?.addEventListener("abort", () => xhr.abort());
    xhr.send(blob);
  });
}

// The login/register endpoints are classic form posts that redirect on success.
export async function formPost(path, fields) {
  const res = await fetch(url(path), {
    method: "POST",
    credentials: "same-origin",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  return res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
}
