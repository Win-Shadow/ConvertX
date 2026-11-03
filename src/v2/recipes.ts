// Shared between server and client bundle: keep this file free of node/bun imports.

export type Kind = "image" | "video" | "audio" | "pdf" | "doc" | "ebook" | "other";

const EXT_KIND: Record<Kind, string[]> = {
  image: ["jpg", "jpeg", "png", "heic", "heif", "webp", "avif", "gif", "bmp", "tif", "tiff", "jxl", "jp2", "raw", "dng", "cr2", "nef", "arw", "psd", "ico", "tga"],
  video: ["mp4", "mov", "m4v", "mkv", "avi", "webm", "wmv", "flv", "mpg", "mpeg", "3gp", "ts", "mts", "m2ts", "ogv", "vob"],
  audio: ["mp3", "m4a", "aac", "wav", "flac", "ogg", "oga", "opus", "wma", "aiff", "aif", "amr", "caf"],
  pdf: ["pdf"],
  doc: ["doc", "docx", "odt", "rtf", "txt", "md", "html", "htm", "pages", "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp", "key"],
  ebook: ["epub", "mobi", "azw", "azw3", "fb2", "cbz", "cbr"],
  other: [],
};

export function kindOf(ext: string): Kind {
  const e = ext.toLowerCase();
  for (const k of Object.keys(EXT_KIND) as Kind[]) {
    if (EXT_KIND[k].includes(e)) return k;
  }
  return "other";
}

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export type SettingType = "seg" | "select" | "check" | "trim" | "info";

export interface Setting {
  id: string;
  type: SettingType;
  label: string;
  opts?: string[];
  def?: number | boolean;
  suffix?: string;
  hint?: string;
  on?: string | null;
  off?: string | null;
  text?: string;
}

export type OptionValues = Record<string, number | boolean | { start?: string; end?: string }>;

// Probe info the server returns per uploaded file (all optional).
export interface FileInfo {
  width?: number;
  height?: number;
  duration?: number;
  vcodec?: string;
  acodec?: string;
  hasGps?: boolean;
  camera?: string;
  pages?: number;
  hasText?: boolean;
}

export interface Step {
  cmd: string;
  args: string[];
  stdoutTo?: string; // write the command's stdout to this file
  progress?: "ffmpeg" | "whisper";
}

export interface PlanCtx {
  inputs: string[]; // absolute paths, >1 only for merge recipes
  output: string;
  tmp: string; // scratch dir
  opts: OptionValues;
  info: FileInfo[];
  tolerant?: boolean; // retry mode for damaged files
}

export interface Recipe {
  id: string;
  kind: Kind;
  title: string;
  desc: string;
  factor: number; // rough output/input size ratio for estimates
  ext: string;
  settings: Setting[];
  merge?: boolean;
  accepts?: string[]; // limit to these input extensions
  rejects?: string[];
  plan: (c: PlanCtx) => Step[];
}

// ---------- setting helpers ----------
const SEG = (id: string, label: string, opts: string[], def: number, suffix = ""): Setting => ({ id, type: "seg", label, opts, def, suffix });
const SEL = (id: string, label: string, opts: string[], def: number): Setting => ({ id, type: "select", label, opts, def });
const CHK = (id: string, label: string, hint: string, def: boolean, on: string | null, off: string | null): Setting => ({ id, type: "check", label, hint, def, on, off });
const TRIM: Setting = { id: "trim", type: "trim", label: "Trim (start to end)" };
const INFO = (text: string): Setting => ({ id: "info", type: "info", label: "", text });

const Q = SEG("q", "Quality", ["Smaller", "Balanced", "Best"], 1, " quality");
const SIZE = SEL("size", "Size", ["Original size", "Max 2048 px — sharing", "Max 1080 px — social"], 0);
const GPS = CHK("gps", "Remove location", "No one can see where photos were taken", true, "location removed", "location kept");
const DATE = CHK("date", "Keep date taken", "Photos stay in order in your gallery", true, null, "date removed");
const NORM = (def: boolean) => CHK("norm", "Even out the volume", "Quiet parts get louder, loud parts softer", def, "volume evened out", null);
const OCR_LANG = SEL("lang", "Language on the page", ["English + Spanish", "English", "Spanish"], 0);
const OCR_CODES = ["eng+spa", "eng", "spa"];
const STRAIGHT = CHK("deskew", "Straighten crooked pages", "Fixes tilted phone scans", true, "pages straightened", null);
const SPOKEN = SEL("lang", "Language spoken", ["Detect automatically", "Spanish", "English"], 0);
const SPOKEN_CODES = ["auto", "es", "en"];
const STAMPS = CHK("ts", "Include timestamps", "Shows when each line was said", false, "with timestamps", null);

export const WHISPER_MODEL = "/opt/whisper/ggml-small.bin";
const stripExt = (p: string) => p.replace(/\.[^./\\]+$/, "");

// Whisper wants 16 kHz mono WAV; ffmpeg handles trimming and any input format first.
function whisperSteps(c: PlanCtx, mode: "txt" | "srt"): Step[] {
  const wav = `${c.tmp}/speech.wav`;
  const lang = SPOKEN_CODES[num(c.opts, "lang")]!;
  const base = ["-m", WHISPER_MODEL, "-f", wav, "-l", lang, "-t", "6", "-pp"];
  const steps: Step[] = [{ cmd: "ffmpeg", args: [...videoIn(c), "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], progress: "ffmpeg" }];
  if (mode === "srt") steps.push({ cmd: "whisper-cli", args: [...base, "-osrt", "-of", stripExt(c.output)], progress: "whisper" });
  else if (flag(c.opts, "ts")) steps.push({ cmd: "whisper-cli", args: [...base], stdoutTo: c.output, progress: "whisper" });
  else steps.push({ cmd: "whisper-cli", args: [...base, "-otxt", "-of", stripExt(c.output)], progress: "whisper" });
  return steps;
}

export function defaults(r: Recipe): OptionValues {
  const v: OptionValues = {};
  for (const s of r.settings) {
    if (s.def !== undefined) v[s.id] = s.def;
  }
  return v;
}

export function resolveOpts(r: Recipe, given: OptionValues | undefined): OptionValues {
  const v = defaults(r);
  for (const s of r.settings) {
    const g = given?.[s.id];
    if (g === undefined) continue;
    if (s.type === "seg" || s.type === "select") {
      const n = Number(g);
      if (Number.isInteger(n) && n >= 0 && n < (s.opts?.length ?? 0)) v[s.id] = n;
    } else if (s.type === "check") {
      v[s.id] = Boolean(g);
    } else if (s.type === "trim" && typeof g === "object") {
      const t: { start?: string; end?: string } = {};
      if (isTime(g.start)) t.start = g.start;
      if (isTime(g.end)) t.end = g.end;
      v[s.id] = t;
    }
  }
  return v;
}

export function isTime(s: unknown): s is string {
  return typeof s === "string" && /^\d{1,2}(:\d{1,2}){0,2}(\.\d+)?$/.test(s);
}

const num = (v: OptionValues, id: string) => Number(v[id] ?? 0);
const flag = (v: OptionValues, id: string) => Boolean(v[id]);

function trimArgs(v: OptionValues): string[] {
  const t = v.trim as { start?: string; end?: string } | undefined;
  const a: string[] = [];
  if (t?.start && t.start !== "0" && !/^0+(:0+)*$/.test(t.start)) a.push("-ss", t.start);
  if (t?.end) a.push("-to", t.end);
  return a;
}

// ---------- image ----------
const JQ = [70, 85, 95];
const WQ = [60, 78, 92];
const RES = [0, 2048, 1080];

function vipsSave(input: string, output: string, saveOpts: string, size: number): Step {
  if (size > 0) {
    return { cmd: "vips", args: ["thumbnail", input, `${output}[${saveOpts}]`, String(size), "--height", String(size), "--size", "down"] };
  }
  return { cmd: "vips", args: ["copy", input, `${output}[${saveOpts}]`] };
}

function exifSteps(output: string, v: OptionValues): Step[] {
  const a: string[] = [];
  if (flag(v, "gps")) a.push("-gps:all=");
  if (v.date === false) a.push("-DateTimeOriginal=", "-CreateDate=", "-ModifyDate=");
  if (!a.length) return [];
  return [{ cmd: "exiftool", args: ["-q", "-overwrite_original", ...a, output] }];
}

const imageRecipes: Recipe[] = [
  {
    id: "img-jpg", kind: "image", title: "JPG", desc: "Opens on every phone, computer and website.", factor: 0.42, ext: "jpg",
    settings: [Q, SIZE, GPS, DATE],
    plan: ({ inputs, output, opts: v }) => [vipsSave(inputs[0]!, output, `Q=${JQ[num(v, "q")]}`, RES[num(v, "size")]!), ...exifSteps(output, v)],
  },
  {
    id: "img-pdf", kind: "image", title: "One PDF", desc: "All photos in one document, in order.", factor: 0.5, ext: "pdf", merge: true,
    settings: [SEL("page", "Page size", ["Fit each photo", "Letter", "A4"], 1), SEL("order", "Order", ["As added", "By file name"], 0), Q],
    plan: ({ inputs, output, tmp, opts: v }) => {
      const files = num(v, "order") === 1 ? [...inputs].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : inputs;
      const steps: Step[] = files.map((f, i) => vipsSave(f, `${tmp}/p${String(i).padStart(4, "0")}.jpg`, `Q=${JQ[num(v, "q")]},keep=none`, 2480));
      const page = ["", "Letter", "A4"][num(v, "page")];
      const jpgs = files.map((_, i) => `${tmp}/p${String(i).padStart(4, "0")}.jpg`);
      steps.push({ cmd: "img2pdf", args: [...(page ? ["--pagesize", page, "--fit", "into", "--border", "0.5cm"] : []), ...jpgs, "-o", output] });
      return steps;
    },
  },
  {
    id: "img-png", kind: "image", title: "PNG", desc: "Highest quality, much larger files.", factor: 2.2, ext: "png",
    settings: [SIZE, GPS],
    plan: ({ inputs, output, opts: v }) => [vipsSave(inputs[0]!, output, "compression=6", RES[num(v, "size")]!), ...exifSteps(output, v)],
  },
  {
    id: "img-webp", kind: "image", title: "WEBP", desc: "Smallest files for sharing online.", factor: 0.18, ext: "webp",
    settings: [Q, SIZE, GPS],
    plan: ({ inputs, output, opts: v }) => [vipsSave(inputs[0]!, output, `Q=${WQ[num(v, "q")]}`, RES[num(v, "size")]!), ...exifSteps(output, v)],
  },
];

const imageExtra: Recipe[] = [
  {
    id: "img-txt", kind: "image", title: "Text from photo", desc: "Reads the words in a photo of a document or sign.", factor: 0.001, ext: "txt",
    settings: [OCR_LANG],
    plan: ({ inputs, output, tmp, opts: v }) => [
      { cmd: "vips", args: ["copy", inputs[0]!, `${tmp}/ocr.png`] },
      { cmd: "tesseract", args: [`${tmp}/ocr.png`, stripExt(output), "-l", OCR_CODES[num(v, "lang")]!] },
    ],
  },
];

// ---------- video ----------
const CRF = [28, 23, 18];
const VRES = [0, 1080, 720];

function videoIn(c: PlanCtx): string[] {
  const a = ["-hide_banner", "-y", "-progress", "pipe:1", "-nostats"];
  if (c.tolerant) a.push("-err_detect", "ignore_err", "-fflags", "+genpts+discardcorrupt");
  return [...a, ...trimArgs(c.opts), "-i", c.inputs[0]!];
}

const videoRecipes: Recipe[] = [
  {
    id: "vid-mp4", kind: "video", title: "MP4", desc: "Plays on phones, every TV and in WhatsApp.", factor: 0.4, ext: "mp4",
    settings: [SEL("res", "Resolution", ["Keep original", "1080p — TVs and phones", "720p — smaller"], 1), Q,
      CHK("h264", "Play on any TV", "Converts HEVC to H.264, which everything supports", true, "plays on any TV", "keeps HEVC"), TRIM],
    plan: (c) => {
      const v = c.opts, h = VRES[num(v, "res")]!;
      const codec = flag(v, "h264") ? ["-c:v", "libx264", "-preset", "medium", "-crf", String(CRF[num(v, "q")])] : ["-c:v", "libx265", "-preset", "medium", "-crf", String(CRF[num(v, "q")]! + 4), "-tag:v", "hvc1"];
      return [{
        cmd: "ffmpeg",
        args: [...videoIn(c), "-map", "0:v:0", "-map", "0:a:0?", ...codec, "-pix_fmt", "yuv420p",
          ...(h ? ["-vf", `scale=-2:'min(${h},ih)'`] : []), "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", c.output],
      }];
    },
  },
  {
    id: "vid-whatsapp", kind: "video", title: "For WhatsApp", desc: "Under 100 MB, still looks good.", factor: 0.2, ext: "mp4",
    settings: [INFO("Sized automatically to stay under WhatsApp's 100 MB limit. Long videos get a lower resolution."), TRIM],
    plan: (c) => {
      const dur = Math.max(1, clipDuration(c));
      const kbps = Math.max(250, Math.min(5000, Math.floor((90 * 8192) / dur) - 128));
      const h = kbps > 2500 ? 1080 : kbps > 900 ? 720 : 480;
      return [{
        cmd: "ffmpeg",
        args: [...videoIn(c), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "medium", "-b:v", `${kbps}k`, "-maxrate", `${kbps}k`, "-bufsize", `${kbps * 2}k`,
          "-pix_fmt", "yuv420p", "-vf", `scale=-2:'min(${h},ih)'`, "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", c.output],
      }];
    },
  },
  {
    id: "vid-mp3", kind: "video", title: "Just the sound", desc: "Saves the audio as an MP3.", factor: 0.03, ext: "mp3",
    settings: [SEG("br", "Sound quality", ["Normal", "High"], 0, " sound"), NORM(false), TRIM],
    plan: (c) => [{ cmd: "ffmpeg", args: [...videoIn(c), "-vn", "-c:a", "libmp3lame", "-b:a", ["192k", "320k"][num(c.opts, "br")]!, ...(flag(c.opts, "norm") ? ["-af", "loudnorm"] : []), c.output] }],
  },
  {
    id: "vid-gif", kind: "video", title: "Animated GIF", desc: "Short, silent loop for chats.", factor: 0.1, ext: "gif",
    settings: [TRIM, SEG("w", "Width", ["320 px", "480 px", "640 px"], 1, " wide"), SEG("fps", "Smoothness", ["10 fps", "15 fps", "24 fps"], 1)],
    plan: (c) => {
      const w = [320, 480, 640][num(c.opts, "w")], fps = [10, 15, 24][num(c.opts, "fps")];
      const t = c.opts.trim as { end?: string } | undefined;
      return [{ cmd: "ffmpeg", args: [...videoIn(c), ...(t?.end ? [] : ["-t", "15"]), "-vf", `fps=${fps},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`, "-loop", "0", c.output] }];
    },
  },
  {
    id: "vid-subs", kind: "video", title: "Subtitles", desc: "An .srt file with what's said, timed to the video.", factor: 0.0005, ext: "srt",
    settings: [SPOKEN, TRIM],
    plan: (c) => whisperSteps(c, "srt"),
  },
  {
    id: "vid-transcript", kind: "video", title: "Transcript", desc: "Types out everything that's said.", factor: 0.0003, ext: "txt",
    settings: [SPOKEN, STAMPS, TRIM],
    plan: (c) => whisperSteps(c, "txt"),
  },
];

function toSeconds(s: string): number {
  return s.split(":").reduce((a, p) => a * 60 + Number(p), 0);
}

export function clipDuration(c: { opts: OptionValues; info: FileInfo[] }): number {
  const full = c.info[0]?.duration ?? 60;
  const t = c.opts.trim as { start?: string; end?: string } | undefined;
  const start = t?.start ? toSeconds(t.start) : 0;
  const end = t?.end ? Math.min(full, toSeconds(t.end)) : full;
  return Math.max(0.1, end - start);
}

// ---------- audio ----------
const audioRecipes: Recipe[] = [
  {
    id: "aud-mp3", kind: "audio", title: "MP3", desc: "Plays anywhere, including the car.", factor: 0.9, ext: "mp3",
    settings: [Q, NORM(true), CHK("noise", "Reduce background noise", "Removes hum and hiss", false, "noise reduced", null)],
    plan: (c) => {
      const af = [flag(c.opts, "noise") ? "afftdn" : "", flag(c.opts, "norm") ? "loudnorm" : ""].filter(Boolean).join(",");
      return [{ cmd: "ffmpeg", args: [...videoIn(c), "-vn", "-c:a", "libmp3lame", "-b:a", ["128k", "192k", "320k"][num(c.opts, "q")]!, ...(af ? ["-af", af] : []), c.output] }];
    },
  },
  {
    id: "aud-transcript", kind: "audio", title: "Transcript", desc: "Types out what's said, in Spanish or English.", factor: 0.002, ext: "txt",
    settings: [SPOKEN, STAMPS],
    plan: (c) => whisperSteps(c, "txt"),
  },
  {
    id: "aud-m4a", kind: "audio", title: "M4A", desc: "Best for iPhone and Apple Music.", factor: 0.8, ext: "m4a",
    settings: [Q, NORM(true)],
    plan: (c) => [{ cmd: "ffmpeg", args: [...videoIn(c), "-vn", "-c:a", "aac", "-b:a", ["96k", "160k", "256k"][num(c.opts, "q")]!, ...(flag(c.opts, "norm") ? ["-af", "loudnorm"] : []), c.output] }],
  },
  {
    id: "aud-wav", kind: "audio", title: "WAV", desc: "Uncompressed, for editing.", factor: 8, ext: "wav",
    settings: [],
    plan: (c) => [{ cmd: "ffmpeg", args: [...videoIn(c), "-vn", "-c:a", "pcm_s16le", "-ar", "44100", c.output] }],
  },
];

// ---------- pdf ----------
const pdfRecipes: Recipe[] = [
  {
    id: "pdf-small", kind: "pdf", title: "Smaller PDF", desc: "Same pages, easier to email.", factor: 0.35, ext: "pdf",
    settings: [SEG("q", "Compression", ["Strong", "Balanced", "Light"], 1, " compression")],
    plan: ({ inputs, output, opts: v }) => [{ cmd: "gs", args: ["-q", "-dNOPAUSE", "-dBATCH", "-dSAFER", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5", `-dPDFSETTINGS=/${["screen", "ebook", "printer"][num(v, "q")]}`, `-sOutputFile=${output}`, inputs[0]!] }],
  },
  {
    id: "pdf-docx", kind: "pdf", title: "Word document", desc: "Editable DOCX. Works best on PDFs with real text.", factor: 0.3, ext: "docx",
    settings: [],
    plan: ({ inputs, tmp }) => [{ cmd: "soffice", args: [`-env:UserInstallation=file://${tmp}/lo`, "--headless", "--infilter=writer_pdf_import", "--convert-to", "docx:MS Word 2007 XML", "--outdir", tmp, inputs[0]!] }],
  },
  {
    id: "pdf-jpg", kind: "pdf", title: "Pictures", desc: "One JPG per page, zipped together.", factor: 1.5, ext: "zip",
    settings: [SEG("dpi", "Sharpness", ["Screen", "Print"], 0, " sharpness")],
    plan: ({ inputs, output, tmp, opts: v }) => [
      { cmd: "pdftoppm", args: ["-jpeg", "-r", ["150", "300"][num(v, "dpi")]!, inputs[0]!, `${tmp}/page`] },
      { cmd: "zip", args: ["-j", "-r", "-q", "-0", output, tmp] },
    ],
  },
  {
    id: "pdf-txt", kind: "pdf", title: "Plain text", desc: "Just the words, for copying.", factor: 0.02, ext: "txt",
    settings: [CHK("layout", "Keep the layout", "Keeps columns and spacing instead of one long flow", false, "layout kept", null)],
    plan: ({ inputs, output, opts: v }) => [{ cmd: "pdftotext", args: [...(flag(v, "layout") ? ["-layout"] : []), inputs[0]!, output] }],
  },
  {
    id: "pdf-ocr-txt", kind: "pdf", title: "Text from scan", desc: "Reads the words on scanned pages so you can copy them.", factor: 0.02, ext: "txt",
    settings: [OCR_LANG, STRAIGHT],
    plan: ({ inputs, output, opts: v }) => [{ cmd: "ocrmypdf", args: ["-q", "-l", OCR_CODES[num(v, "lang")]!, "--force-ocr", ...(flag(v, "deskew") ? ["--deskew"] : []), "--sidecar", output, "--output-type", "none", inputs[0]!, "-"] }],
  },
  {
    id: "pdf-ocr-pdf", kind: "pdf", title: "Searchable PDF", desc: "Same pages, but you can search and copy the text.", factor: 1.1, ext: "pdf",
    settings: [OCR_LANG, STRAIGHT],
    plan: ({ inputs, output, opts: v }) => [{ cmd: "ocrmypdf", args: ["-q", "-l", OCR_CODES[num(v, "lang")]!, "--skip-text", ...(flag(v, "deskew") ? ["--rotate-pages", "--deskew"] : []), "--optimize", "1", inputs[0]!, output] }],
  },
];

// ---------- office / text documents ----------
const docRecipes: Recipe[] = [
  {
    id: "doc-pdf", kind: "doc", title: "PDF", desc: "Looks the same everywhere, easy to print and send.", factor: 0.6, ext: "pdf",
    settings: [],
    plan: ({ inputs, tmp }) => [{ cmd: "soffice", args: [`-env:UserInstallation=file://${tmp}/lo`, "--headless", "--convert-to", "pdf", "--outdir", tmp, inputs[0]!] }],
  },
  {
    id: "doc-docx", kind: "doc", title: "Word document", desc: "Opens in Word and Google Docs.", factor: 1, ext: "docx",
    rejects: ["docx", "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp", "key"],
    settings: [],
    plan: ({ inputs, tmp }) => [{ cmd: "soffice", args: [`-env:UserInstallation=file://${tmp}/lo`, "--headless", "--convert-to", "docx:MS Word 2007 XML", "--outdir", tmp, inputs[0]!] }],
  },
  {
    id: "doc-txt", kind: "doc", title: "Plain text", desc: "Just the words, no formatting.", factor: 0.1, ext: "txt",
    rejects: ["txt", "xls", "xlsx", "ods", "csv", "ppt", "pptx", "odp", "key"],
    settings: [],
    plan: ({ inputs, tmp }) => [{ cmd: "soffice", args: [`-env:UserInstallation=file://${tmp}/lo`, "--headless", "--convert-to", "txt:Text (encoded):UTF8", "--outdir", tmp, inputs[0]!] }],
  },
];

// ---------- ebooks ----------
const ebookRecipes: Recipe[] = [
  {
    id: "ebook-epub", kind: "ebook", title: "EPUB", desc: "Apple Books, Kobo, most e-readers.", factor: 1, ext: "epub", rejects: ["epub"], settings: [],
    plan: ({ inputs, output }) => [{ cmd: "ebook-convert", args: [inputs[0]!, output] }],
  },
  {
    id: "ebook-kindle", kind: "ebook", title: "Kindle", desc: "AZW3 for Kindle devices and apps.", factor: 1, ext: "azw3", rejects: ["azw3"], settings: [],
    plan: ({ inputs, output }) => [{ cmd: "ebook-convert", args: [inputs[0]!, output] }],
  },
  {
    id: "ebook-pdf", kind: "ebook", title: "PDF", desc: "Fixed pages for printing.", factor: 1.5, ext: "pdf", settings: [],
    plan: ({ inputs, output }) => [{ cmd: "ebook-convert", args: [inputs[0]!, output] }],
  },
];

export const RECIPES: Recipe[] = [...imageRecipes, ...imageExtra, ...videoRecipes, ...audioRecipes, ...pdfRecipes, ...docRecipes, ...ebookRecipes];

export function recipeById(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}

export function recipesFor(kind: Kind, exts: string[]): Recipe[] {
  return RECIPES.filter((r) => r.kind === kind && exts.every((e) => (!r.accepts || r.accepts.includes(e)) && !(r.rejects ?? []).includes(e)));
}

// Generic "other format" pseudo-recipe, executed by ConvertX's own converter registry.
export const GENERIC_PREFIX = "any:";
export function genericRecipe(kind: Kind, target: string): Recipe {
  return {
    id: GENERIC_PREFIX + target, kind, title: target.toUpperCase(), desc: "Picked from all formats.", factor: 1, ext: target,
    settings: [INFO("Converted with the standard converter for this format — there's nothing to adjust.")],
    plan: () => [],
  };
}

export function summarize(r: Recipe, v: OptionValues, count = 1): string[] {
  const parts: string[] = [r.merge ? `${count} → 1 ${r.title.replace(/^One /, "")}` : r.title];
  for (const s of r.settings) {
    const val = v[s.id];
    if ((s.type === "seg" || s.type === "select") && s.opts) parts.push((s.opts[Number(val)] ?? "").split(" — ")[0]! + (s.suffix ?? ""));
    if (s.type === "check") {
      const p = val ? s.on : s.off;
      if (p) parts.push(p);
    }
    if (s.type === "trim") {
      const t = val as { start?: string; end?: string } | undefined;
      if (t?.start || t?.end) parts.push(`trimmed ${t.start ?? "0:00"}–${t.end ?? "end"}`);
    }
  }
  return parts;
}

export function estimateMb(r: Recipe, v: OptionValues, inMb: number): number {
  const q = v.q;
  const qm = typeof q === "number" ? [0.6, 1, 1.6][q] ?? 1 : 1;
  return inMb * r.factor * qm;
}

// What the "Technical details" panel shows: the real commands with placeholder paths.
export function describe(r: Recipe, v: OptionValues, info: FileInfo[] = [{}], n = 1): string[] {
  if (r.id.startsWith(GENERIC_PREFIX)) return [`converter   ConvertX registry (best match for → ${r.ext})`];
  const inputs = Array.from({ length: r.merge ? Math.max(2, n) : 1 }, (_, i) => (r.merge ? `in${i + 1}` : "in"));
  const steps = r.plan({ inputs, output: `out.${r.ext}`, tmp: "tmp", opts: v, info });
  return steps.map((s) => "$ " + [s.cmd, ...s.args.filter((a) => a !== "-progress" && a !== "pipe:1" && a !== "-nostats" && a !== "-hide_banner")].map((a) => (/[\s'()[\];,]/.test(a) ? `"${a}"` : a)).join(" "));
}

// Which card gets the "Best" badge and starts selected, given what the probe found.
export function recommended(kind: Kind, infos: FileInfo[]): string | null {
  if (kind === "pdf" && infos.some((i) => i.hasText === false)) return "pdf-ocr-txt";
  return null;
}
