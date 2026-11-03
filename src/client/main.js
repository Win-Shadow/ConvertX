import { h, render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import htm from "htm";

import qrcode from "qrcode-generator";

import { describe, estimateMb, extOf, genericRecipe, GENERIC_PREFIX, kindOf, recipeById, recipesFor, recommended, resolveOpts } from "../v2/recipes";
import { api, fileUrl, formPost, uploadFile, url, zipUrl } from "./api";
import { getLang, setLang, t, tr } from "./i18n";
import { applyTheme, isLight, loadTheme, onSystemModeChange, palette, saveTheme, THEMES } from "./themes";

const html = htm.bind(h);
const KIND_ORDER = ["image", "video", "audio", "pdf", "doc", "ebook", "other"];
const KIND_WORD = { image: "photo", video: "video", audio: "audio", pdf: "pdf", doc: "doc", ebook: "ebook", other: "other" };
const KEEP_HOURS = [24, 72, 168, -1];
// The registry knows hundreds of exotic targets (mostly ImageMagick); lead with ones people actually use.
const COMMON = {
  image: ["jpg", "png", "webp", "avif", "heic", "gif", "bmp", "tiff", "ico", "jxl", "pdf", "svg", "psd", "eps", "jp2", "tga"],
  video: ["mp4", "mkv", "webm", "mov", "avi", "m4v", "gif", "mp3", "m4a", "wav", "flac", "ogg", "ts", "wmv"],
  audio: ["mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "wma", "aiff"],
  pdf: ["docx", "odt", "txt", "md", "html", "epub", "png", "jpg", "svg", "pptx"],
  doc: ["pdf", "docx", "odt", "rtf", "txt", "md", "html", "epub", "xlsx", "csv", "pptx", "odp"],
  ebook: ["epub", "azw3", "mobi", "pdf", "docx", "txt", "html", "fb2"],
};
const MB = 1024 * 1024;

// ---------- helpers ----------
function fmtBytes(b) {
  if (b == null) return "…";
  const G = 1024 ** 3, M = 1024 ** 2;
  if (b >= G) return (b / G).toFixed(b % G === 0 ? 0 : 1) + " GB";
  if (b >= 10 * M) return Math.round(b / M) + " MB";
  if (b >= M) return (b / M).toFixed(1) + " MB";
  return Math.max(1, Math.round(b / 1024)) + " KB";
}
const fmtMb = (mb) => fmtBytes(mb * MB);
function fmtDur(s) {
  if (!s) return "";
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  return m ? `${m} min ${sec} s` : `${sec} s`;
}
function toClock(s) {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
function plural(n, pair) {
  return `${n} ${pair[n === 1 ? 0 : 1]}`;
}
function groupNoun(kind, n) {
  return plural(n, t(KIND_WORD[kind]));
}
function relTime(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diff < 86400 && d.getDate() === new Date().getDate()) return time;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + ", " + time;
}
function untilText(keepUntil) {
  if (!keepUntil) return null;
  if (keepUntil === "forever") return t("kept");
  const h = (new Date(keepUntil).getTime() - Date.now()) / 3600e3;
  if (h <= 0) return t("expired");
  return t("deletesIn", { x: h >= 48 ? `${Math.round(h / 24)} d` : `${Math.max(1, Math.round(h))} h` });
}
function fileMeta(f) {
  const i = f.info || {};
  const bits = [];
  if (i.camera) bits.push(i.camera);
  if (i.width && i.height) bits.push(`${i.width} × ${i.height}`);
  if (i.duration) bits.push(fmtDur(i.duration));
  if (i.vcodec) bits.push(i.vcodec.toUpperCase());
  if (i.pages) bits.push(t("pages", { n: i.pages }));
  if (i.hasText === true) bits.push(t("hasText"));
  if (i.hasText === false) bits.push(t("scanned"));
  if (i.hasGps) bits.push(t("hasLocation"));
  return bits.join(" · ");
}
function getRecipe(id, kind) {
  if (!id) return null;
  if (id.startsWith(GENERIC_PREFIX)) return genericRecipe(kind, id.slice(GENERIC_PREFIX.length));
  return recipeById(id) || null;
}
function summaryParts(r, v, count) {
  const parts = [r.merge ? `${count} → 1 ${tr(r.title).replace(/^(One|Un) /, "")}` : tr(r.title)];
  for (const s of r.settings) {
    const val = v[s.id];
    if ((s.type === "seg" || s.type === "select") && s.opts) parts.push(tr((s.opts[Number(val)] || "").split(" — ")[0]) + tr(s.suffix || ""));
    if (s.type === "check") {
      const p = val ? s.on : s.off;
      if (p) parts.push(tr(p));
    }
    if (s.type === "trim") {
      const tv = val || {};
      if (tv.start || tv.end) parts.push(`${tv.start || "00:00"}–${tv.end || "…"}`);
    }
  }
  return parts.join(" · ");
}
function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  const i = name.lastIndexOf(".");
  const base = i > 0 ? name.slice(0, i) : name, ext = i > 0 ? name.slice(i) : "";
  for (let n = 2; ; n++) {
    const c = `${base} (${n})${ext}`;
    if (!taken.has(c)) return c;
  }
}

// ---------- icons ----------
const Icon = ({ d, size = 18, sw = 2 }) => html`<svg width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d.map((p) => html`<path d=${p} />`)}</svg>`;
const I = {
  logo: ["M4 7h13l-3-3", "M20 17H7l3 3"],
  up: ["M12 16V4", "m7 9 5-5 5 5", "M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"],
  x: ["M6 6l12 12M18 6 6 18"],
  check: ["m5 12 5 5 9-10"],
  down: ["M12 4v12", "m7 11 5 5 5-5", "M5 20h14"],
  warn: ["M12 9v4M12 17h.01", "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"],
  sliders: ["M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"],
  code: ["m8 6-6 6 6 6M16 6l6 6-6 6"],
  palette: ["M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2z", "M7.5 11.5h.01M10 7.5h.01M15 7.5h.01M17.5 11.5h.01"],
};

// ---------- app ----------
function App() {
  const [session, setSession] = useState(null);
  const [theme, setThemeState] = useState(loadTheme());
  const [lang, setLangState] = useState(getLang());
  const [view, setView] = useState("add");
  const [files, setFiles] = useState([]);
  const [jobId, setJobId] = useState(null);
  const [choice, setChoice] = useState({});
  const [vals, setVals] = useState({});
  const [over, setOver] = useState({});
  const [custom, setCustom] = useState({});
  const [ui, setUi] = useState({});
  const [keepHours, setKeepHours] = useState(24);
  const [job, setJob] = useState(null);
  const [targets, setTargets] = useState({});
  const [history, setHistory] = useState(null);
  const [storage, setStorage] = useState(null);
  const [queue, setQueue] = useState({ running: 0, waiting: 0 });
  const [popover, setPopover] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState(null);
  const jobPromise = useRef(null);
  const aborts = useRef(new Map());
  const pickerRef = useRef(null);

  const toggle = (key) => setUi((u) => ({ ...u, [key]: !u[key] }));
  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // theme
  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);
  useEffect(() => onSystemModeChange(() => setThemeState((x) => ({ ...x }))), []);
  const setTheme = (patch) => setThemeState((x) => ({ ...x, ...patch }));
  const changeLang = (l) => {
    setLang(l);
    setLangState(l);
  };

  // session
  const loadSession = () => api.session().then(setSession).catch(() => setSession({ loggedIn: false }));
  useEffect(() => {
    loadSession();
  }, []);
  useEffect(() => {
    if (!session?.loggedIn) return;
    api.history().then(setHistory).catch(() => {});
    api.storage().then(setStorage).catch(() => {});
  }, [session?.loggedIn]);

  // window-wide drag & drop while adding
  useEffect(() => {
    if (!session?.loggedIn) return;
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
    const enter = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over_ = (e) => hasFiles(e) && e.preventDefault();
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      addFiles([...e.dataTransfer.files]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over_);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over_);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  });

  // ---------- uploads ----------
  const ensureJob = () => {
    if (jobId) return Promise.resolve(jobId);
    if (!jobPromise.current) {
      jobPromise.current = api.createJob().then(({ id }) => {
        setJobId(id);
        return id;
      });
      jobPromise.current.catch(() => (jobPromise.current = null));
    }
    return jobPromise.current;
  };

  const patchFile = (name, patch) => setFiles((fs) => fs.map((f) => (f.name === name ? { ...f, ...patch } : f)));

  const startUpload = async (entry) => {
    const ctrl = new AbortController();
    aborts.current.set(entry.name, ctrl);
    patchFile(entry.name, { state: "uploading", progress: 0, error: null });
    try {
      const id = await ensureJob();
      let lastPaint = 0;
      const res = await uploadFile(id, entry.blob, entry.name, (p) => {
        const now = performance.now();
        if (now - lastPaint > 120 || p >= 1) {
          lastPaint = now;
          patchFile(entry.name, { progress: p, state: p >= 1 ? "checking" : "uploading" });
        }
      }, ctrl.signal);
      patchFile(entry.name, { state: "ready", progress: 1, info: res?.info || {} });
    } catch (e) {
      if (!e.aborted) patchFile(entry.name, { state: "error", error: e.message });
    } finally {
      aborts.current.delete(entry.name);
    }
  };

  const filesRef = useRef(files);
  filesRef.current = files;

  const addFiles = (list) => {
    if (!list.length) return;
    let base = filesRef.current;
    if (job && view === "get") {
      resetAll();
      base = [];
    }
    setView("add");
    const taken = new Set(base.map((f) => f.name));
    const added = list.map((blob) => {
      const name = uniqueName(blob.name || "file", taken);
      taken.add(name);
      const ext = extOf(name);
      return { name, size: blob.size, ext, kind: kindOf(ext), state: "queued", progress: 0, blob, info: null };
    });
    filesRef.current = [...base, ...added];
    setFiles(filesRef.current);
    runUploads(added);
  };

  // two at a time keeps the tunnel happy and progress meaningful
  const runUploads = (entries) => {
    const q = [...entries];
    const worker = async () => {
      while (q.length) await startUpload(q.shift());
    };
    worker();
    worker();
  };

  const removeFile = (name) => {
    aborts.current.get(name)?.abort();
    setFiles((fs) => fs.filter((f) => f.name !== name));
    setOver((o) => {
      const n = { ...o };
      delete n[name];
      return n;
    });
    if (jobId) api.removeUpload(jobId, name).catch(() => {});
  };

  const resetAll = () => {
    for (const c of aborts.current.values()) c.abort();
    setFiles([]);
    setJobId(null);
    jobPromise.current = null;
    setJob(null);
    setOver({});
    setCustom({});
    setUi({});
    setView("add");
  };

  const importUrl = async (link) => {
    const id = await ensureJob();
    const r = await api.importUrl(id, link);
    const ext = extOf(r.name);
    const entry = { name: r.name, size: r.size > 0 ? r.size : 0, ext, kind: kindOf(ext), state: "importing", progress: 0, info: null, imported: true };
    filesRef.current = [...filesRef.current, entry];
    setFiles(filesRef.current);
  };

  const importing = files.some((f) => f.state === "importing");
  useEffect(() => {
    if (!importing || !jobId) return;
    const timer = setInterval(async () => {
      try {
        const j = await api.job(jobId);
        const byName = new Map(j.uploads.map((u) => [u.name, u]));
        setFiles((fs) => fs.map((f) => {
          const u = f.state === "importing" && byName.get(f.name);
          if (!u) return f;
          if (u.error) return { ...f, state: "error", error: u.error };
          if (u.complete) return { ...f, state: "ready", progress: 1, size: u.size, info: u.info || {} };
          return { ...f, size: u.size > 0 ? u.size : u.received, progress: u.size > 0 ? u.received / u.size : 0, received: u.received };
        }));
      } catch {
        /* keep polling */
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [importing, jobId]);

  // ---------- grouping ----------
  const groups = useMemo(() => {
    const live = files.filter((f) => f.state !== "error");
    return KIND_ORDER.map((kind) => {
      const fs = live.filter((f) => f.kind === kind);
      if (!fs.length) return null;
      const exts = [...new Set(fs.map((f) => f.ext))];
      let list = recipesFor(kind, exts);
      const rec = recommended(kind, fs.map((f) => f.info || {}));
      if (rec && list.some((r) => r.id === rec)) list = [list.find((r) => r.id === rec), ...list.filter((r) => r.id !== rec)];
      if (custom[kind]) list = [...list, genericRecipe(kind, custom[kind])];
      const chosen = list.find((r) => r.id === choice[kind]) || list[0] || null;
      return { kind, files: fs, exts, list, recipe: chosen };
    }).filter(Boolean);
  }, [files, choice, custom]);

  // other formats for every extension in play
  useEffect(() => {
    const need = [...new Set(files.map((f) => f.ext))].filter((e) => e && !(e in targets));
    if (!need.length || !session?.loggedIn) return;
    api.targets(need).then((r) => setTargets((x) => ({ ...x, ...r }))).catch(() => {});
  }, [files, session?.loggedIn]);

  const optsFor = (r, kind) => resolveOpts(r, vals[r.id] || {});
  const recipeForFile = (f, g) => (over[f.name] ? getRecipe(over[f.name], f.kind) : g.recipe);
  const estFile = (f, g) => {
    const r = recipeForFile(f, g);
    return r ? estimateMb(r, optsFor(r, f.kind), f.size / MB) : f.size / MB;
  };

  // ---------- start / poll ----------
  const pending = files.filter((f) => f.state === "queued" || f.state === "uploading" || f.state === "checking" || f.state === "importing").length;

  const start = async () => {
    const items = [];
    for (const g of groups) {
      const merged = new Map();
      for (const f of g.files) {
        const r = recipeForFile(f, g);
        if (!r) continue;
        const opts = optsFor(r, f.kind);
        if (r.merge) {
          if (!merged.has(r.id)) merged.set(r.id, { recipe: r.id, inputs: [], opts, outName: `${t(KIND_WORD[g.kind])[1].replace(/^./, (c) => c.toUpperCase())}.${r.ext}` });
          merged.get(r.id).inputs.push(f.name);
        } else {
          items.push({ recipe: r.id, inputs: [f.name], opts });
        }
      }
      items.push(...merged.values());
    }
    if (!items.length) return;
    try {
      const j = await api.start(jobId, items, keepHours);
      setJob(j);
      setView("get");
    } catch (e) {
      flash(e.message);
    }
  };

  useEffect(() => {
    if (view !== "get" || !jobId) return;
    let stop = false;
    const tick = async () => {
      try {
        const [j, q] = await Promise.all([api.job(jobId), api.queue()]);
        if (stop) return;
        setJob(j);
        setQueue(q);
        const busy = j.items.some((i) => i.status === "queued" || i.status === "running");
        if (!busy) {
          api.history().then(setHistory).catch(() => {});
          api.storage().then(setStorage).catch(() => {});
          return;
        }
      } catch {
        /* transient: keep polling */
      }
      if (!stop) setTimeout(tick, 1000);
    };
    tick();
    return () => (stop = true);
  }, [view, jobId, job?.items?.some((i) => i.status === "queued" || i.status === "running")]);

  useEffect(() => {
    if (view === "choose" && session?.loggedIn) api.queue().then(setQueue).catch(() => {});
    if (view === "history" && session?.loggedIn) api.history().then(setHistory).catch(() => {});
  }, [view]);

  const openJob = async (id) => {
    try {
      const j = await api.job(id);
      setFiles([]);
      setJobId(id);
      jobPromise.current = Promise.resolve(id);
      setJob(j);
      setView("get");
    } catch (e) {
      flash(e.message);
    }
  };

  const shortcut = (kind, id) => {
    setChoice((c) => ({ ...c, [kind]: id }));
    if (files.length) setView("choose");
    else pickerRef.current?.click();
  };

  // ---------- render ----------
  if (!session) return null;
  if (!session.loggedIn) return html`<${Auth} session=${session} onDone=${loadSession} lang=${lang} changeLang=${changeLang} />`;

  const stepIdx = { add: 0, choose: 1, get: 2 }[view] ?? -1;
  const ctx = { files, groups, view, setView, jobId, job, setJob, choice, setChoice, vals, setVals, over, setOver, custom, setCustom, ui, toggle, keepHours, setKeepHours, targets, history, storage, queue, pending, addFiles, removeFile, resetAll, start, openJob, shortcut, pickerRef, flash, estFile, optsFor, recipeForFile, setHistory, importUrl, session };

  return html`
    <div onClick=${(e) => popover && !e.target.closest(".popover,.pop-trigger") && setPopover(null)}>
      <header class="wrap top">
        <button type="button" class="brand" onClick=${() => setView(job ? "get" : "add")}>
          <span style="color: var(--ac)"><${Icon} d=${I.logo} size=${26} sw=${2.2} /></span> Convert
        </button>
        <div class="toolbar">
          <button type="button" class=${"pillbtn pop-trigger" + (popover === "theme" ? " on" : "")} aria-expanded=${popover === "theme"} onClick=${() => setPopover(popover === "theme" ? null : "theme")}>
            <${Icon} d=${I.palette} size=${16} /> ${theme.theme} · ${t(theme.mode)}
          </button>
          <div class="seggroup" role="group" aria-label="Language">
            <button type="button" class=${lang === "en" ? "on" : ""} onClick=${() => changeLang("en")}>EN</button>
            <button type="button" class=${lang === "es" ? "on" : ""} onClick=${() => changeLang("es")}>ES</button>
          </div>
          <button type="button" class=${"pillbtn" + (view === "history" ? " on" : "")} onClick=${() => setView("history")}>${t("history")}</button>
          <button type="button" class="avatar pop-trigger" aria-label=${t("account")} aria-expanded=${popover === "account"} onClick=${() => setPopover(popover === "account" ? null : "account")}>${(session.email || "?").charAt(0).toUpperCase()}</button>
        </div>
        ${popover === "theme" && html`<${ThemePicker} theme=${theme} setTheme=${setTheme} />`}
        ${popover === "account" && html`
          <div class="popover menu" role="menu">
            <div class="muted small" style="padding: 8px 12px">${session.email}</div>
            <a href=${url("/classic")} role="menuitem">${t("classic")}</a>
            <a href=${url("/logoff")} role="menuitem">${t("logout")}</a>
          </div>`}
      </header>

      <div class="wrap layout">
        <main class="main">
          ${view !== "history" && html`
            <ol class="steps" aria-label="Steps">
              ${t("steps").map((label, i) => {
                const locked = (i === 1 && !groups.length) || (i === 2 && !job);
                return html`<li class=${(i <= stepIdx ? "on" : "") + (i === stepIdx ? " cur" : "")}>
                  <button type="button" disabled=${locked} onClick=${() => setView(["add", "choose", "get"][i])}><span class="bar"></span><span class="lbl">${i + 1}. ${label}</span></button>
                </li>`;
              })}
            </ol>`}
          ${view === "add" && html`<${AddView} ...${ctx} />`}
          ${view === "choose" && html`<${ChooseView} ...${ctx} />`}
          ${view === "get" && html`<${GetView} ...${ctx} />`}
          ${view === "history" && html`<${HistoryView} ...${ctx} />`}
        </main>
        <aside class="side" aria-label="Details">
          ${(view === "add" || view === "history") && html`<${SideAdd} ...${ctx} />`}
          ${view === "choose" && html`<${SideChoose} ...${ctx} />`}
          ${view === "get" && html`<${SideGet} ...${ctx} />`}
          <${ServerCard} storage=${storage} />
        </aside>
      </div>
      <footer class="wrap footer"><span>${t("privacy")}</span></footer>
      <input ref=${pickerRef} type="file" multiple class="sr" tabindex="-1" aria-hidden="true" onChange=${(e) => {
        addFiles([...e.target.files]);
        e.target.value = "";
      }} />
      ${dragging && html`<div class="dragcover">${t("dropAnywhere")}</div>`}
      ${toast && html`<div class="toast" role="status">${toast}</div>`}
    </div>`;
}

// ---------- header pieces ----------
function ThemePicker({ theme, setTheme }) {
  const light = isLight(theme.mode);
  return html`
    <div class="popover" role="dialog" aria-label=${t("theme")}>
      <div style="display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap">
        <h3>${t("theme")}</h3>
        <div class="seggroup" role="group" aria-label="Mode">
          ${["dark", "light", "auto"].map((m) => html`<button type="button" class=${theme.mode === m ? "on" : ""} onClick=${() => setTheme({ mode: m })}>${t(m)}</button>`)}
        </div>
      </div>
      <div class="themegrid">
        ${THEMES.map((th) => {
          const p = palette(th, light);
          return html`<button type="button" class=${"themebtn" + (theme.theme === th[0] ? " on" : "")} aria-pressed=${theme.theme === th[0]} onClick=${() => setTheme({ theme: th[0] })}>
            <span class="swatch" style=${`background:${p.bg};border:1px solid ${p.bd2}`}><i style=${`background:${p.ac}`}></i><b style=${`background:${p.sf2}`}></b></span>
            <span class="small" style="font-weight: 700">${th[0]}</span>
          </button>`;
        })}
      </div>
      <span class="muted small">${t("themeNote")}</span>
    </div>`;
}

// ---------- step 1 ----------
function ImportForm({ importUrl }) {
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    if (!link.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await importUrl(link.trim());
      setLink("");
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };
  return html`
    <form onSubmit=${submit} style="display: flex; flex-direction: column; gap: 8px">
      <div style="display: flex; gap: 10px; flex-wrap: wrap">
        <label class="sr" for="import-url">${t("paste")}</label>
        <input id="import-url" type="url" placeholder=${t("paste")} value=${link} onInput=${(e) => setLink(e.target.value)} style="flex: 1 1 320px; padding: 14px 16px; border-radius: 14px; background: var(--sf); font-size: 15px" />
        <button type="submit" class="btn" disabled=${busy || !link.trim()}>${busy ? t("fetching") : t("fetch")}</button>
      </div>
      ${err && html`<div class="err" role="alert">${err}</div>`}
    </form>`;
}

function AddView({ files, removeFile, resetAll, setView, pickerRef, groups, storage, importUrl }) {
  const has = files.length > 0;
  const totalSize = files.reduce((a, f) => a + f.size, 0);
  const pending = files.filter((f) => f.state !== "ready" && f.state !== "error").length;
  const warnings = [];
  const hevc = files.find((f) => f.info?.vcodec === "hevc");
  if (hevc) warnings.push(t("warnHevc", { x: hevc.name }));
  const scan = files.find((f) => f.kind === "pdf" && f.info?.hasText === false);
  if (scan) warnings.push(t("warnScan", { x: scan.name }));
  const gps = files.filter((f) => f.info?.hasGps).length;
  if (gps) warnings.push(t("warnGps", { n: gps }));
  const max = storage?.maxUpload ? fmtBytes(storage.maxUpload) : "4 GB";

  return html`
    <div>
      <h1>${t("h1")}</h1>
      <p class="lead">${t("sub")}</p>
    </div>
    <button type="button" class=${"drop" + (has ? " compact" : "")} onClick=${() => pickerRef.current?.click()}>
      <span class="circle"><${Icon} d=${I.up} size=${30} /></span>
      <span class="big">${has ? t("dropMore") : t("drop")}</span>
      <span class="muted">${t("dropSub", { max })}</span>
    </button>
    <${ImportForm} importUrl=${importUrl} />
    ${has && html`
      <section class="card" aria-label="Files">
        <div class="cardhead">
          <strong>${files.length} · ${fmtBytes(totalSize)}</strong>
          <button type="button" class="link quiet" onClick=${resetAll}>${t("removeAll")}</button>
        </div>
        ${files.map((f) => html`
          <div class="row" key=${f.name}>
            <span class=${"badge k-" + f.kind}>${f.ext || "?"}</span>
            <div class="grow">
              <span class="ellip" style="font-weight: 600">${f.name}</span>
              ${f.state === "ready" && html`<span class="muted small">${fileMeta(f) || " "}</span>`}
              ${(f.state === "uploading" || f.state === "queued") && html`<div style="display: flex; align-items: center; gap: 10px"><div class="minibar" style="flex: 1"><div style=${`width:${Math.round(f.progress * 100)}%`}></div></div><span class="muted small">${t("uploading", { pct: Math.round(f.progress * 100) })}</span></div>`}
              ${f.state === "checking" && html`<span class="muted small">${t("checking")}</span>`}
              ${f.state === "importing" && html`<div style="display: flex; align-items: center; gap: 10px"><div class="minibar" style="flex: 1"><div style=${`width:${Math.round(f.progress * 100)}%`}></div></div><span class="muted small">${f.progress > 0 ? t("downloadingPct", { pct: Math.round(f.progress * 100) }) : t("downloadingAmt", { x: fmtBytes(f.received || 0) })}</span></div>`}
              ${f.state === "error" && html`<span class="small" style="color: var(--wt)">${t("uploadFailed")}: ${f.error}</span>`}
            </div>
            <span class="mono small" style="flex: none">${fmtBytes(f.size)}</span>
            <button type="button" class="iconbtn" aria-label=${`${t("remove")} ${f.name}`} onClick=${() => removeFile(f.name)}><${Icon} d=${I.x} size=${14} sw=${2.4} /></button>
          </div>`)}
        ${warnings.map((w) => html`<div class="warn"><${Icon} d=${I.warn} /><span>${w}</span></div>`)}
      </section>
      <button type="button" class="btn primary xl" disabled=${!groups.length} onClick=${() => setView("choose")}>
        ${t("next")}${pending ? ` · ${t("uploading", { pct: Math.round((files.reduce((a, f) => a + f.progress * f.size, 0) / Math.max(1, totalSize)) * 100) })}` : ""} →
      </button>`}`;
}

// ---------- step 2 ----------
function ChooseView(p) {
  const { groups, files, setView, start, pending } = p;
  const n = files.filter((f) => f.state !== "error").length;
  return html`
    <div>
      <h1 class="h1s">${t("whatDo")}</h1>
      <p class="lead">${t("chooseSub", { n })}</p>
    </div>
    ${groups.map((g) => html`<${Group} key=${g.kind} g=${g} ...${p} />`)}
    <div class="btnrow">
      <button type="button" class="btn ghost" style="padding: 18px 22px; border-radius: 18px" onClick=${() => setView("add")}>← ${t("back")}</button>
      <button type="button" class="btn primary xl grow1" disabled=${pending > 0} onClick=${start}>
        ${pending ? t("waitUploads", { n: pending }) : n === 1 ? t("convert1") : t("convertN", { n })} →
      </button>
    </div>`;
}

function Group({ g, ui, toggle, setChoice, vals, setVals, over, setOver, custom, setCustom, targets, optsFor, estFile }) {
  const { kind, files: fs, list, recipe } = g;
  const inMb = fs.reduce((a, f) => a + f.size, 0) / MB;
  const otherAll = useMemo(() => {
    const sets = g.exts.map((e) => new Set(targets[e] || []));
    if (!sets.length || sets.some((s) => !s.size)) return [];
    const common = [...sets[0]].filter((x) => sets.every((s) => s.has(x)));
    const own = new Set(list.filter((r) => !r.id.startsWith(GENERIC_PREFIX)).map((r) => r.ext));
    return common.filter((x) => !own.has(x) && !g.exts.includes(x));
  }, [targets, g.exts.join(","), list.length]);
  const showEvery = !!ui[`every-${kind}`] || !COMMON[kind];
  const otherShown = showEvery ? otherAll : otherAll.filter((x) => COMMON[kind].includes(x));

  const v = recipe ? optsFor(recipe, kind) : {};
  const setVal = (id, val) => setVals((all) => ({ ...all, [recipe.id]: { ...(all[recipe.id] || {}), [id]: val } }));
  const overN = fs.filter((f) => over[f.name]).length;
  const open = !!ui[`open-${kind}`], tech = !!ui[`tech-${kind}`], per = !!ui[`per-${kind}`], all = !!ui[`all-${kind}`] || !list.length;
  const info0 = fs[0]?.info || {};
  const settings = recipe ? recipe.settings.filter((s) => s.type !== "trim" || fs.length === 1) : [];

  return html`
    <section class="group">
      <div class="grouphead">
        <h2>${groupNoun(kind, fs.length)}</h2>
        <span class="muted small">${g.exts.map((e) => e.toUpperCase()).join(", ")} · ${fmtMb(inMb)}</span>
      </div>
      ${list.length > 0 && html`
        <div class="choices">
          ${list.map((r, i) => {
            const rv = optsFor(r, kind);
            return html`<button type="button" class=${"choice" + (r === recipe ? " on" : "")} aria-pressed=${r === recipe} onClick=${() => setChoice((c) => ({ ...c, [kind]: r.id }))}>
              <span class="t">${tr(r.title)}${i === 0 && !r.id.startsWith(GENERIC_PREFIX) && html`<span class="rec">${t("best")}</span>`}</span>
              <span class="d">${tr(r.desc)}</span>
              <span class="e">≈ ${fmtMb(estimateMb(r, rv, inMb))}</span>
            </button>`;
          })}
        </div>`}
      ${!list.length && html`<span class="muted">${t("onlyOther")}</span>`}

      ${recipe && html`
        <div class="summary">
          <span style="color: var(--mu); flex: none"><${Icon} d=${I.sliders} /></span>
          <span>${summaryParts(recipe, v, fs.length)}${overN ? ` · ${t("setSeparately", { n: overN })}` : ""}</span>
          <button type="button" aria-expanded=${open} onClick=${() => toggle(`open-${kind}`)}>${open ? t("done") : t("change")}</button>
        </div>`}

      ${recipe && open && html`
        <div class="tune">
          <span class="muted small">${t("settingsFor", { x: tr(recipe.title) })}</span>
          <div class="tunegrid">
            ${settings.length === 0 && html`<span class="muted">—</span>`}
            ${settings.map((s) => html`<${SettingField} key=${recipe.id + s.id} s=${s} v=${v} setVal=${setVal} info=${info0} domId=${`${kind}-${recipe.id}-${s.id}`} />`)}
          </div>
          <div style="border-top: 1px solid var(--bd); padding-top: 12px; display: flex; flex-direction: column; gap: 10px">
            <button type="button" class="link quiet" style="display: flex; gap: 6px; align-items: center; text-decoration: none; font-weight: 700; align-self: flex-start" aria-expanded=${tech} onClick=${() => toggle(`tech-${kind}`)}>
              <${Icon} d=${I.code} size=${14} /> ${tech ? t("techHide") : t("techShow")}
            </button>
            ${tech && html`<div class="tech">${describe(recipe, v, fs.map((f) => f.info || {}), fs.length).join("\n")}</div>`}
          </div>
        </div>`}

      <div style="display: flex; gap: 20px; flex-wrap: wrap">
        ${fs.length > 1 && list.length > 0 && html`<button type="button" class="link" aria-expanded=${per} onClick=${() => toggle(`per-${kind}`)}>${per ? t("perFileDone") : t("perFile", { n: fs.length })}</button>`}
        ${list.length > 0 && html`<button type="button" class="link quiet" aria-expanded=${all} onClick=${() => toggle(`all-${kind}`)}>${all ? t("otherHide") : t("otherShow", { n: otherShown.length })}</button>`}
      </div>

      ${per && html`
        <div class="card" style="overflow: hidden">
          ${fs.map((f) => html`
            <div class="row" key=${f.name} style="flex-wrap: wrap">
              <span class="ellip" style="flex: 1 1 200px; min-width: 0; font-size: 14px">${f.name}</span>
              <label class="sr" for=${"pf-" + f.name}>${f.name}</label>
              <select id=${"pf-" + f.name} value=${over[f.name] || ""} onChange=${(e) => setOver((o) => ({ ...o, [f.name]: e.target.value || undefined }))}>
                <option value="">${t("sameAsGroup", { x: tr(recipe?.title || "") })}</option>
                ${list.map((r) => html`<option value=${r.id}>${tr(r.title)}</option>`)}
              </select>
              <span class="muted small" style="min-width: 70px; text-align: right">≈ ${fmtMb(estFile(f, g))}</span>
            </div>`)}
        </div>`}

      ${all && html`
        <div class="fmtchips">
          ${otherAll.length === 0 && html`<span class="muted small">${t("otherNone")}</span>`}
          ${otherShown.map((x) => html`<button type="button" class=${custom[kind] === x && recipe?.id === GENERIC_PREFIX + x ? "on" : ""} onClick=${() => {
            setCustom((c) => ({ ...c, [kind]: x }));
            setChoice((c) => ({ ...c, [kind]: GENERIC_PREFIX + x }));
          }}>${x}</button>`)}
          ${otherShown.length < otherAll.length && html`<button type="button" class="link quiet" style="border: 0; background: none" onClick=${() => toggle(`every-${kind}`)}>${t("showAllN", { n: otherAll.length })}</button>`}
        </div>`}
    </section>`;
}

function SettingField({ s, v, setVal, info, domId }) {
  if (s.type === "seg") {
    return html`<div class="field"><span class="lab">${tr(s.label)}</span>
      <div class="segs" role="group" aria-label=${tr(s.label)} style=${`grid-template-columns: repeat(${s.opts.length}, minmax(0, 1fr))`}>
        ${s.opts.map((o, i) => html`<button type="button" class=${v[s.id] === i ? "on" : ""} aria-pressed=${v[s.id] === i} onClick=${() => setVal(s.id, i)}>${tr(o)}</button>`)}
      </div></div>`;
  }
  if (s.type === "select") {
    return html`<div class="field"><label class="lab" for=${domId}>${tr(s.label)}</label>
      <select id=${domId} value=${String(v[s.id])} onChange=${(e) => setVal(s.id, Number(e.target.value))}>
        ${s.opts.map((o, i) => html`<option value=${String(i)}>${tr(o)}</option>`)}
      </select></div>`;
  }
  if (s.type === "check") {
    return html`<label class="check"><input type="checkbox" checked=${!!v[s.id]} onChange=${() => setVal(s.id, !v[s.id])} /><span><strong>${tr(s.label)}</strong><small>${tr(s.hint)}</small></span></label>`;
  }
  if (s.type === "trim") {
    const tv = v.trim || {};
    const end = info.duration ? toClock(info.duration) : "";
    return html`<div class="field"><span class="lab">${tr(s.label)}</span>
      <span style="display: flex; gap: 8px; align-items: center" class="muted">
        <input class="timein" type="text" inputmode="numeric" aria-label="Start" placeholder="00:00" value=${tv.start || ""} onInput=${(e) => setVal("trim", { ...tv, start: e.target.value || undefined })} />
        –
        <input class="timein" type="text" inputmode="numeric" aria-label="End" placeholder=${end || "end"} value=${tv.end || ""} onInput=${(e) => setVal("trim", { ...tv, end: e.target.value || undefined })} />
      </span></div>`;
  }
  return html`<span class="muted" style="font-size: 14px; line-height: 1.5">${tr(s.text)}</span>`;
}

// ---------- step 3 ----------
function GetView({ job, jobId, setJob, resetAll, flash }) {
  const [showDetail, setShowDetail] = useState({});
  if (!job) return null;
  const items = job.items;
  const busy = items.some((i) => i.status === "queued" || i.status === "running");
  const done = items.filter((i) => i.status === "done");
  const failed = items.filter((i) => i.status === "failed");
  const avg = items.length ? Math.round(items.reduce((a, i) => a + (i.status === "done" || i.status === "failed" ? 100 : i.progress), 0) / items.length) : 0;
  const inDone = done.reduce((a, i) => a + i.inSize, 0), outDone = done.reduce((a, i) => a + (i.outSize || 0), 0);
  const retry = async (it, tolerant) => {
    try {
      setJob(await api.retry(jobId, it.id, tolerant));
    } catch (e) {
      flash(e.message);
    }
  };

  return html`
    ${busy && html`<div><h1 class="h1s">${t("working")}</h1><p class="lead">${t("workingSub")}</p></div>`}
    ${!busy && html`
      <div class="donehead">
        <span class=${"doneicon" + (failed.length ? " warnicon" : "")}><${Icon} d=${failed.length ? I.warn : I.check} size=${32} sw=${2.6} /></span>
        <div>
          <h1 class="h1s">${failed.length ? t("someReady", { d: done.length, n: items.length, f: failed.length }) : t("allReady", { n: items.length })}</h1>
          ${inDone > 0 && html`<p class="lead" style="margin-top: 6px">${outDone < inDone ? t("savedLine", { a: fmtBytes(inDone), b: fmtBytes(outDone), p: Math.round((1 - outDone / inDone) * 100) }) : t("savedLineBigger", { a: fmtBytes(inDone), b: fmtBytes(outDone) })}${job.keepUntil ? ` · ${untilText(job.keepUntil)}` : ""}</p>`}
        </div>
      </div>`}
    <div style="display: flex; flex-direction: column; gap: 8px">
      <div class="kv"><span>${busy ? t("convertingN", { n: items.length, p: avg }) : t("doneOf", { d: done.length, n: items.length })}</span><span></span></div>
      <div class="bigbar"><div style=${`width:${avg}%`}></div></div>
    </div>
    <section class="card" aria-label="Results">
      ${items.map((it) => {
        const outExt = (it.outName || "").split(".").pop() || getRecipe(it.recipe, "other")?.ext || "";
        const name = it.outName || it.inputs[0].replace(/\.[^.]+$/, "") + "." + (getRecipe(it.recipe, "other")?.ext || "");
        const kind = kindOf(extOf(it.inputs[0]));
        const status = it.status === "done" ? t("statusDone") : it.status === "failed" ? t("statusFailed") : it.status === "queued" ? (it.queuePos > 0 ? t("waitingAhead", { n: it.queuePos }) : t("waiting")) : `${it.progress}%`;
        return html`<div class="result" key=${it.id}>
          <div class="line">
            <span class=${"badge k-" + kind}>${outExt}</span>
            <div class="grow" style="flex: 1 1 220px">
              <span class="ellip" style="font-weight: 600">${name}</span>
              <span class="muted small ellip">${it.inputs.length > 1 ? `${it.inputs.length} files` : it.inputs[0]}</span>
            </div>
            <span class="mono small">${fmtBytes(it.inSize)} → ${it.status === "done" ? fmtBytes(it.outSize) : "…"}</span>
            <span class=${"status " + it.status}>${status}</span>
            ${it.status === "done" && html`<span class="links"><a href=${fileUrl(jobId, it.id)} target="_blank" rel="noopener">${t("preview")}</a><a href=${fileUrl(jobId, it.id, true)}>${t("download")}</a></span>`}
          </div>
          ${it.status === "running" && html`<div class="minibar"><div style=${`width:${it.progress}%`}></div></div>`}
          ${it.status === "failed" && html`
            <div class="fail">
              <span>${it.error}</span>
              <span style="display: flex; gap: 10px; flex-wrap: wrap">
                ${it.detail && html`<button type="button" class="link quiet" style="color: var(--wt)" onClick=${() => setShowDetail((d) => ({ ...d, [it.id]: !d[it.id] }))}>${showDetail[it.id] ? t("hideDetail") : t("showDetail")}</button>`}
                <button type="button" class="btn warnbtn" onClick=${() => retry(it, it.fixable)}>${it.fixable ? t("fixRetry") : t("tryAgain")}</button>
              </span>
            </div>
            ${showDetail[it.id] && html`<div class="tech">${it.detail}</div>`}`}
        </div>`;
      })}
    </section>
    ${!busy && html`
      <div class="btnrow">
        ${done.length > 1 && html`<a class="btn primary xl grow1" style="text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 10px" href=${zipUrl(jobId)}><${Icon} d=${I.down} size=${22} sw=${2.4} /> ${t("downloadAll", { n: done.length })}</a>`}
        ${done.length === 1 && html`<a class="btn primary xl grow1" style="text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 10px" href=${fileUrl(jobId, done[0].id, true)}><${Icon} d=${I.down} size=${22} sw=${2.4} /> ${t("downloadOne", { x: done[0].outName })}</a>`}
        <button type="button" class="btn ghost" style="padding: 18px 22px; border-radius: 18px" onClick=${resetAll}>${t("again")}</button>
      </div>`}`;
}

// ---------- history ----------
function historyTitle(h) {
  const r = h.recipes.map((id) => getRecipe(id, "other")).filter(Boolean);
  const to = [...new Set(r.map((x) => tr(x.title)))].join(", ");
  return `${plural(h.inputs, t("other"))} → ${to || "?"}`;
}

function HistoryView({ history, setHistory, openJob, resetAll, flash }) {
  const act = async (fn) => {
    try {
      await fn();
      setHistory(await api.history());
    } catch (e) {
      flash(e.message);
    }
  };
  return html`
    <div style="display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap">
      <div><h1 class="h1s">${t("history")}</h1><p class="lead">${t("histSub")}</p></div>
      <button type="button" class="btn primary" onClick=${resetAll}>${t("newConversion")}</button>
    </div>
    ${history && !history.length && html`<p class="muted">${t("nothingYet")}</p>`}
    ${(history || []).map((h) => html`
      <div class="card hist" key=${h.id}>
        <div class="grow" style="flex: 1 1 260px">
          <span style="font-weight: 700; font-size: 16px">${historyTitle(h)}</span>
          <span class="muted small">${relTime(h.created)} · ${fmtBytes(h.inSize)} → ${fmtBytes(h.outSize)}${h.failed ? ` · ${h.failed} ✕` : ""}</span>
        </div>
        <span class="small" style=${h.keepUntil === "forever" ? "color: var(--okf)" : "color: var(--mu)"}>${untilText(h.keepUntil)}</span>
        <span class="links" style="flex-wrap: wrap">
          <button type="button" class="link" onClick=${() => openJob(h.id)}>${t("open")}</button>
          ${h.done > 0 && html`<a href=${zipUrl(h.id)} style="font-weight: 700; font-size: 14px">${t("download")}</a>`}
          <button type="button" class="link" onClick=${() => act(() => api.keep(h.id, h.keepUntil === "forever" ? 24 : -1))}>${h.keepUntil === "forever" ? t("stopKeeping") : t("keepForever")}</button>
          <button type="button" class="link quiet" onClick=${() => confirm(t("confirmDelete")) && act(() => api.deleteJob(h.id))}>${t("del")}</button>
        </span>
      </div>`)}`;
}

// ---------- side column ----------
function SideAdd({ history, shortcut, setView }) {
  return html`
    <section class="card pad">
      <h3>${t("shortcuts")}</h3>
      ${[["image", "img-jpg", "scHeic"], ["video", "vid-whatsapp", "scWa"], ["image", "img-pdf", "scPdf"], ["video", "vid-mp3", "scMp3"]].map(([k, id, key]) => html`
        <button type="button" class="sc" onClick=${() => shortcut(k, id)}><span style="font-weight: 700">${t(key)}</span><span class="muted small">${t(key + "D")}</span></button>`)}
    </section>
    <section class="card pad">
      <h3>${t("recent")}</h3>
      ${history && !history.length && html`<span class="muted small">${t("nothingYet")}</span>`}
      ${(history || []).slice(0, 3).map((h) => html`<div class="kv" style="padding: 6px 0; border-bottom: 1px solid var(--bd)"><span style="color: var(--tx)">${historyTitle(h)}</span><span class="muted" style="white-space: nowrap">${untilText(h.keepUntil)}</span></div>`)}
      ${history?.length > 0 && html`<button type="button" class="link quiet" style="align-self: flex-start" onClick=${() => setView("history")}>${t("seeAll")}</button>`}
    </section>`;
}

function SideChoose({ groups, files, estFile, keepHours, setKeepHours, queue, recipeForFile }) {
  const live = files.filter((f) => f.state !== "error");
  const inMb = live.reduce((a, f) => a + f.size, 0) / MB;
  let outMb = 0, secs = 0;
  for (const g of groups) {
    for (const f of g.files) {
      outMb += estFile(f, g);
      const dur = f.info?.duration || 0;
      const r = recipeForFile(f, g);
      if (r && /transcript|subs/.test(r.id)) secs += dur * 0.35 + 10;
      else if (r && r.id.startsWith("pdf-ocr")) secs += (f.info?.pages || 3) * 4;
      else secs += f.kind === "video" ? dur * 0.7 + 3 : f.kind === "audio" ? dur * 0.05 + 2 : f.kind === "image" ? 1 : 5;
    }
  }
  const ahead = queue.running + queue.waiting;
  return html`
    <section class="card pad">
      <h3>${t("youGet")}</h3>
      ${groups.map((g) => {
        const counts = new Map();
        for (const f of g.files) {
          const r = recipeForFile(f, g);
          if (!r) continue;
          const key = r.merge ? `${g.files.filter((x) => recipeForFile(x, g) === r).length} → 1 ${tr(r.title).replace(/^(One|Un) /, "")}` : tr(r.title);
          counts.set(key, (counts.get(key) || 0) + (r.merge ? 0 : 1));
        }
        const mb = g.files.reduce((a, f) => a + estFile(f, g), 0);
        return html`<div class="kv" style="padding-bottom: 10px; border-bottom: 1px solid var(--bd)">
          <span style="color: var(--tx); font-weight: 700">${[...counts].map(([k, n]) => (n ? `${n} × ${k}` : k)).join(", ")}</span>
          <span class="muted" style="white-space: nowrap">≈ ${fmtMb(mb)}</span>
        </div>`;
      })}
      <div class="tiles2">
        <div class="tile"><small>${t("before")}</small><b>${fmtMb(inMb)}</b></div>
        <div class="tile"><small>${t("after")}</small><b style="color: var(--ln)">${fmtMb(outMb)}</b></div>
      </div>
      <div class="kv"><span>${t("time")}</span><span>${secs < 60 ? t("sec", { n: Math.max(5, Math.round(secs / 5) * 5) }) : t("min", { n: Math.round(secs / 60) })}</span></div>
      <div class="kv"><span>${t("queue")}</span><span>${ahead ? t("queueBusy", { n: ahead }) : t("queueFree")}</span></div>
      <label class="field" style="font-size: 14px">
        <span>${t("keepFor")}</span>
        <select value=${String(keepHours)} onChange=${(e) => setKeepHours(Number(e.target.value))}>
          ${KEEP_HOURS.map((h, i) => html`<option value=${String(h)}>${t("keep")[i]}</option>`)}
        </select>
      </label>
    </section>`;
}

function QR({ text }) {
  const svg = useMemo(() => {
    const q = qrcode(0, "M");
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  }, [text]);
  return html`<div class="qr" role="img" aria-label=${t("qrLabel")} dangerouslySetInnerHTML=${{ __html: svg }}></div>`;
}

function ShareCard({ job, jobId, setJob, flash, publicUrl }) {
  const [choice, setChoice] = useState("24h");
  const [copied, setCopied] = useState(null);
  const done = job.items.filter((i) => i.status === "done");
  if (!done.length) return null;
  // LAN visitors would otherwise hand out http://lasgatas:3010 links that only work at home
  const linkFor = (token) => (publicUrl ? `${publicUrl}/s/${token}` : `${location.origin}${url(`/s/${token}`)}`);
  const latest = job.shares?.[0];
  const make = async () => {
    try {
      await api.share(jobId, choice, done.length === 1 ? done[0].id : undefined);
      setJob(await api.job(jobId));
    } catch (e) {
      flash(e.message);
    }
  };
  const copy = async (token) => {
    try {
      await navigator.clipboard.writeText(linkFor(token));
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      flash(linkFor(token));
    }
  };
  const stop = async (token) => {
    try {
      await api.unshare(jobId, token);
      setJob(await api.job(jobId));
    } catch (e) {
      flash(e.message);
    }
  };
  return html`
    <section class="card pad">
      <h3>${t("shareTitle")}</h3>
      ${latest && html`
        <div style="display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center">
          <${QR} text=${linkFor(latest.token)} />
          <strong>${t("phone")}</strong>
          <span class="muted small">${t("phoneSub")}</span>
        </div>`}
      ${(job.shares || []).map((s) => html`
        <div style="display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid var(--bd)" key=${s.token}>
          <div style="display: flex; gap: 8px">
            <input type="text" readonly value=${linkFor(s.token)} aria-label=${t("shareTitle")} class="mono" style="flex: 1; min-width: 0; font-size: 12px" onFocus=${(e) => e.target.select()} />
            <button type="button" class="btn" style="padding: 8px 12px; border-radius: 10px" onClick=${() => copy(s.token)}>${copied === s.token ? t("copied") : t("copy")}</button>
          </div>
          <div class="kv small"><span>${s.once ? t("shareOnce") : t("shareUntil", { x: relTime(s.expires) })}</span><button type="button" class="link quiet" style="font-size: 13px" onClick=${() => stop(s.token)}>${t("stopSharing")}</button></div>
        </div>`)}
      <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
        <label class="sr" for="share-choice">${t("linkWorks")}</label>
        <select id="share-choice" value=${choice} onChange=${(e) => setChoice(e.target.value)} style="flex: 1 1 140px">
          ${["24h", "3d", "7d", "once"].map((c) => html`<option value=${c}>${t("shareChoice_" + c)}</option>`)}
        </select>
        <button type="button" class="btn primary" style="padding: 10px 14px; border-radius: 10px" onClick=${make}>${latest ? t("newLink") : t("makeLink")}</button>
      </div>
    </section>`;
}

function SideGet({ job, jobId, setJob, flash, session }) {
  if (!job) return null;
  const current = job.keepUntil === "forever" ? -1 : null;
  return html`
    <${ShareCard} job=${job} jobId=${jobId} setJob=${setJob} flash=${flash} publicUrl=${session?.publicUrl} />
    <section class="card pad">
      <h3>${t("keepLonger")}</h3>
      <span class="muted small">${untilText(job.keepUntil) || ""}</span>
      <select value=${current == null ? "" : String(current)} onChange=${async (e) => {
        if (!e.target.value) return;
        try {
          setJob(await api.keep(jobId, Number(e.target.value)));
        } catch (err) {
          flash(err.message);
        }
      }}>
        <option value="">—</option>
        ${KEEP_HOURS.map((h, i) => html`<option value=${String(h)}>${t("keep")[i]}</option>`)}
      </select>
    </section>`;
}

function ServerCard({ storage }) {
  return html`
    <section class="card pad">
      <div class="kv"><strong style="color: var(--tx)">${t("server")}</strong><span class="ok" style="display: flex; align-items: center; gap: 6px"><span class="dot"></span>${t("running")}</span></div>
      ${storage && html`<div class="kv"><span>${t("yourSpace")}</span><span>${fmtBytes(storage.used)}</span></div>`}
      ${storage && html`<div class="kv"><span>${t("biggest")}</span><span>${fmtBytes(storage.maxUpload)}</span></div>`}
    </section>`;
}

// ---------- login / first-run ----------
function Auth({ session, onDone, lang, changeLang }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const setup = session.firstRun;
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const ok = await formPost(setup ? "/register" : "/login", { email, password });
      const s = await api.session();
      if (ok && s.loggedIn) onDone();
      else setErr(t("badLogin"));
    } catch {
      setErr(t("badLogin"));
    } finally {
      setBusy(false);
    }
  };
  return html`
    <div class="authbox">
      <div style="display: flex; justify-content: space-between; align-items: center">
        <span class="brand"><span style="color: var(--ac)"><${Icon} d=${I.logo} size=${26} sw=${2.2} /></span> Convert</span>
        <div class="seggroup" role="group" aria-label="Language">
          <button type="button" class=${lang === "en" ? "on" : ""} onClick=${() => changeLang("en")}>EN</button>
          <button type="button" class=${lang === "es" ? "on" : ""} onClick=${() => changeLang("es")}>ES</button>
        </div>
      </div>
      <div><h1 class="h1s">${setup ? t("setup") : t("login")}</h1><p class="lead">${setup ? t("setupSub") : t("loginSub")}</p></div>
      ${err && html`<div class="err" role="alert">${err}</div>`}
      <form onSubmit=${submit}>
        <label>${t("email")}<input type="email" autocomplete="email" required value=${email} onInput=${(e) => setEmail(e.target.value)} /></label>
        <label>${t("password")}<input type="password" autocomplete=${setup ? "new-password" : "current-password"} required value=${password} onInput=${(e) => setPassword(e.target.value)} /></label>
        <button type="submit" class="btn primary xl" disabled=${busy}>${setup ? t("createAccount") : t("signIn")}</button>
      </form>
    </div>`;
}

document.documentElement.lang = getLang();
render(html`<${App} />`, document.getElementById("app"));
