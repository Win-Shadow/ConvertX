import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";

const TMP = path.resolve("./data/tmp");
mkdirSync(TMP, { recursive: true });

// Nothing is mid-download at boot, so any zip dir left behind (crash, killed process, or the old fixed-name dirs) is stale.
for (const name of readdirSync(TMP)) {
  if (name.startsWith("zip-") || name.startsWith("share-")) rmSync(path.join(TMP, name), { recursive: true, force: true });
}

// Each request builds its own zip in a unique dir, and the dir is removed as soon as the response is done or abandoned.
export async function zipResponse(files: string[], downloadName: string): Promise<Response | null> {
  const dir = mkdtempSync(path.join(TMP, "zip-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  const zipPath = path.join(dir, "files.zip");
  try {
    const p = Bun.spawn(["zip", "-j", "-q", "-1", zipPath, ...files], { stdout: "ignore", stderr: "ignore" });
    if ((await p.exited) !== 0) throw new Error("zip failed");
  } catch {
    cleanup();
    return null;
  }
  const size = statSync(zipPath).size;
  const reader = Bun.file(zipPath).stream().getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          cleanup();
        } else {
          controller.enqueue(value);
        }
      } catch (e) {
        cleanup();
        controller.error(e);
      }
    },
    async cancel() {
      await reader.cancel().catch(() => {});
      cleanup();
    },
  });
  return new Response(body, {
    headers: {
      "content-type": "application/zip",
      "content-length": String(size),
      "content-disposition": `attachment; filename="${downloadName}"`,
    },
  });
}
