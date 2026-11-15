/* Gmail direkt im Browser (Google Identity Services + Gmail API), nur lesend.
   Gleiche öffentliche Client-ID wie gcal.js, aber eigenes Token mit dem Scope gmail.readonly.
   Die Seite kann damit nichts löschen, verschieben oder als gelesen markieren. */
window.GMail = (() => {
  const CLIENT_ID = "1082361606342-rt89uacqghn3uo1tjq0ses2f66iv34sv.apps.googleusercontent.com";
  const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
  const API = "https://gmail.googleapis.com/gmail/v1/users/me";
  const KEY = "gmail.token", FLAG = "gmail.connected";
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
          if (r.scope && !r.scope.includes(SCOPE)){ p?.rej(err("no_scope")); return; }
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
  async function call(path, query){
    if (!valid()) { tok = null; ls.set(KEY, null); notify(); throw err("needs_reauth"); }
    const qs = query ? "?" + (query instanceof URLSearchParams ? query : new URLSearchParams(query)) : "";
    let r;
    try { r = await fetch(API + path + qs, { headers: { Authorization: "Bearer " + tok.access } }); }
    catch { throw err("server_unavailable"); }
    if (r.status === 401){ tok = null; ls.set(KEY, null); notify(); throw err("needs_reauth"); }
    if (!r.ok){
      let m = ""; try { m = (await r.json())?.error?.message || ""; } catch {}
      if (r.status === 403 && /has not been used|is disabled/i.test(m)) throw err("api_disabled", m);
      throw err(r.status >= 500 ? "server_unavailable" : "tool_error", m);
    }
    return r.json();
  }
  const hdr = (msg, name) => (msg?.payload?.headers || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
  // "Max Muster <max@x.de>" -> "Max Muster"
  const who = from => { const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/); return (m && (m[1].trim() || m[2])) || from; };
  const decode = s => { const t = document.createElement("textarea"); t.innerHTML = s || ""; return t.value; };

  const api = {
    connect, disconnect, onChange(f){ listeners.add(f); return () => listeners.delete(f); },
    state(){ return valid() ? "connected" : ls.get(FLAG) ? "expired" : "off"; },
    // Ungelesene Unterhaltungen im Posteingang; onlyPrimary blendet Werbung/Updates/Soziale Netzwerke aus
    async unread({ onlyPrimary = true, max = 15 } = {}){
      const q = "in:inbox is:unread" + (onlyPrimary ? " category:primary" : "");
      const [list, inbox] = await Promise.all([
        call("/threads", { q, maxResults: String(max) }),
        call("/labels/INBOX").catch(() => null),
      ]);
      const ids = (list.threads || []).map(t => t.id);
      const p = new URLSearchParams({ format: "metadata" });
      ["From", "Subject"].forEach(h => p.append("metadataHeaders", h));
      const threads = await Promise.all(ids.map(id => call("/threads/" + id, p).catch(() => null)));
      const items = threads.filter(Boolean).map(t => {
        const msgs = t.messages || [];
        const unread = msgs.filter(m => (m.labelIds || []).includes("UNREAD"));
        const last = unread[unread.length - 1] || msgs[msgs.length - 1];
        return {
          id: t.id,
          from: who(hdr(last, "From")),
          subject: hdr(last, "Subject") || "(kein Betreff)",
          snippet: decode(last?.snippet).replace(/[\s͏‌­]+/g, " ").trim(),
          date: new Date(+last?.internalDate || Date.now()),
          count: unread.length,
          link: "https://mail.google.com/mail/u/0/#inbox/" + t.id,
        };
      }).sort((a, b) => b.date - a.date);
      return {
        items,
        more: list.resultSizeEstimate > items.length || !!list.nextPageToken,
        totalUnread: inbox ? inbox.threadsUnread : null,
      };
    },
  };
  setInterval(() => { if (tok && !valid()){ tok = null; ls.set(KEY, null); notify(); } }, 60_000);
  return api;
})();
