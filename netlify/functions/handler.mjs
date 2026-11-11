import bundledRoster from "./roster.mjs";
import {
  CRITERIA, ALLOW_OWN_GROUP, MAX_GROUP, findStudent, leaders, groupMembers, cleanScores, slotsToNumbers,
  normalizeRecords, recordCells, studentCode, normCode, allCodes, buildRoster, diffRoster,
} from "./core.mjs";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const bad = (msg, status = 400) => json({ ok: false, message: msg }, status);

const WRONG = "반·번호·이름이 1학년명렬과 맞지 않습니다. 다시 작성하세요.";

// 서버에 올려 둔 명단이 있으면 그것을, 없으면 배포 파일(roster.mjs)의 명단을 쓴다.
async function loadRoster(config) {
  const saved = config ? await config.get("roster") : null;
  return saved?.students?.length ? saved.students : bundledRoster;
}

// 저장소의 모든 점수 기록 (예전 방식·새 방식 모두)
async function readAll(store) {
  const recs = [];
  for (const k of await store.list()) { const r = await store.get(k); if (r) recs.push({ ...r, _key: k }); }
  return recs;
}
// 평가자 한 명의 기록: 새 기록(반-번호)과 예전 기록(반-번호-조)을 합쳐서 돌려줌
async function evaluatorRecord(store, R, cls, no) {
  const newKey = `${cls}-${no}`;
  const keys = [newKey, ...Array.from({ length: MAX_GROUP }, (_, i) => `${newKey}-${i + 1}`)];
  const recs = [];
  for (const k of keys) { const r = await store.get(k); if (r) recs.push({ ...r, _key: k }); }
  const rec = normalizeRecords(R, recs).get(newKey) || { v: 2, cls, no, scores: {} };
  return { rec, legacyKeys: recs.map((r) => r._key).filter((k) => k !== newKey) };
}

// store: 점수 저장소 { get(key), setJSON(key,val), list() -> keys[] }, config: 설정 저장소 { get, setJSON }
export async function handle(req, { store, config, env = {} }) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const adminOk = (key) => !!env.ADMIN_KEY && key === env.ADMIN_KEY;

  if (path === "/api/export") {
    const key = url.searchParams.get("key") || req.headers.get("x-admin-key");
    if (!adminOk(key)) return bad("관리자 키가 맞지 않습니다.", 403);
    const R = await loadRoster(config);
    const evaluators = [...normalizeRecords(R, await readAll(store)).values()];
    const cells = [], skipped = [];
    for (const e of evaluators) { const r = recordCells(R, e); cells.push(...r.cells); skipped.push(...r.skipped); }
    return json({ ok: true, count: evaluators.length, records: evaluators, cells, skipped });
  }

  // ---- 예전 방식(칸 위치) 점수를 번호 방식으로 바꿔 저장 (관리자, 한 번만 하면 됨. 조를 바꾸기 전에 실행) ----
  if (path === "/api/migrate") {
    const key = url.searchParams.get("key") || req.headers.get("x-admin-key");
    if (!adminOk(key)) return bad("관리자 키가 맞지 않습니다.", 403);
    const R = await loadRoster(config);
    const recs = await readAll(store);
    const legacy = recs.filter((r) => r.v !== 2);
    const evaluators = normalizeRecords(R, recs);
    let converted = 0;
    for (const [id, e] of evaluators) {
      const mine = legacy.filter((r) => `${r.cls}-${r.no}` === id);
      if (!mine.length) continue;
      await store.setJSON(id, e);
      for (const r of mine) await store.delete(r._key);
      converted++;
    }
    return json({ ok: true, evaluators: evaluators.size, converted, legacyRecords: legacy.length });
  }

  if (path === "/api/codes") {
    const key = url.searchParams.get("key") || req.headers.get("x-admin-key");
    if (!adminOk(key)) return bad("관리자 키가 맞지 않습니다.", 403);
    const R = await loadRoster(config);
    const rows = allCodes(R, env.ADMIN_KEY);
    if (url.searchParams.get("format") === "json") return json({ ok: true, codes: rows });
    const csv = "\uFEFF반,번호,이름,입장코드\r\n" + rows.map((r) => `${r.cls},${r.no},${r.name},${r.code}`).join("\r\n") + "\r\n";
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="entry-codes.csv"', "cache-control": "no-store" } });
  }

  // ---- 명단 내려받기 (관리자): 엑셀 [서버명단 가져오기] 단추용 ----
  if (path === "/api/roster/export") {
    const key = url.searchParams.get("key") || req.headers.get("x-admin-key");
    if (!adminOk(key)) return bad("관리자 키가 맞지 않습니다.", 403);
    const R = await loadRoster(config);
    const saved = config ? await config.get("roster") : null;
    return json({ ok: true, count: R.length, source: saved?.students?.length ? "server" : "deploy", updatedAt: saved?.updatedAt ?? null,
      students: R.map(({ cls, no, name, group, leader }) => ({ cls, no, name, group, leader: !!leader })) });
  }

  if (req.method !== "POST") return bad("POST 요청만 가능합니다.", 405);
  let body;
  try { body = await req.json(); } catch { return bad("요청 형식이 올바르지 않습니다."); }

  // ---- 명단 올리기 (관리자): commit 이 true 일 때만 저장, 아니면 미리보기 ----
  if (path === "/api/roster") {
    if (!adminOk(body.key ?? req.headers.get("x-admin-key"))) return bad("관리자 키가 맞지 않습니다.", 403);
    if (!config) return bad("서버에 명단 저장소가 없습니다.", 500);
    const current = await loadRoster(config);
    const built = buildRoster(body.students, current, env.ADMIN_KEY);
    if (built.errors.length) return json({ ok: false, message: "명단에 고칠 곳이 있습니다.", errors: built.errors.slice(0, 15), warnings: built.warnings }, 422);
    const d = diffRoster(current, built.students);
    // 점수는 학생 번호에 붙어 있어 조를 바꿔도 따라간다. 명단에서 빠졌거나 조가 없는 학생의 점수만 반 시트에 들어가지 못한다.
    let orphanScores = 0;
    const byId = new Map(built.students.map((s) => [`${s.cls}-${s.no}`, s]));
    for (const e of normalizeRecords(current, await readAll(store)).values()) {
      for (const tNo of Object.keys(e.scores || {})) { const s = byId.get(`${e.cls}-${tNo}`); if (!s || !s.group) orphanScores++; }
    }
    const summary = { total: built.students.length, added: d.added, removed: d.removed, regrouped: d.regrouped,
      leaderChanged: d.leaderChanged, renamed: d.renamed, newCodes: d.newCodes,
      affectedGroups: d.affected.size, orphanScores, warnings: built.warnings };
    if (body.commit === true) {
      await config.setJSON("roster", { students: built.students, updatedAt: new Date().toISOString() });
      return json({ ok: true, committed: true, ...summary });
    }
    return json({ ok: true, committed: false, ...summary });
  }


  const R = await loadRoster(config);
  const me = findStudent(R, body.cls, body.no, body.name);
  if (!me) return bad(WRONG, 401);                      // 거짓 → 다시 작성

  if (env.PERSONAL_CODES && String(env.PERSONAL_CODES).toLowerCase() !== "false") {
    const expected = studentCode(me, env.ADMIN_KEY);
    if (!expected) return bad("서버 설정(입장 코드)이 없습니다.", 500);
    if (normCode(body.code) !== expected) return bad("내 입장 코드가 맞지 않습니다. 선생님께 받은 코드를 입력하세요.", 403);
  } else if (env.ACCESS_CODE && String(body.code ?? "") !== env.ACCESS_CODE) {
    return bad("입장 코드가 맞지 않습니다.", 403);
  }

  if (path === "/api/login") {
    const mine = leaders(R, me.cls).filter((l) => ALLOW_OWN_GROUP || l.group !== me.group);
    return json({ ok: true, student: { cls: me.cls, no: me.no, name: me.name }, leaders: mine });
  }

  const group = Number(body.group);
  if (!Number.isInteger(group) || !leaders(R, me.cls).some((l) => l.group === group)) return bad("조장을 다시 선택하세요.");
  if (!ALLOW_OWN_GROUP && me.group === group) return bad("자기 조는 평가할 수 없습니다. 다른 조장을 선택하세요.");
  if (path === "/api/form") {
    const { rec } = await evaluatorRecord(store, R, me.cls, me.no);      // 본인이 저장한 것만 돌려줌
    const members = groupMembers(R, me.cls, group);
    const scores = {};
    let any = false;
    for (const m of members) { const v = rec.scores[m.no]; scores[m.slot] = v || {}; if (v) any = true; }
    return json({
      ok: true, criteria: CRITERIA.map(({ key: k, row, allowed, range }) => ({ key: k, row, allowed, range })),
      members: members.map(({ slot, name, leader }) => ({ slot, name, leader })),
      scores, savedAt: any ? rec.savedAt || null : null,
    });
  }

  if (path === "/api/submit") {
    const r = cleanScores(R, me.cls, group, body.scores);
    if (r.error) return bad(r.error);
    const { rec, legacyKeys } = await evaluatorRecord(store, R, me.cls, me.no);
    for (const [no, vals] of Object.entries(slotsToNumbers(R, me.cls, group, r.scores))) {
      if (Object.keys(vals).length) rec.scores[no] = vals; else delete rec.scores[no];
    }
    const saved = { v: 2, cls: me.cls, no: me.no, name: me.name, scores: rec.scores, savedAt: new Date().toISOString() };
    await store.setJSON(`${me.cls}-${me.no}`, saved);
    for (const k of legacyKeys) await store.delete(k);                  // 예전 방식 기록은 새 기록에 합쳐졌으므로 지움
    return json({ ok: true, savedAt: saved.savedAt });
  }

  return bad("알 수 없는 요청입니다.", 404);
}
