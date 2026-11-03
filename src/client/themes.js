// name, neutral hue, neutral saturation, accent on dark, accent on light, text on dark accent, text on light accent
export const THEMES = [
  ["Amber", 215, 22, "#fbbf24", "#b45309", "#1c1917", "#ffffff"],
  ["Ocean", 205, 30, "#38bdf8", "#0369a1", "#082f49", "#ffffff"],
  ["Mint", 165, 18, "#34d399", "#047857", "#052e1c", "#ffffff"],
  ["Grape", 265, 22, "#a78bfa", "#6d28d9", "#1e1033", "#ffffff"],
  ["Rose", 345, 16, "#fb7185", "#be123c", "#2a0a12", "#ffffff"],
  ["Tangerine", 25, 16, "#fb923c", "#c2410c", "#1c0f06", "#ffffff"],
  ["Teal", 185, 24, "#2dd4bf", "#0f766e", "#042f2e", "#ffffff"],
  ["Cobalt", 225, 34, "#60a5fa", "#1d4ed8", "#0b1530", "#ffffff"],
  ["Lime", 85, 12, "#a3e635", "#4d7c0f", "#1a2e05", "#ffffff"],
  ["Cherry", 0, 12, "#f87171", "#b91c1c", "#2a0808", "#ffffff"],
  ["Sakura", 330, 22, "#f9a8d4", "#be185d", "#2a0a1c", "#ffffff"],
  ["Lavender", 250, 20, "#c4b5fd", "#5b21b6", "#1a1033", "#ffffff"],
  ["Forest", 140, 20, "#4ade80", "#15803d", "#052e12", "#ffffff"],
  ["Sand", 35, 18, "#e7c08a", "#8a5a0b", "#231a0b", "#ffffff"],
  ["Graphite", 220, 5, "#e5e7eb", "#18181b", "#111827", "#ffffff"],
  ["Fjord", 215, 18, "#88c0d0", "#2e6787", "#16232e", "#ffffff"],
  ["Neon", 285, 28, "#e879f9", "#a21caf", "#2a0a2e", "#ffffff"],
  ["Gold", 45, 12, "#facc15", "#a16207", "#1c1600", "#ffffff"],
  ["Copper", 18, 14, "#f0a37a", "#9a3412", "#2a1206", "#ffffff"],
  ["Arctic", 195, 26, "#a5f3fc", "#0e7490", "#083344", "#ffffff"],
];

export function palette(th, light) {
  const [, h, s, accD, accL, onD, onL] = th;
  const hsl = (sat, l) => `hsl(${h} ${sat}% ${l}%)`;
  return light
    ? {
        bg: hsl(s, 97), sf: hsl(s, 100), sf2: hsl(s, 93), bd: hsl(s, 88), bd2: hsl(s, 78),
        tx: hsl(25, 12), mu: hsl(10, 36), fa: hsl(8, 42),
        ac: accL, on: onL, ln: accL, acs: `color-mix(in srgb, ${accL} 12%, white)`,
        okb: "#dcfce7", okf: "#15803d", wb: "#fff7ed", wbd: "#fdba74", wt: "#9a3412", wbtn: "#c2410c", wbtnt: "#ffffff",
      }
    : {
        bg: hsl(s, 7), sf: hsl(s, 10), sf2: hsl(s, 14), bd: hsl(s, 18), bd2: hsl(s, 25),
        tx: hsl(20, 95), mu: hsl(12, 68), fa: hsl(10, 52),
        ac: accD, on: onD, ln: accD, acs: `color-mix(in srgb, ${accD} 15%, ${hsl(s, 10)})`,
        okb: "#14532d", okf: "#86efac", wb: "#2a1708", wbd: "#7c2d12", wt: "#fed7aa", wbtn: "#fb923c", wbtnt: "#1c1917",
      };
}

const KEY = "cx-theme";
export const DEFAULT_THEME = "Fjord";

export function loadTheme() {
  try {
    const t = JSON.parse(localStorage.getItem(KEY) || "{}");
    return { theme: THEMES.some((x) => x[0] === t.theme) ? t.theme : DEFAULT_THEME, mode: ["dark", "light", "auto"].includes(t.mode) ? t.mode : "auto" };
  } catch {
    return { theme: DEFAULT_THEME, mode: "auto" };
  }
}

export function saveTheme(t) {
  try {
    localStorage.setItem(KEY, JSON.stringify(t));
  } catch {
    /* private mode: theme just won't persist */
  }
}

const mq = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;

export function isLight(mode) {
  return mode === "light" || (mode === "auto" && !!mq?.matches);
}

export function applyTheme({ theme, mode }) {
  const th = THEMES.find((x) => x[0] === theme) || THEMES[0];
  const light = isLight(mode);
  const p = palette(th, light);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(p)) root.style.setProperty(`--${k}`, v);
  root.dataset.mode = light ? "light" : "dark";
  root.style.colorScheme = light ? "light" : "dark";
  const meta = document.querySelector('meta[name="theme-color"]') || Object.assign(document.head.appendChild(document.createElement("meta")), { name: "theme-color" });
  meta.content = p.bg;
}

export function onSystemModeChange(fn) {
  mq?.addEventListener?.("change", fn);
}
