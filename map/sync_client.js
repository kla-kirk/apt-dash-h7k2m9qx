/* ============================================================================
 * BRSync — airtight two-user sync client (event-sourced op-log).
 * Shared IDENTICALLY by the dashboard (inlined) and the map (map/sync_client.js),
 * mirroring the BRFilters pattern. See SYNC_DESIGN.md for the full contract.
 *
 * Core idea: every user edit is one immutable op {opId,editTs,user,listingId,field,value}
 * appended to a log. Current state = fold(log): per (listingId,field) the op with the
 * greatest (editTs, then user, then opId) wins. Nothing is ever overwritten, so no
 * decision is ever silently lost and every loser stays recoverable (history/undo).
 *
 * This file is environment-agnostic: createBRSync(env) takes injectable storage / net /
 * now() so it is fully unit-testable under node. The browser singleton (window.BRSync)
 * is wired to real localStorage, a fetch-based net, and Date.now at the bottom.
 * ==========================================================================*/
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;       // node / tests
  if (typeof window !== "undefined") {                                             // browser
    root.BRSyncCore = api;
    // The default singleton is created lazily by the page via BRSync = api.createBRSync({...}).
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- pure fold: log (array of ops) -> { listingId: { field: winningOp } } -------------
  // Total order on ops so the winner is deterministic everywhere (client, server, tests).
  function opCmp(a, b) {
    if (a.editTs !== b.editTs) return a.editTs - b.editTs;          // newer edit wins
    if (a.user !== b.user) return a.user < b.user ? -1 : 1;         // deterministic tiebreak
    return a.opId < b.opId ? -1 : (a.opId > b.opId ? 1 : 0);        // total order
  }
  function foldLog(log) {
    const winners = Object.create(null);                            // listingId -> field -> op
    for (const op of log) {
      if (!op || op.listingId == null || op.field == null) continue;
      const L = winners[op.listingId] || (winners[op.listingId] = Object.create(null));
      const cur = L[op.field];
      if (!cur || opCmp(op, cur) > 0) L[op.field] = op;             // strictly-greater wins
    }
    return winners;
  }
  // Flatten a folded winners-map into { listingId: { field: value } }.
  function foldValues(log) {
    const w = foldLog(log), out = Object.create(null);
    for (const id in w) { const o = out[id] = Object.create(null); for (const f in w[id]) o[f] = w[id][f].value; }
    return out;
  }

  // ---- the client -----------------------------------------------------------------------
  function createBRSync(env) {
    env = env || {};
    const now = env.now || (() => Date.now());
    const store = env.storage;                 // {get(key)->string|null, set(key,string)}
    const net = env.net;                        // {append(ops)->Promise<resp>, pull(since)->Promise<resp>}
    const log = env.log || ((..._a) => {});     // optional debug logger

    const K = {
      LOG: "brsync.log.v1", OUTBOX: "brsync.outbox.v1",
      CLOCK: "brsync.clock.v1", USER: "brsync.user.v1",
      CURSOR: "brsync.cursor.v1", BUILD: "brsync.build.v1"
    };
    const j = (k, d) => { try { const r = store.get(k); return r == null ? d : JSON.parse(r); } catch (_) { return d; } };
    const put = (k, v) => { try { store.set(k, JSON.stringify(v)); } catch (_) {} };

    const S = {
      ops: j(K.LOG, []),                         // every op we know (confirmed + pending), deduped by opId
      seen: new Set(),                           // opId set for O(1) dedupe
      outbox: j(K.OUTBOX, []),                   // opIds awaiting server confirmation
      clock: j(K.CLOCK, null),                   // {serverTime, localTime} from last sync
      cursor: j(K.CURSOR, 0),                    // server log rows already consumed
      user: env.user || j(K.USER, null),
      proxyUrl: env.proxyUrl || null,
      buildId: env.buildId || null,
      remoteBuild: null,                         // newest BUILD_ID the server has seen
      listeners: [],
      flushing: false, pendingFlush: false, pollTimer: null, backoff: 0
    };
    S.ops.forEach(o => o && o.opId && S.seen.add(o.opId));
    if (S.user) put(K.USER, S.user);

    function persist() { put(K.LOG, S.ops); put(K.OUTBOX, S.outbox); put(K.CLOCK, S.clock); put(K.CURSOR, S.cursor); }
    function emit() { S.listeners.forEach(fn => { try { fn(); } catch (e) { log("listener err", e); } }); }

    // server-anchored elapsed time: immune to absolute laptop-clock skew (SYNC_DESIGN.md §4)
    function nowServer() {
      if (!S.clock) return now();                                  // no anchor yet -> best effort
      return S.clock.serverTime + (now() - S.clock.localTime);
    }
    function setAnchor(serverTime) {
      if (typeof serverTime === "number" && isFinite(serverTime)) {
        S.clock = { serverTime, localTime: now() }; put(K.CLOCK, S.clock);
      }
    }

    // merge incoming ops (dedupe by opId). returns # newly added.
    function mergeOps(incoming) {
      let added = 0;
      for (const op of (incoming || [])) {
        if (!op || !op.opId || S.seen.has(op.opId)) continue;
        S.seen.add(op.opId); S.ops.push(op); added++;
      }
      return added;
    }

    // ---- public API ----
    const self = {
      _state: S,
      foldLog, foldValues, opCmp,

      user() { return S.user; },
      setUser(u) { S.user = u; put(K.USER, u); },
      setProxyUrl(u) { S.proxyUrl = u; },
      ready() { return !!S.clock; },             // a clock anchor exists (safe to emit edits)

      // overlay folded state for ONE listing as {field:value}
      stateFor(listingId) {
        const w = foldLog(S.ops)[listingId] || {}; const o = {};
        for (const f in w) o[f] = w[f].value; return o;
      },
      // mutate in-memory listing object(s) in place with the folded overlay
      apply(listingOrArray) {
        const vals = foldValues(S.ops);
        const one = l => { const v = vals[l && l.id]; if (v) for (const f in v) l[f] = v[f]; return l; };
        return Array.isArray(listingOrArray) ? listingOrArray.map(one) : one(listingOrArray);
      },
      // newest-first ops for a cell (undo / recovery UI). loser values live here.
      history(listingId, field) {
        return S.ops.filter(o => o.listingId === listingId && o.field === field).sort((a, b) => opCmp(b, a));
      },

      onChange(fn) { S.listeners.push(fn); return () => { const i = S.listeners.indexOf(fn); if (i >= 0) S.listeners.splice(i, 1); }; },

      // create an op for a real user edit, optimistic-apply, enqueue + flush.
      edit(listingId, field, value) {
        if (!S.user) throw new Error("BRSync.edit before setUser()");
        const editTs = nowServer();
        const opId = S.user + "-" + editTs + "-" + Math.floor((env.rand ? env.rand() : Math.random()) * 1e9).toString(36);
        const op = { opId, editTs, user: S.user, listingId, field, value };
        S.seen.add(opId); S.ops.push(op); S.outbox.push(opId);
        persist(); emit();
        this.flush();
        return op;
      },

      // push outbox ops, read back the authoritative tail. confirmation never depends solely on
      // the POST response: if it can't be read, we pull() and confirm by presence in the log.
      // Re-entrancy-safe AND awaitable: a flush called while one is in flight awaits that chain
      // (incl. its follow-up), so callers that `await flush()` always wait for real completion.
      flush() {
        if (!S.proxyUrl || !net) return Promise.resolve();
        if (S.flushing) { S.pendingFlush = true; return S.flushPromise; }
        S.flushing = true;
        S.flushPromise = this._doFlush();
        return S.flushPromise;
      },
      async _doFlush() {
        try {
          if (!S.outbox.length) { await this.pull(); return; }
          const byId = new Map(S.ops.map(o => [o.opId, o]));
          const ops = S.outbox.map(id => byId.get(id)).filter(Boolean);
          try {
            const resp = await net.append(ops, { since: S.cursor, buildId: S.buildId, user: S.user });
            if (resp && resp.ok) {
              const acc = new Set(resp.accepted || ops.map(o => o.opId));   // assume all if server omitted
              S.outbox = S.outbox.filter(id => !acc.has(id));
              setAnchor(resp.serverTime);
              if (Array.isArray(resp.ops)) { mergeOps(resp.ops); S.cursor = resp.cursor != null ? resp.cursor : S.cursor; }
              if (resp.remoteBuild) S.remoteBuild = resp.remoteBuild;
              S.backoff = 0; persist(); emit();
            } else { S.backoff = Math.min((S.backoff || 1) * 2, 60); }
          } catch (e) {
            // unconfirmed: keep outbox, fall back to a pull to confirm-by-presence
            log("flush err", e); S.backoff = Math.min((S.backoff || 1) * 2, 60);
            try { await this.pull(); } catch (_) {}
          }
        } finally {
          S.flushing = false;
          if (S.pendingFlush) { S.pendingFlush = false; await this.flush(); }   // chain the follow-up
        }
      },

      // incremental pull of ops the server has that we don't.
      async pull() {
        if (!S.proxyUrl || !net) return;
        try {
          const resp = await net.pull(S.cursor, { buildId: S.buildId, user: S.user });
          if (!resp || !resp.ok) return;
          const added = mergeOps(resp.ops);
          if (resp.cursor != null) S.cursor = resp.cursor;
          setAnchor(resp.serverTime);
          if (resp.remoteBuild) S.remoteBuild = resp.remoteBuild;
          // confirm-by-presence: any outbox op now in the log is confirmed
          if (S.outbox.length) S.outbox = S.outbox.filter(id => !S.seen.has(id) || pendingNotOnServer(id, resp));
          persist();
          if (added) emit();
          return added;
        } catch (e) { log("pull err", e); }
      },

      // start the background loop. resolves after the first pull sets a clock anchor.
      async init(opts) {
        opts = opts || {};
        if (opts.user) this.setUser(opts.user);
        if (opts.proxyUrl) S.proxyUrl = opts.proxyUrl;
        if (opts.buildId) S.buildId = opts.buildId;
        await this.flush();                       // sets the clock anchor + drains any outbox
        if (!S.clock) await this.pull();
        this.startPolling(opts.pollMs || 8000);
        return this;
      },
      startPolling(ms) {
        this.stopPolling();
        S.pollTimer = (env.setInterval || setInterval)(() => { this.flush(); }, ms);
      },
      stopPolling() { if (S.pollTimer) { (env.clearInterval || clearInterval)(S.pollTimer); S.pollTimer = null; } },

      // a newer build is live somewhere -> the page is stale (no-cache footgun guard).
      // Only trust real date-stamped build ids (YYYY-MM-DD-…); ignore test/manual tags so a stray
      // tag like "test-build" can never pin the banner open.
      staleBuild() { const re = /^\d{4}-\d\d-\d\d-/; return !!(S.buildId && S.remoteBuild && re.test(S.buildId) && re.test(S.remoteBuild) && S.remoteBuild > S.buildId); },
      remoteBuild() { return S.remoteBuild; },

      // testing / migration helpers
      _ops() { return S.ops.slice(); },
      _outbox() { return S.outbox.slice(); },
      ingestMigrationOps(ops) { const n = mergeOps(ops); ops.forEach(o => { if (o && o.opId && !S.outbox.includes(o.opId)) S.outbox.push(o.opId); }); persist(); if (n) emit(); return n; },

      // ONE-TIME, surface-independent migration. Reads BOTH legacy stores straight from storage
      // (br_listings_v2 + nr_status_v1), so it fully captures this browser's decisions no matter
      // whether the dashboard OR the map runs first. Guarded by a single shared flag; never deletes
      // the legacy keys (they remain as a fallback). Returns the number of ops emitted.
      migrateOnce(opts) {
        opts = opts || {};
        const flag = opts.flagKey || "brsync.migrated.v2";   // v2 forces a one-time clean re-migration
        try { if (store.get(flag) === "1") return 0; } catch (_) { return 0; }
        let listings = [], shared = {};
        try { listings = JSON.parse(store.get(opts.listingsKey || "br_listings_v2")) || []; } catch (_) {}
        try { shared = JSON.parse(store.get(opts.sharedKey || "nr_status_v1")) || {}; } catch (_) {}
        // unique runId so this run's opIds can't collide with a prior migration's (which the server
        // would drop as duplicates). editTs 2000 beats earlier migration/recovery ops, loses to real clicks.
        const runId = String(now()) + "-" + Math.floor((env.rand ? env.rand() : Math.random()) * 1e6);
        const built = buildMigrationOps({ listings, sharedStatus: shared, user: S.user, ts: 2000, runId });
        if (built.ops.length) this.ingestMigrationOps(built.ops);
        try { store.set(flag, "1"); } catch (_) {}
        return built.ops.length;
      }
    };

    // outbox ops are confirmed by presence in the log after a pull; this just keeps any op the
    // server explicitly did NOT echo as still-pending (defensive; normally everything echoes).
    function pendingNotOnServer(id, resp) { return false; }

    return self;
  }

  // ---- browser net: fetch-based, NO no-cors (so responses are readable / writes confirmed) ----
  function fetchNet(proxyUrl) {
    const readJson = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch (_) { return { ok: false, error: "non-JSON", body: t.slice(0, 200) }; } };
    return {
      async append(ops, meta) {
        const body = JSON.stringify({ action: "append", ops, since: (meta && meta.since) || 0, buildId: meta && meta.buildId, user: meta && meta.user });
        const r = await fetch(proxyUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body });
        return readJson(r);
      },
      async pull(since, meta) {
        const u = proxyUrl + (proxyUrl.indexOf("?") < 0 ? "?" : "&") + "since=" + (since || 0) +
          (meta && meta.buildId ? "&build=" + encodeURIComponent(meta.buildId) : "") +
          (meta && meta.user ? "&user=" + encodeURIComponent(meta.user) : "");
        const r = await fetch(u, { method: "GET" });
        return readJson(r);
      },
      async publishHeaders(headers, version) {
        const body = JSON.stringify({ action: "mirror_headers", headers, version });
        const r = await fetch(proxyUrl, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body });
        return readJson(r);
      }
    };
  }

  // localStorage-backed storage adapter for the browser
  function lsStorage() {
    return { get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
             set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };
  }

  // ---- migration: turn each browser's existing state into ops (no loss) -------------------------
  // Reads br_listings_v2 decisions + the legacy nr_status_v1 map. Emits one op per non-default
  // decision field, stamped with a FIXED pre-cutover editTs so any real future edit always wins.
  // Deterministic opIds (no clock) so re-running is idempotent. Returns {ops, counts}.
  function buildMigrationOps(opts) {
    opts = opts || {};
    const listings = opts.listings || [];
    const shared = opts.sharedStatus || {};                 // nr_status_v1: {id:"accepted"|"needs"|"rejected"}
    const user = opts.user || "keegan";
    const ts = opts.ts || 1;                                 // very old -> loses to every real edit
    const fields = opts.fields || ["reviewState", "jamie", "keegan", "likes", "dislikes", "shortlisted", "status", "furnished", "petFees", "minLease", "contactName", "contactCompany", "agentEmail", "agentPhone", "contactUrl", "preferredChannel", "contactVerified", "contactNotes", "tour"];
    const m2d = { accepted: "accepted", needs: "review", rejected: "rejected" };
    // The two surfaces disagree on the default for untouched review imports: the MAP shows nr… as
    // "to review", while the dashboard historically defaulted them to "accepted". So the default is
    // id-aware: nr… -> "review", vetted r…/s… -> "accepted". An op is emitted only when the saved
    // value DIFFERS from this default — preserving every explicit decision while never inventing one.
    const reviewDefault = id => (String(id).indexOf("nr") === 0) ? "review" : "accepted";
    const rid = opts.runId ? String(opts.runId) + "-" : "";   // unique-per-run so re-migrations never collide
    const ops = []; let seq = 0;
    const mk = (id, field, value) => ops.push({ opId: "mig-" + user + "-" + rid + (seq++), editTs: ts, user, listingId: id, field, value });

    // 1) nr_status_v1 is the AUTHORITATIVE record of map review decisions (and dashboard accept/reject,
    //    which the old code mirrored here). Capture any entry that differs from the id's default —
    //    this is what preserves your saved accepted / rejected pins, incl. explicit nr… accepts.
    const fromMap = new Set();
    Object.keys(shared).forEach(id => { const rs = m2d[shared[id]]; if (!rs) return; fromMap.add(id);
      if (rs !== reviewDefault(id)) mk(id, "reviewState", rs); });

    // 2) br_listings_v2: ranks / notes / contact always (no default ambiguity); reviewState ONLY for
    //    reliable vetted r…/s… ids not already covered by the map record. nr… review states from the
    //    dashboard are intentionally NOT trusted here (their "accepted" default is unreliable and would
    //    wrongly flip untouched "to review" imports) — explicit nr… decisions already live in (1).
    listings.forEach(l => {
      if (!l || l.id == null) return; const id = l.id;
      if (!fromMap.has(id) && String(id).indexOf("nr") !== 0) {
        const rs = l.reviewState; if (rs && rs !== reviewDefault(id)) mk(id, "reviewState", rs);
      }
      if (l.jamie != null && l.jamie !== "") mk(id, "jamie", l.jamie);
      if (l.keegan != null && l.keegan !== "") mk(id, "keegan", l.keegan);
      fields.forEach(f => { if (f === "reviewState" || f === "jamie" || f === "keegan") return;
        const v = l[f]; if (v != null && v !== "" && !(f === "status" && v === "active")) mk(id, f, v); });
    });
    return { ops };
  }

  return { createBRSync, foldLog, foldValues, opCmp, fetchNet, lsStorage, buildMigrationOps };
});
