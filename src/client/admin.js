import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";

import { api, url } from "./api";
import { t } from "./i18n";
import { QR } from "./qr";

const html = htm.bind(h);
const GB = 1024 ** 3;

const fmt = (b) => (b == null ? "…" : b >= GB ? (b / GB).toFixed(1) + " GB" : b >= 1024 ** 2 ? Math.round(b / 1024 ** 2) + " MB" : b > 0 ? Math.max(1, Math.round(b / 1024)) + " KB" : "0 KB");
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
const linkBase = (session) => session?.publicUrl || `${location.origin}${url("")}`;

function useAsync(fn, deps) {
  const [state, set] = useState({ data: null, error: null, loading: true });
  const reload = () => fn().then((data) => set({ data, error: null, loading: false })).catch((error) => set({ data: null, error, loading: false }));
  useEffect(() => {
    reload();
  }, deps);
  return [state, reload];
}

// ---------- invite sign-up ----------
export function JoinView({ token, onDone }) {
  const [inv, setInv] = useState(undefined);
  const [f, setF] = useState({ name: "", email: "", password: "" });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.invite(token).then(setInv).catch(() => setInv(null));
  }, [token]);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.join(token, f);
      history.replaceState(null, "", url("/"));
      onDone();
    } catch (x) {
      setErr(x.message);
    } finally {
      setBusy(false);
    }
  };
  if (inv === undefined) return null;
  return html`
    <div class="authbox">
      ${inv === null && html`<div><h1 class="h1s">${t("inviteGone")}</h1><p class="lead">${t("inviteGoneSub")}</p></div>
        <a class="btn" style="text-align: center; text-decoration: none" href=${url("/")}>${t("login")}</a>`}
      ${inv && html`
        <div><h1 class="h1s">${t("joinTitle")}</h1><p class="lead">${inv.role === "guest" ? t("joinGuest", { n: inv.guestDays }) : t("joinSub")}</p></div>
        ${err && html`<div class="err" role="alert">${err}</div>`}
        <form onSubmit=${submit}>
          <label>${t("yourName")}<input type="text" autocomplete="given-name" required value=${f.name} onInput=${(e) => setF({ ...f, name: e.target.value })} /></label>
          <label>${t("email")}<input type="email" autocomplete="email" required value=${f.email} onInput=${(e) => setF({ ...f, email: e.target.value })} /></label>
          <label>${t("password")}<input type="password" autocomplete="new-password" minlength="8" required value=${f.password} onInput=${(e) => setF({ ...f, password: e.target.value })} /><span class="muted small" style="font-weight: 500">${t("pwHint")}</span></label>
          <button type="submit" class="btn primary xl" disabled=${busy}>${t("createAccount")}</button>
        </form>`}
    </div>`;
}

// ---------- my account ----------
export function AccountView({ me, setMe, flash }) {
  const [name, setName] = useState(me?.name || "");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (me?.name != null) setName(me.name);
  }, [me?.name]);
  if (!me) return null;

  const saveName = async () => {
    try {
      setMe(await api.updateMe({ name }));
      flash(t("saved"));
    } catch (e) {
      flash(e.message);
    }
  };
  const changePw = async (e) => {
    e.preventDefault();
    try {
      await api.password(pw.current, pw.next);
      setPw({ current: "", next: "" });
      flash(t("pwChanged"));
    } catch (x) {
      flash(x.message);
    }
  };
  const connect = async () => {
    try {
      const { url: link } = await api.connectTelegram();
      window.open(link, "_blank", "noopener");
      setWaiting(true);
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const m = await api.me();
        if (m.telegram) {
          setMe(m);
          flash(t("tgConnected"));
          break;
        }
      }
    } catch (e) {
      flash(e.message);
    } finally {
      setWaiting(false);
    }
  };
  const pct = me.quota ? Math.min(100, (me.used / me.quota) * 100) : 0;

  return html`
    <div><h1 class="h1s">${t("myAccount")}</h1><p class="lead">${me.email}${me.role === "guest" && me.expires ? ` · ${t("guestUntil", { x: when(me.expires) })}` : ""}</p></div>
    <section class="card pad">
      <h3>${t("yourName")}</h3>
      <div class="btnrow"><input type="text" value=${name} onInput=${(e) => setName(e.target.value)} style="flex: 1 1 220px" aria-label=${t("yourName")} /><button type="button" class="btn" onClick=${saveName}>${t("save")}</button></div>
    </section>
    <section class="card pad">
      <h3>${t("storage")}</h3>
      <div class="kv"><span>${t("yourSpace")}</span><span>${fmt(me.used)}${me.quota ? ` / ${fmt(me.quota)}` : ""}</span></div>
      ${me.quota > 0 && html`<div class="minibar"><div style=${`width:${pct}%;${pct > 90 ? "background: var(--wbtn)" : ""}`}></div></div>`}
      <span class="muted small">${t("storageHint")}</span>
    </section>
    <section class="card pad">
      <h3>${t("notifications")}</h3>
      ${me.telegram ? html`
        <div class="kv"><span>Telegram</span><span class="ok">✓ ${t("connected")}</span></div>
        <label class="check"><input type="checkbox" checked=${me.notifyDone} onChange=${async () => setMe(await api.updateMe({ notifyDone: !me.notifyDone }))} /><span><strong>${t("notifyDone")}</strong><small>${t("notifyDoneHint")}</small></span></label>
        <button type="button" class="link quiet" style="align-self: flex-start" onClick=${async () => {
          await api.disconnectTelegram();
          setMe(await api.me());
        }}>${t("disconnect")}</button>`
      : me.bot ? html`
        <span class="muted small">${t("tgWhy")}</span>
        <button type="button" class="btn primary" style="align-self: flex-start" disabled=${waiting} onClick=${connect}>${waiting ? t("tgWaiting") : t("tgConnect")}</button>`
      : html`<span class="muted small">${t("tgNotSetUp")}</span>`}
    </section>
    <section class="card pad">
      <h3>${t("changePw")}</h3>
      <form onSubmit=${changePw} style="display: flex; flex-direction: column; gap: 10px">
        <label class="field"><span class="lab">${t("currentPw")}</span><input type="password" autocomplete="current-password" required value=${pw.current} onInput=${(e) => setPw({ ...pw, current: e.target.value })} /></label>
        <label class="field"><span class="lab">${t("newPw")}</span><input type="password" autocomplete="new-password" minlength="8" required value=${pw.next} onInput=${(e) => setPw({ ...pw, next: e.target.value })} /></label>
        <button type="submit" class="btn" style="align-self: flex-start">${t("changePw")}</button>
      </form>
    </section>`;
}

// ---------- admin ----------
const QUOTAS = [[null, "Default"], [1024, "1 GB"], [5120, "5 GB"], [10240, "10 GB"], [25600, "25 GB"], [51200, "50 GB"], [0, "Unlimited"]];

export function AdminView({ session, me, flash }) {
  const [tab, setTab] = useState("overview");
  const tabs = [["overview", "Overview"], ["people", "People"], ["invites", "Invites"], ["settings", "Settings"]];
  if (!me) return html`<p class="muted">Loading…</p>`;
  if (me.role !== "admin") return html`<p class="muted">Admins only.</p>`;
  return html`
    <div><h1 class="h1s">Server</h1><p class="lead">Everything about convert.lasgatas.org in one place.</p></div>
    <div class="seggroup" role="tablist" style="align-self: flex-start">
      ${tabs.map(([id, label]) => html`<button type="button" role="tab" aria-selected=${tab === id} class=${tab === id ? "on" : ""} onClick=${() => setTab(id)}>${label}</button>`)}
    </div>
    ${tab === "overview" && html`<${Overview} flash=${flash} />`}
    ${tab === "people" && html`<${People} me=${me} flash=${flash} />`}
    ${tab === "invites" && html`<${Invites} session=${session} flash=${flash} />`}
    ${tab === "settings" && html`<${SettingsTab} flash=${flash} />`}`;
}

function Overview() {
  const [{ data: o }] = useAsync(() => api.admin.overview(), []);
  const [open, setOpen] = useState({});
  if (!o) return html`<p class="muted">Loading…</p>`;
  const diskPct = o.disk ? (o.disk.free / o.disk.total) * 100 : null;
  const tiles = [
    ["Disk free", o.disk ? fmt(o.disk.free) : "—", o.disk ? `${diskPct.toFixed(0)}% of ${fmt(o.disk.total)}` : ""],
    ["Stored by Convert", fmt(o.stored), "originals + results"],
    ["Queue", `${o.queue.running} running`, `${o.queue.waiting} waiting`],
    ["Last 24 h", `${o.jobsToday} jobs`, `${o.failures24h} failed file${o.failures24h === 1 ? "" : "s"}`],
  ];
  return html`
    <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px">
      ${tiles.map(([k, v, sub]) => html`<div class="card pad" style="gap: 4px"><span class="muted small">${k}</span><b style="font-size: 24px">${v}</b><span class="muted small">${sub}</span></div>`)}
    </div>
    <section class="card" aria-label="Recent failures">
      <div class="cardhead"><strong>Recent failures</strong></div>
      ${!o.failed.length && html`<div class="row muted">Nothing has failed. 🎉</div>`}
      ${o.failed.map((f) => html`
        <div class="result" key=${f.id}>
          <div class="line">
            <div class="grow" style="flex: 1 1 260px">
              <span class="ellip" style="font-weight: 600">${f.inputs[0]} → ${f.recipe}</span>
              <span class="muted small">${f.name || f.email} · ${when(f.finished)}</span>
            </div>
            <button type="button" class="link quiet" onClick=${() => setOpen({ ...open, [f.id]: !open[f.id] })}>${open[f.id] ? "Hide" : "Details"}</button>
          </div>
          <span class="small" style="color: var(--wt)">${f.error}</span>
          ${open[f.id] && html`<div class="tech">${f.detail}</div>`}
        </div>`)}
    </section>`;
}

function People({ me, flash }) {
  const [{ data: users }, reload] = useAsync(() => api.admin.users(), []);
  const act = async (fn, ok) => {
    try {
      const r = await fn();
      if (ok) flash(typeof ok === "function" ? ok(r) : ok);
      reload();
    } catch (e) {
      flash(e.message);
    }
  };
  if (!users) return html`<p class="muted">Loading…</p>`;
  return html`
    <section class="card" style="overflow-x: auto">
      ${users.map((u) => html`
        <div class="row" key=${u.id} style="flex-wrap: wrap; align-items: flex-start; gap: 12px 16px; opacity: ${u.disabled ? 0.6 : 1}">
          <div class="grow" style="flex: 1 1 220px">
            <span style="font-weight: 700">${u.name || u.email}${u.id === me.id ? " (you)" : ""}${u.disabled ? " · disabled" : ""}</span>
            <span class="muted small">${u.email} · ${u.jobs} jobs · last seen ${when(u.lastSeen)}${u.role === "guest" && u.expires ? ` · guest until ${when(u.expires)}` : ""}</span>
            <span class="muted small">${fmt(u.used)}${u.quota ? ` of ${fmt(u.quota)}` : " · no limit"}${u.telegram ? " · Telegram ✓" : ""}</span>
          </div>
          <label class="field small"><span class="lab">Role</span>
            <select value=${u.role} disabled=${u.id === me.id} onChange=${(e) => act(() => api.admin.updateUser(u.id, { role: e.target.value, ...(e.target.value === "guest" ? { expiresDays: 7 } : {}) }))}>
              <option value="admin">Admin</option><option value="user">Family</option><option value="guest">Guest</option>
            </select>
          </label>
          <label class="field small"><span class="lab">Storage limit</span>
            <select value=${String(u.quotaMb)} disabled=${u.role === "admin"} onChange=${(e) => act(() => api.admin.updateUser(u.id, { quotaMb: e.target.value === "null" ? null : Number(e.target.value) }))}>
              ${QUOTAS.map(([v, l]) => html`<option value=${String(v)}>${l}</option>`)}
            </select>
          </label>
          ${u.id !== me.id && html`
            <div style="display: flex; gap: 12px; flex-wrap: wrap; align-self: center">
              <button type="button" class="link" onClick=${() => act(() => api.admin.resetPassword(u.id), (r) => `Temporary password for ${u.name || u.email}: ${r.password}`)}>Reset password</button>
              <button type="button" class="link" onClick=${() => act(() => api.admin.updateUser(u.id, { disabled: !u.disabled }))}>${u.disabled ? "Enable" : "Disable"}</button>
              <button type="button" class="link quiet" onClick=${() => confirm(`Delete all of ${u.name || u.email}'s files?`) && act(() => api.admin.deleteFiles(u.id), "Files deleted")}>Delete files</button>
              <button type="button" class="link quiet" style="color: var(--wt)" onClick=${() => confirm(`Delete ${u.name || u.email}'s account and all their files? This can't be undone.`) && act(() => api.admin.deleteUser(u.id), "Account deleted")}>Delete account</button>
            </div>`}
        </div>`)}
    </section>
    <p class="muted small">Temporary passwords show in a message at the bottom — send it to them and they can change it under My account.</p>`;
}

function Invites({ session, flash }) {
  const [{ data: list }, reload] = useAsync(() => api.admin.invites(), []);
  const [f, setF] = useState({ role: "user", note: "", uses: "1", days: "7", guestDays: "3" });
  const [show, setShow] = useState(null);
  const base = linkBase(session);
  const make = async (e) => {
    e.preventDefault();
    try {
      const inv = await api.admin.createInvite({ role: f.role, note: f.note || undefined, uses: f.uses === "0" ? null : Number(f.uses), days: Number(f.days), guestDays: f.role === "guest" ? Number(f.guestDays) : null });
      setShow(inv.token);
      reload();
    } catch (x) {
      flash(x.message);
    }
  };
  const copy = async (token) => {
    try {
      await navigator.clipboard.writeText(`${base}/join/${token}`);
      flash("Invite link copied");
    } catch {
      flash(`${base}/join/${token}`);
    }
  };
  return html`
    <section class="card pad">
      <h3>New invite</h3>
      <form onSubmit=${make} style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; align-items: end">
        <label class="field small"><span class="lab">Who</span>
          <select value=${f.role} onChange=${(e) => setF({ ...f, role: e.target.value })}><option value="user">Family member</option><option value="guest">Guest (temporary)</option></select></label>
        ${f.role === "guest" && html`<label class="field small"><span class="lab">Guest account lasts</span>
          <select value=${f.guestDays} onChange=${(e) => setF({ ...f, guestDays: e.target.value })}><option value="1">1 day</option><option value="3">3 days</option><option value="7">7 days</option><option value="30">30 days</option></select></label>`}
        <label class="field small"><span class="lab">Link can be used</span>
          <select value=${f.uses} onChange=${(e) => setF({ ...f, uses: e.target.value })}><option value="1">Once</option><option value="5">5 times</option><option value="0">Any number of times</option></select></label>
        <label class="field small"><span class="lab">Link expires in</span>
          <select value=${f.days} onChange=${(e) => setF({ ...f, days: e.target.value })}><option value="1">1 day</option><option value="7">7 days</option><option value="30">30 days</option></select></label>
        <label class="field small"><span class="lab">Note (for you)</span><input type="text" placeholder="e.g. Mom" value=${f.note} onInput=${(e) => setF({ ...f, note: e.target.value })} /></label>
        <button type="submit" class="btn primary">Create invite</button>
      </form>
    </section>
    ${(list || []).map((i) => html`
      <section class="card pad" key=${i.token} style=${show === i.token ? "border-color: var(--ac)" : ""}>
        <div class="kv" style="flex-wrap: wrap"><strong style="color: var(--tx)">${i.note || (i.role === "guest" ? "Guest invite" : "Family invite")}</strong>
          <span>${i.role === "guest" ? `guest · ${i.guestDays} d` : "family"} · ${i.usesLeft == null ? "unlimited uses" : `${i.usesLeft} use${i.usesLeft === 1 ? "" : "s"} left`} · until ${when(i.expires)}</span></div>
        <div style="display: flex; gap: 8px">
          <input type="text" readonly class="mono" style="flex: 1; min-width: 0; font-size: 12px" value=${`${base}/join/${i.token}`} onFocus=${(e) => e.target.select()} aria-label="Invite link" />
          <button type="button" class="btn" style="padding: 8px 12px; border-radius: 10px" onClick=${() => copy(i.token)}>Copy</button>
          <button type="button" class="btn ghost" style="padding: 8px 12px; border-radius: 10px" onClick=${() => setShow(show === i.token ? null : i.token)}>QR</button>
        </div>
        ${show === i.token && html`<div style="display: flex; justify-content: center"><${QR} text=${`${base}/join/${i.token}`} label="Invite QR code" /></div>`}
        <button type="button" class="link quiet" style="align-self: flex-start" onClick=${async () => {
          await api.admin.revokeInvite(i.token);
          reload();
        }}>Revoke</button>
      </section>`)}
    ${list && !list.length && html`<p class="muted">No open invites.</p>`}`;
}

function SettingsTab({ flash }) {
  const [{ data: o }, reload] = useAsync(() => api.admin.overview(), []);
  const [s, setS] = useState(null);
  const [token, setToken] = useState("");
  useEffect(() => {
    if (o) setS(o.settings);
  }, [o]);
  if (!s) return html`<p class="muted">Loading…</p>`;
  const save = async (patch) => {
    try {
      const next = await api.admin.saveSettings(patch);
      setS(next);
      flash("Saved");
      return next;
    } catch (e) {
      flash(e.message);
    }
  };
  return html`
    <section class="card pad">
      <h3>Defaults</h3>
      <label class="field small"><span class="lab">Storage limit for new people</span>
        <select value=${String(s.defaultQuotaMb)} onChange=${(e) => save({ defaultQuotaMb: Number(e.target.value) })}>
          ${QUOTAS.filter(([v]) => v !== null).map(([v, l]) => html`<option value=${String(v)}>${l}</option>`)}
        </select></label>
      <label class="field small"><span class="lab">Keep files for (default on the Choose page)</span>
        <select value=${String(s.defaultKeepHours)} onChange=${(e) => save({ defaultKeepHours: Number(e.target.value) })}>
          <option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option><option value="-1">Until deleted</option>
        </select></label>
    </section>
    <section class="card pad">
      <h3>Telegram</h3>
      <span class="muted small">Make a bot with @BotFather, paste its token here, then connect your own account under My account to get alerts.</span>
      ${s.telegramBot && html`<div class="kv"><span>Bot</span><span class="ok">@${s.telegramBot}</span></div>`}
      <div class="btnrow">
        <input type="password" placeholder=${s.telegramToken ? "Token saved — paste a new one to replace" : "123456:ABC…"} value=${token} onInput=${(e) => setToken(e.target.value)} style="flex: 1 1 260px" aria-label="Bot token" autocomplete="off" />
        <button type="button" class="btn" disabled=${!token} onClick=${async () => (await save({ telegramToken: token })) && setToken("")}>Save token</button>
        ${s.telegramToken && html`<button type="button" class="btn ghost" onClick=${async () => {
          try {
            await api.admin.testTelegram();
            flash("Test message sent");
          } catch (e) {
            flash(e.message);
          }
        }}>Send test</button>`}
      </div>
      <label class="check"><input type="checkbox" checked=${s.alertFailures} onChange=${() => save({ alertFailures: !s.alertFailures })} /><span><strong>Tell me when a conversion fails</strong><small>Includes who, which file, and the error</small></span></label>
      <label class="field small"><span class="lab">Warn me when free disk space drops below</span>
        <select value=${String(s.alertDiskPct)} onChange=${(e) => save({ alertDiskPct: Number(e.target.value) })}>
          <option value="0">Never</option><option value="5">5%</option><option value="10">10%</option><option value="20">20%</option>
        </select></label>
      <label class="field small"><span class="lab">Message people when a conversion took longer than</span>
        <select value=${String(s.notifyAfterSec)} onChange=${(e) => save({ notifyAfterSec: Number(e.target.value) })}>
          <option value="0">Always</option><option value="30">30 seconds</option><option value="60">1 minute</option><option value="300">5 minutes</option>
        </select></label>
    </section>`;
}
