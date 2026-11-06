/* Google Kalender direkt im Browser (Google Identity Services + Calendar API).
   Nur Lukas ist als Testnutzer eingetragen; die Client-ID ist öffentlich und ungefährlich. */
window.GCal = (() => {
  const CLIENT_ID = "1082361606342-rt89uacqghn3uo1tjq0ses2f66iv34sv.apps.googleusercontent.com";
  const SCOPE = "https://www.googleapis.com/auth/calendar.events";
  const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
  const KEY = "gcal.token", FLAG = "gcal.connected";
  const ls = { get(k){ try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
               set(k,v){ try { v==null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  let tok = ls.get(KEY), client = null, pending = null, gisReady = null;
  const listeners = new Set();
  const notify = () => listeners.forEach(f => { try { f(api.state()); } catch {} });

  function loadGis(){
    if (gisReady) return gisReady;
    gisReady = new Promise((res, rej) => {
      if (window.google?.accounts?.oauth2) return res();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client"; s.async = true;
      s.onload = () => res(); s.onerror = () => rej(new Error("gis"));
      document.head.appendChild(s);
    });
    return gisReady;
  }
  function err(code, message){ const e = new Error(message || code); e.code = code; return e; }
  const valid = () => tok && tok.exp > Date.now() + 60_000;

  async function connect(){             // nur aus einem Klick heraus aufrufen
    await loadGis();
    if (!client){
      client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID, scope: SCOPE,
        callback: r => {
          const p = pending; pending = null;
          if (r.error){ p?.rej(err("needs_reauth", r.error)); return; }
          tok = { access: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 };
          ls.set(KEY, tok); ls.set(FLAG, true); notify(); p?.res();
        },
        error_callback: e => { const p = pending; pending = null; p?.rej(err("needs_reauth", e?.type)); notify(); },
      });
    }
    return new Promise((res, rej) => { pending = { res, rej }; client.requestAccessToken({ prompt: ls.get(FLAG) ? "" : "consent" }); });
  }
  function disconnect(){
    if (tok && window.google?.accounts?.oauth2) try { google.accounts.oauth2.revoke(tok.access); } catch {}
    tok = null; ls.set(KEY, null); ls.set(FLAG, null); notify();
  }
  async function call(method, path, body, query){
    if (!valid()) { tok = null; ls.set(KEY, null); notify(); throw err("needs_reauth"); }
    const url = API + (path || "") + (query ? "?" + new URLSearchParams(query) : "");
    let r;
    try { r = await fetch(url, { method, headers: { Authorization: "Bearer " + tok.access, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
    catch { throw err("server_unavailable"); }
    if (r.status === 401){ tok = null; ls.set(KEY, null); notify(); throw err("needs_reauth"); }
    if (r.status === 404 || r.status === 410) throw err("tool_error", "Termin nicht gefunden");
    if (!r.ok){ let m = ""; try { m = (await r.json())?.error?.message || ""; } catch {} throw err(r.status >= 500 ? "server_unavailable" : "tool_error", m); }
    return r.status === 204 ? {} : r.json();
  }
  // Eingaben im selben Format wie der Google-Kalender-Connector in claude.ai
  function body(i){
    const o = {};
    if (i.summary != null) o.summary = i.summary;
    if (i.location != null) o.location = i.location;
    if (i.description != null) o.description = i.description;
    if (i.startTime){
      const tz = i.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      o.start = i.allDay ? { date: i.startTime.slice(0,10), dateTime: null } : { dateTime: i.startTime, timeZone: tz, date: null };
      o.end   = i.allDay ? { date: i.endTime.slice(0,10), dateTime: null }   : { dateTime: i.endTime, timeZone: tz, date: null };
    }
    return o;
  }
  const api = {
    connect, disconnect, onChange(f){ listeners.add(f); return () => listeners.delete(f); },
    state(){ return valid() ? "connected" : ls.get(FLAG) ? "expired" : "off"; },
    list({ timeMin, timeMax, timeZone }){ return call("GET", "", null, { timeMin, timeMax, timeZone, singleEvents: "true", orderBy: "startTime", maxResults: "250" }); },
    create(i){ return call("POST", "", body(i), { sendUpdates: "none" }); },
    update(id, i){ return call("PATCH", "/" + encodeURIComponent(id), body(i), { sendUpdates: "none" }); },
    remove(id){ return call("DELETE", "/" + encodeURIComponent(id), null, { sendUpdates: "none" }); },
  };
  // Ablauf ankündigen, damit Seiten den Knopf zeigen
  setInterval(() => { if (tok && !valid()){ tok = null; ls.set(KEY, null); notify(); } }, 60_000);
  return api;
})();
