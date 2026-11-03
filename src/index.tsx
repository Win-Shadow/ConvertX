import { rmSync } from "node:fs";

import { html } from "@elysiajs/html";
import { staticPlugin } from "@elysiajs/static";
import { Elysia } from "elysia";

import db from "./db/db";
import { Jobs } from "./db/types";
import { AUTO_DELETE_EVERY_N_HOURS, WEBROOT } from "./helpers/env";
import "./helpers/printVersions";
import { scheduleDelayed, ScheduledTask } from "./helpers/scheduleDelayed";
import { chooseConverter } from "./pages/chooseConverter";
import { convert } from "./pages/convert";
import { deleteFile } from "./pages/deleteFile";
import { deleteJob } from "./pages/deleteJob";
import { download } from "./pages/download";
import { healthcheck } from "./pages/healthcheck";
import { history } from "./pages/history";
import { listConverters } from "./pages/listConverters";
import { results } from "./pages/results";
import { root } from "./pages/root";
import { upload } from "./pages/upload";
import { user } from "./pages/user";
import { apiV2 } from "./v2/api";
import { startNotifier } from "./v2/notify";
import { people, startSweeper } from "./v2/people";
import { publicShares } from "./v2/share";
import { shell } from "./v2/shell";
import { deleteV2Rows } from "./v2/store";

export const uploadsDir = "./data/uploads/";
export const outputDir = "./data/output/";

// Fix for Elysia issue with Bun, (see https://github.com/oven-sh/bun/issues/12161)
process.getBuiltinModule = require;

const app = new Elysia({
  serve: {
    maxRequestBodySize: Number.MAX_SAFE_INTEGER,
  },
  prefix: WEBROOT,
})
  .use(html())
  .use(
    staticPlugin({
      assets: "public",
      prefix: "",
    }),
  )
  .use(user)
  .use(shell)
  .use(publicShares)
  .use(people)
  .use(apiV2)
  .use(root)
  .use(upload)
  .use(history)
  .use(convert)
  .use(download)
  .use(deleteJob)
  .use(results)
  .use(deleteFile)
  .use(listConverters)
  .use(chooseConverter)
  .use(healthcheck)
  .onError(({ error, code, request }) => {
    if (code === "NOT_FOUND") {
      console.warn(`404: ${request.method} ${new URL(request.url).pathname}`);
      return;
    }
    console.error(error);
  });

if (process.env.NODE_ENV !== "production") {
  await import("./helpers/tailwind").then(async ({ generateTailwind }) => {
    const result = await generateTailwind();

    app.get("/generated.css", ({ set }) => {
      set.headers["content-type"] = "text/css";
      return result;
    });
  });
}

app.listen(process.env.PORT || 3000);
startNotifier();
startSweeper();

console.log(`🦊 Elysia is running at http://${app.server?.hostname}:${app.server?.port}${WEBROOT}`);

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000;
const autoDeleteIntervalMs = AUTO_DELETE_EVERY_N_HOURS * MILLISECONDS_PER_HOUR;
let clearJobsTimer: ScheduledTask;

const clearJobs = () => {
  // v2 jobs carry their own keep_until ("forever" = never); legacy jobs use the global window.
  const now = new Date().toISOString();
  // AUTO_DELETE_EVERY_N_HOURS=0 only turns off the legacy window; per-job keep_until is always honoured.
  const jobs = db
    .query(
      `SELECT * FROM jobs WHERE (?3 AND keep_until IS NULL AND date_created < ?1)
         OR (keep_until IS NOT NULL AND keep_until != 'forever' AND keep_until < ?2)`,
    )
    .as(Jobs)
    .all(new Date(Date.now() - autoDeleteIntervalMs).toISOString(), now, AUTO_DELETE_EVERY_N_HOURS > 0 ? 1 : 0);

  for (const job of jobs) {
    // delete the directories
    rmSync(`${outputDir}${job.user_id}/${job.id}`, {
      recursive: true,
      force: true,
    });
    rmSync(`${uploadsDir}${job.user_id}/${job.id}`, {
      recursive: true,
      force: true,
    });

    // delete the job
    deleteV2Rows(job.id);
    db.query("DELETE FROM file_names WHERE job_id = ?").run(job.id);
    db.query("DELETE FROM jobs WHERE id = ?").run(job.id);
  }

  clearJobsTimer = scheduleDelayed(
    autoDeleteIntervalMs > 0 ? Math.min(autoDeleteIntervalMs, MILLISECONDS_PER_HOUR) : MILLISECONDS_PER_HOUR,
    clearJobs,
  );
};

clearJobs();

let isShuttingDown = false;
const handleShutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  if (clearJobsTimer) {
    clearJobsTimer.cancel();
  }
  try {
    await app.stop(true);
    db.close();
    process.exit(0);
  } catch (error) {
    console.error("Error during graceful shutdown:", error);
    process.exit(1);
  }
};

process.on("SIGINT", handleShutdown);
process.on("SIGTERM", handleShutdown);
