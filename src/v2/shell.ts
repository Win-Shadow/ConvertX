import { Elysia } from "elysia";

import { version } from "../../package.json";
import { BRANDING, WEBROOT } from "../helpers/env";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// Applied before first paint so a light-theme user never sees a dark flash.
const bootTheme = `try{var t=JSON.parse(localStorage.getItem("cx-theme")||"{}");var m=t.mode||"auto";if(m==="auto")m=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.mode=m;}catch(e){}`;

const page = () => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="webroot" content="${esc(WEBROOT)}">
<meta name="branding" content="${esc(BRANDING)}">
<title>${esc(BRANDING === "ConvertX" ? "Convert" : BRANDING)}</title>
<link rel="icon" type="image/svg+xml" href="${esc(WEBROOT)}/favicon.svg">
<link rel="apple-touch-icon" href="${esc(WEBROOT)}/apple-touch-icon.png">
<link rel="manifest" href="${esc(WEBROOT)}/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="${esc(WEBROOT)}/app/app.css?v=${version}">
<script>${bootTheme}</script>
</head>
<body>
<div id="app"></div>
<script type="module" src="${esc(WEBROOT)}/app/main.js?v=${version}"></script>
</body>
</html>`;

const serve = ({ set }: { set: { headers: Record<string, string | number> } }) => {
  set.headers["content-type"] = "text/html; charset=utf-8";
  set.headers["cache-control"] = "no-cache";
  return page();
};

// Client-side views that can be opened by URL (invite links, bookmarks).
export const shell = new Elysia().get("/", serve).get("/join/:token", serve).get("/admin", serve).get("/account", serve);
