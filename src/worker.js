// mixxtape API. 화면은 public/ 정적 파일, 데이터는 D1.
// 블라인드 규칙은 여기서 지킨다: 개봉 전에는 곡·닉네임을 응답에 싣지 않는다(내 곡만 예외).

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const fail = (status, error) => json({ error }, status);

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const randomId = (n) =>
  [...crypto.getRandomValues(new Uint8Array(n))].map((b) => ALPHABET[b % ALPHABET.length]).join('');

const sha256 = async (text) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

const clean = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

// 앨범 그림은 iTunes 것만 받는다(아무 URL이나 저장하지 않게)
const cleanArt = (v) => {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && u.hostname.endsWith('.mzstatic.com') ? u.href.slice(0, 400) : null;
  } catch {
    return null;
  }
};

const MIN_SLOTS = 2;
const MAX_SLOTS = 30;
const MAX_DEADLINE_MS = 30 * 24 * 60 * 60 * 1000;

async function createTape(req, env) {
  const body = await req.json().catch(() => ({}));
  const title = clean(body.title, 40);
  const slots = Math.floor(Number(body.slots));
  if (!title) return fail(400, '테이프 이름을 적어주세요');
  if (!(slots >= MIN_SLOTS && slots <= MAX_SLOTS)) return fail(400, `자리는 ${MIN_SLOTS}~${MAX_SLOTS}개까지예요`);

  const now = Date.now();
  let deadline = null;
  if (body.deadline != null) {
    deadline = Math.floor(Number(body.deadline));
    if (!(deadline > now && deadline <= now + MAX_DEADLINE_MS)) return fail(400, '마감 시간을 다시 골라주세요');
  }

  const id = randomId(8);
  const key = randomId(20);
  await env.DB.prepare(
    'INSERT INTO tapes (id, title, slots, key_hash, deadline, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(id, title, slots, await sha256(key), deadline, now)
    .run();
  return json({ id, key }, 201);
}

// 꽉 찼거나 마감이 지났으면 그 자리에서 개봉 처리한다(크론 없이 읽을 때 판정)
async function loadTape(env, id) {
  const tape = await env.DB.prepare('SELECT * FROM tapes WHERE id = ?').bind(id).first();
  if (!tape) return null;
  const { results: tracks } = await env.DB.prepare(
    'SELECT token_hash, nick, title, artist, art FROM tracks WHERE tape_id = ? ORDER BY id',
  )
    .bind(id)
    .all();

  const now = Date.now();
  if (!tape.opened_at && (tracks.length >= tape.slots || (tape.deadline && now >= tape.deadline))) {
    await env.DB.prepare('UPDATE tapes SET opened_at = ? WHERE id = ? AND opened_at IS NULL').bind(now, id).run();
    tape.opened_at = now;
  }
  return { tape, tracks };
}

async function view(req, env, { tape, tracks }) {
  const token = req.headers.get('x-token');
  const key = req.headers.get('x-key');
  const tokenHash = token ? await sha256(token) : null;
  const mine = tracks.find((t) => t.token_hash === tokenHash);
  const pub = (t) => ({ nick: t.nick, title: t.title, artist: t.artist, art: t.art });
  const opened = Boolean(tape.opened_at);
  return {
    id: tape.id,
    title: tape.title,
    slots: tape.slots,
    filled: tracks.length,
    deadline: tape.deadline,
    opened,
    owner: Boolean(key) && (await sha256(key)) === tape.key_hash,
    mine: mine ? { ...pub(mine), index: tracks.indexOf(mine) } : null,
    tracks: opened ? tracks.map(pub) : null,
  };
}

async function getTape(req, env, id) {
  const loaded = await loadTape(env, id);
  if (!loaded) return fail(404, '없는 테이프예요');
  return json(await view(req, env, loaded));
}

async function addTrack(req, env, id) {
  const token = req.headers.get('x-token');
  if (!token || token.length < 16) return fail(400, '다시 시도해주세요');
  const body = await req.json().catch(() => ({}));
  const nick = clean(body.nick, 16);
  const title = clean(body.title, 80);
  const artist = clean(body.artist, 80);
  if (!nick) return fail(400, '닉네임을 적어주세요');
  if (!title || !artist) return fail(400, '곡 제목과 가수를 적어주세요');

  const before = await loadTape(env, id);
  if (!before) return fail(404, '없는 테이프예요');
  if (before.tape.opened_at) return fail(409, '이미 개봉된 테이프예요');

  // 자리 수 확인과 넣기를 한 문장으로: 동시에 들어와도 자리를 넘기지 않는다
  let changes = 0;
  try {
    const res = await env.DB.prepare(
      `INSERT INTO tracks (tape_id, token_hash, nick, title, artist, art, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
       WHERE (SELECT COUNT(*) FROM tracks WHERE tape_id = ?1) < (SELECT slots FROM tapes WHERE id = ?1)`,
    )
      .bind(id, await sha256(token), nick, title, artist, cleanArt(body.art), Date.now())
      .run();
    changes = res.meta.changes;
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return fail(409, '이미 한 곡 넣었어요');
    throw e;
  }
  if (!changes) return fail(409, '방금 마지막 자리가 찼어요');

  return json(await view(req, env, await loadTape(env, id)), 201);
}

async function openTape(req, env, id) {
  const tape = await env.DB.prepare('SELECT key_hash FROM tapes WHERE id = ?').bind(id).first();
  if (!tape) return fail(404, '없는 테이프예요');
  const key = req.headers.get('x-key');
  if (!key || (await sha256(key)) !== tape.key_hash) return fail(403, '만든 사람만 개봉할 수 있어요');
  await env.DB.prepare('UPDATE tapes SET opened_at = ? WHERE id = ? AND opened_at IS NULL').bind(Date.now(), id).run();
  return json(await view(req, env, await loadTape(env, id)));
}

// 곡 검색: iTunes Search API(키 없음)를 대신 불러주고 하루 캐시한다
async function search(req, ctx) {
  const q = clean(new URL(req.url).searchParams.get('q'), 60);
  if (!q) return json({ results: [] });

  const cacheKey = new Request(`https://mixxtape.cache/search?q=${encodeURIComponent(q.toLowerCase())}`);
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const upstream = `https://itunes.apple.com/search?media=music&entity=song&country=KR&lang=ko_kr&limit=8&term=${encodeURIComponent(q)}`;
  const res = await fetch(upstream).catch(() => null);
  if (!res || !res.ok) return fail(502, '검색이 잠깐 안 돼요. 직접 적어서 넣을 수 있어요');
  const data = await res.json().catch(() => ({ results: [] }));
  const results = (data.results || []).map((r) => ({
    title: r.trackName,
    artist: r.artistName,
    art: r.artworkUrl100 || null,
  }));

  const out = new Response(JSON.stringify({ results }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=86400' },
  });
  ctx.waitUntil(caches.default.put(cacheKey, out.clone()));
  return out;
}

export default {
  async fetch(req, env, ctx) {
    const { pathname } = new URL(req.url);
    const { method } = req;
    try {
      if (pathname === '/api/search' && method === 'GET') return await search(req, ctx);
      if (pathname === '/api/tapes' && method === 'POST') return await createTape(req, env);

      const m = pathname.match(/^\/api\/tapes\/([a-z0-9]{8})(\/tracks|\/open)?$/);
      if (m) {
        const [, id, sub] = m;
        if (!sub && method === 'GET') return await getTape(req, env, id);
        if (sub === '/tracks' && method === 'POST') return await addTrack(req, env, id);
        if (sub === '/open' && method === 'POST') return await openTape(req, env, id);
      }
      if (pathname.startsWith('/api/')) return fail(404, '없는 주소예요');
      return env.ASSETS.fetch(req);
    } catch (e) {
      console.error(e);
      return fail(500, '서버에 문제가 생겼어요');
    }
  },
};
