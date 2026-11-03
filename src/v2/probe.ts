import type { FileInfo, Kind } from "./recipes";

async function run(cmd: string[], timeoutMs = 20000): Promise<string> {
  try {
    const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
    const timer = setTimeout(() => p.kill(), timeoutMs);
    const out = await new Response(p.stdout).text();
    await p.exited;
    clearTimeout(timer);
    return out;
  } catch {
    return "";
  }
}

export async function probe(path: string, kind: Kind): Promise<FileInfo> {
  const info: FileInfo = {};
  if (kind === "image") {
    const out = await run(["exiftool", "-j", "-n", "-ImageWidth", "-ImageHeight", "-GPSLatitude", "-Make", "-Model", path]);
    try {
      const j = JSON.parse(out)[0] ?? {};
      if (j.ImageWidth) info.width = j.ImageWidth;
      if (j.ImageHeight) info.height = j.ImageHeight;
      info.hasGps = j.GPSLatitude !== undefined;
      if (j.Model) info.camera = j.Make && !String(j.Model).startsWith(j.Make) ? `${j.Make} ${j.Model}` : String(j.Model);
    } catch {
      const w = await run(["vipsheader", "-f", "width", path]);
      const h = await run(["vipsheader", "-f", "height", path]);
      if (w) info.width = Number(w);
      if (h) info.height = Number(h);
    }
  } else if (kind === "video" || kind === "audio") {
    const out = await run(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", path]);
    try {
      const j = JSON.parse(out);
      type S = { codec_type: string; codec_name?: string; width?: number; height?: number; disposition?: { attached_pic?: number } };
      const streams: S[] = j.streams ?? [];
      const v = streams.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1);
      const a = streams.find((s) => s.codec_type === "audio");
      const d = Number(j.format?.duration);
      if (d > 0) info.duration = d;
      if (v) {
        if (v.width) info.width = v.width;
        if (v.height) info.height = v.height;
        if (v.codec_name) info.vcodec = v.codec_name;
      }
      if (a?.codec_name) info.acodec = a.codec_name;
    } catch {
      /* unreadable: leave empty */
    }
  } else if (kind === "pdf") {
    const meta = await run(["pdfinfo", path]);
    const m = /^Pages:\s+(\d+)/m.exec(meta);
    if (m) info.pages = Number(m[1]);
    const text = await run(["pdftotext", "-f", "1", "-l", "3", path, "-"]);
    info.hasText = text.replace(/\s+/g, "").length > 20;
  }
  return info;
}
