// mixxtape 화면. 서버(/api)가 블라인드를 지키고, 여기는 보여주고 만지게만 한다.

const COLORS = ['#ff6a1a', '#d62bd6', '#59d8b8', '#2fb344', '#ffc928', '#4f8df5', '#f0383a', '#b79be8', '#ff8fb0'];
const MIN_SLOTS = 2;
const MAX_SLOTS = 30;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ── 이 기기 기억 ──
const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};
let token = store.get('mx_token');
if (!token) {
  token = crypto.randomUUID();
  store.set('mx_token', token);
}

// 서버가 없는 곳(GitHub Pages)에서는 이 기기 localStorage가 서버 노릇을 한다.
// 응답 모양은 src/worker.js와 같다. 서버를 붙이면 이 분기만 꺼진다.
const LOCAL =
  location.hostname.endsWith('github.io') || location.protocol === 'file:' || new URLSearchParams(location.search).has('local');

const rid = (n) =>
  [...crypto.getRandomValues(new Uint8Array(n))].map((b) => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('');
const localErr = (status, msg) => Object.assign(new Error(msg), { status });

function jsonpSearch(q) {
  return new Promise((resolve, reject) => {
    const cb = 'mx_cb_' + Date.now();
    const s = document.createElement('script');
    const done = () => {
      delete window[cb];
      s.remove();
    };
    window[cb] = (d) => {
      done();
      resolve((d.results || []).map((r) => ({ title: r.trackName, artist: r.artistName, art: r.artworkUrl100 || null })));
    };
    s.onerror = () => {
      done();
      reject(new Error('검색이 잠깐 안 돼요. 직접 적어서 넣을 수 있어요'));
    };
    s.src = `https://itunes.apple.com/search?media=music&entity=song&country=KR&lang=ko_kr&limit=8&term=${encodeURIComponent(q)}&callback=${cb}`;
    document.head.append(s);
  });
}

async function localApi(path, { body, key } = {}) {
  if (path.startsWith('/search')) return { results: await jsonpSearch(new URLSearchParams(path.split('?')[1]).get('q')) };
  const db = JSON.parse(store.get('mx_db') || '{}');
  const save = () => store.set('mx_db', JSON.stringify(db));

  if (path === '/tapes') {
    const id = rid(8);
    const k = rid(20);
    db[id] = { title: body.title, slots: body.slots, key: k, deadline: body.deadline, openedAt: null, tracks: [] };
    save();
    return { id, key: k };
  }

  const [, id, sub] = path.match(/^\/tapes\/([a-z0-9]+)(\/\w+)?$/) || [];
  const t = db[id];
  if (!t) throw localErr(404, '없는 테이프예요');
  const settle = () => {
    if (!t.openedAt && (t.tracks.length >= t.slots || (t.deadline && Date.now() >= t.deadline))) t.openedAt = Date.now();
  };
  settle();
  if (sub === '/tracks') {
    if (t.openedAt) throw localErr(409, '이미 개봉된 테이프예요');
    if (t.tracks.some((x) => x.token === token)) throw localErr(409, '이미 한 곡 넣었어요');
    t.tracks.push({ token, nick: body.nick, title: body.title, artist: body.artist, art: body.art || null });
    settle();
  }
  if (sub === '/open') {
    if (key !== t.key) throw localErr(403, '만든 사람만 개봉할 수 있어요');
    t.openedAt ||= Date.now();
  }
  save();

  const pub = ({ nick, title, artist, art }) => ({ nick, title, artist, art });
  const mineAt = t.tracks.findIndex((x) => x.token === token);
  return {
    id,
    title: t.title,
    slots: t.slots,
    filled: t.tracks.length,
    deadline: t.deadline,
    opened: Boolean(t.openedAt),
    owner: key === t.key,
    mine: mineAt < 0 ? null : { ...pub(t.tracks[mineAt]), index: mineAt },
    tracks: t.openedAt ? t.tracks.map(pub) : null,
  };
}

async function api(path, { method = 'GET', body, key } = {}) {
  if (LOCAL) return localApi(path, { body, key });
  const res = await fetch('/api' + path, {
    method,
    headers: { 'content-type': 'application/json', 'x-token': token, ...(key ? { 'x-key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || '문제가 생겼어요'), { status: res.status });
  return data;
}

// ── 토스트 ──
let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2400);
}

async function copy(text, done = '복사했어요') {
  try {
    await navigator.clipboard.writeText(text);
    toast(done);
  } catch {
    prompt('복사해서 쓰세요', text);
  }
}

async function share(text, url) {
  if (navigator.share) {
    try {
      await navigator.share({ text, url });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  copy(`${text}\n${url}`, '복사했어요. 단톡방에 붙여넣으세요');
}

// ── 코인 ──
const eyes = (i = 0) => `<span class="eyes"><i style="--d:${(i * 0.7) % 5}s"></i><i style="--d:${(i * 0.7) % 5}s"></i></span>`;
const coin = (i, cls = '') => `<span class="coin ${cls}" style="--c:${COLORS[i % COLORS.length]}">${eyes(i)}</span>`;
const artCoin = (art, i) =>
  art
    ? `<span class="coin" style="--c:${COLORS[i % COLORS.length]}"><img src="${esc(art)}" alt="" loading="lazy" /></span>`
    : coin(i);

// 눈이 커서를 따라간다
let pointer = { x: innerWidth / 2, y: innerHeight / 2, moved: false };
let eyeFrame = 0;
addEventListener('pointermove', (e) => {
  pointer = { x: e.clientX, y: e.clientY, moved: true };
  if (reduceMotion || eyeFrame) return;
  eyeFrame = requestAnimationFrame(() => {
    eyeFrame = 0;
    for (const el of document.querySelectorAll('.eyes')) {
      const r = el.parentElement.getBoundingClientRect();
      const dx = pointer.x - (r.left + r.width / 2);
      const dy = pointer.y - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const reach = r.width * 0.14;
      el.style.transform = `translate(${(dx / d) * reach}px, ${(dy / d) * reach}px)`;
    }
  });
});

// ── 배경에 떠다니는 코인: 커서가 다가오면 밀려난다 ──
const floaters = (() => {
  const layer = $('#floaters');
  let items = [];
  let raf = 0;

  function set(n) {
    cancelAnimationFrame(raf);
    layer.innerHTML = '';
    const W = innerWidth;
    const H = innerHeight;
    items = Array.from({ length: n }, (_, i) => {
      const s = 44 + Math.random() * (W < 600 ? 50 : 96);
      const el = document.createElement('span');
      el.className = 'coin';
      el.style.cssText = `--c:${COLORS[i % COLORS.length]};--s:${s}px`;
      el.innerHTML = eyes(i);
      layer.append(el);
      // 가운데 글자를 가리지 않게 가장자리 쪽에서 시작
      const side = i % 2 ? 1 : -1;
      const x = W < 700 ? (side < 0 ? -s * 0.4 : W - s * 0.6) : W / 2 + side * (W * 0.22 + Math.random() * W * 0.28) - s / 2;
      const y = Math.random() * (H - s);
      const a = Math.random() * Math.PI * 2;
      return { el, s, x, y, vx: Math.cos(a) * 0.25, vy: Math.sin(a) * 0.25 };
    });
    if (!n) return;
    if (reduceMotion) return items.forEach((p) => (p.el.style.transform = `translate(${p.x}px, ${p.y}px)`));
    raf = requestAnimationFrame(tick);
  }

  function tick() {
    const W = innerWidth;
    const H = innerHeight;
    for (const p of items) {
      const cx = p.x + p.s / 2;
      const cy = p.y + p.s / 2;
      if (pointer.moved) {
        const dx = cx - pointer.x;
        const dy = cy - pointer.y;
        const d = Math.hypot(dx, dy) || 1;
        const reach = p.s / 2 + 110;
        if (d < reach) {
          const f = ((reach - d) / reach) * 0.9;
          p.vx += (dx / d) * f;
          p.vy += (dy / d) * f;
        }
      }
      // 가운데(글자 자리)에서는 살짝 밀어낸다
      const mx = cx - W / 2;
      // 좁은 화면에서는 양옆 가장자리에 반쯤 걸쳐서 논다
      const zone = W > 700 ? Math.min(W * 0.26, 300) : W / 2 - p.s * 0.25;
      if (Math.abs(mx) < zone) p.vx += Math.sign(mx || 1) * (W > 700 ? 0.02 : 0.05);

      const sp = Math.hypot(p.vx, p.vy);
      if (sp > 0.35) {
        p.vx *= 0.96;
        p.vy *= 0.96;
      } else if (sp < 0.2) {
        p.vx *= 1.03;
        p.vy *= 1.03;
      }
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -p.s * 0.45) p.vx = Math.abs(p.vx);
      if (p.x > W - p.s * 0.55) p.vx = -Math.abs(p.vx);
      if (p.y < -p.s * 0.3) p.vy = Math.abs(p.vy);
      if (p.y > H - p.s * 0.7) p.vy = -Math.abs(p.vy);
      p.el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${p.vx * 14}deg)`;
    }
    raf = requestAnimationFrame(tick);
  }

  return { set };
})();

// ── 길 찾기 ──
let pollTimer;
const HOME = location.pathname;
const tapeUrl = (id) => `${HOME}?t=${id}${new URLSearchParams(location.search).has('local') ? '&local' : ''}`;
function go(path) {
  history.pushState(null, '', path);
  route();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  go(HOME);
});
addEventListener('popstate', route);

function route() {
  clearInterval(pollTimer);
  scrollTo(0, 0);
  const m = (new URLSearchParams(location.search).get('t') || '').match(/^([a-z0-9]{8})$/);
  $('#newBtn').hidden = !m;
  if (m) return tapeView(m[1]);
  homeView();
}

// ── 홈: 테이프 만들기 ──
function homeView() {
  document.title = 'mixxtape';
  floaters.set(innerWidth < 700 ? 6 : 12);
  let slots = 9;
  let hours = 0;

  app.innerHTML = `
    <section class="view">
      <div class="center">
        <h1>한 곡씩 몰래,<br />같이 플레이리스트를<br />완성해요</h1>
        <p class="lead">다 찰 때까지 누가 뭘 넣었는지 아무도 몰라요.</p>
      </div>

      <form class="maker" id="maker" autocomplete="off">
        <label class="label" for="title">테이프 이름</label>
        <input class="big-input" id="title" maxlength="40" placeholder="우리 단톡방 올해의 9곡" enterkeyhint="done" />

        <div class="sep"></div>

        <span class="label" id="slotsLabel">몇 곡짜리</span>
        <div class="stepper" role="group" aria-labelledby="slotsLabel">
          <button type="button" class="round" id="minus" aria-label="한 곡 줄이기">−</button>
          <output id="slots" aria-live="polite">9</output>
          <button type="button" class="round" id="plus" aria-label="한 곡 늘리기">+</button>
        </div>
        <div class="preview" id="preview" aria-hidden="true"></div>

        <div class="sep"></div>

        <span class="label" id="dlLabel">언제까지</span>
        <div class="chips" role="group" aria-labelledby="dlLabel">
          <button type="button" class="chip" data-h="0" aria-pressed="true">다 찰 때까지</button>
          <button type="button" class="chip" data-h="24" aria-pressed="false">24시간</button>
          <button type="button" class="chip" data-h="72" aria-pressed="false">3일</button>
          <button type="button" class="chip" data-h="168" aria-pressed="false">7일</button>
        </div>

        <button class="btn wide" id="create">테이프 만들기</button>
      </form>
    </section>`;

  const preview = $('#preview');
  const paint = () => {
    $('#slots').textContent = slots;
    while (preview.children.length > slots) preview.lastElementChild.remove();
    while (preview.children.length < slots) preview.insertAdjacentHTML('beforeend', coin(preview.children.length));
    $('#title').placeholder = `우리 단톡방 올해의 ${slots}곡`;
  };
  paint();

  const step = (d) => {
    slots = Math.min(MAX_SLOTS, Math.max(MIN_SLOTS, slots + d));
    paint();
  };
  $('#minus').onclick = () => step(-1);
  $('#plus').onclick = () => step(1);

  for (const chip of app.querySelectorAll('.chip')) {
    chip.onclick = () => {
      hours = Number(chip.dataset.h);
      app.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
    };
  }

  $('#maker').onsubmit = async (e) => {
    e.preventDefault();
    const title = $('#title').value.trim() || $('#title').placeholder;
    const btn = $('#create');
    btn.disabled = true;
    try {
      const { id, key } = await api('/tapes', {
        method: 'POST',
        body: { title, slots, deadline: hours ? Date.now() + hours * 3600e3 : null },
      });
      store.set('mx_key_' + id, key);
      go(tapeUrl(id));
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  };
}

// ── 테이프 ──
const fmtDeadline = (ms) =>
  new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(ms);

async function tapeView(id) {
  floaters.set(0);
  // 관리 링크(#k=열쇠)로 들어오면 이 기기에 기억해둔다
  const hashKey = new URLSearchParams(location.hash.slice(1)).get('k');
  if (hashKey) {
    store.set('mx_key_' + id, hashKey);
    history.replaceState(null, '', tapeUrl(id));
  }
  const key = store.get('mx_key_' + id);
  const url = location.origin + tapeUrl(id);

  let tape;
  let picked = null; // 고른 곡
  let manual = false;
  let justDropped = false;

  app.innerHTML = `<section class="view center"><p class="lead">테이프 꺼내는 중…</p></section>`;
  try {
    tape = await api('/tapes/' + id, { key });
  } catch (err) {
    app.innerHTML = `
      <section class="view center">
        <h1>${err.status === 404 ? '없는 테이프예요' : '잠깐 안 열려요'}</h1>
        <p class="lead">${err.status === 404 ? '링크를 다시 확인해주세요.' : esc(err.message)}</p>
        <p class="mt"><a class="btn" href="./" data-link>새 테이프 만들기</a></p>
      </section>`;
    return;
  }

  render();
  pollTimer = setInterval(async () => {
    if (tape.opened || document.hidden) return;
    try {
      const next = await api('/tapes/' + id, { key });
      if (next.filled !== tape.filled || next.opened !== tape.opened) {
        const opening = next.opened && !tape.opened;
        tape = next;
        if (opening) render();
        else paintTray(true);
      }
    } catch {}
  }, 4000);

  function render() {
    document.title = `${tape.title} · mixxtape`;
    if (tape.opened) return renderOpened();
    renderBlind();
  }

  // ── 개봉 전 ──
  function renderBlind() {
    const left = tape.slots - tape.filled;
    app.innerHTML = `
      <section class="view">
        <div class="center">
          <p class="eyebrow">블라인드 테이프${tape.deadline ? ` · ${esc(fmtDeadline(tape.deadline))}에 개봉` : ''}</p>
          <h1>${esc(tape.title)}</h1>
        </div>
        <div class="ring-wrap">
          <div class="tray" id="tray"></div>
          <p class="count" id="count" aria-live="polite"></p>
        </div>
        <div class="panel" id="panel"></div>
        ${
          tape.owner
            ? `<div class="owner stack">
                <span class="label">만든 사람만 보여요</span>
                <div class="row">
                  <button class="btn ghost" id="copyAdmin">관리 링크 복사</button>
                  <button class="btn ghost" id="forceOpen">지금 개봉하기</button>
                </div>
                <p class="hint">관리 링크는 다른 기기에서도 개봉 권한을 쓰는 열쇠예요. 단톡방엔 올리지 마세요.</p>
              </div>`
            : ''
        }
        ${
          LOCAL
            ? `<div class="demo">
                <p>지금은 체험판이라 이 기기에만 저장돼요. 링크를 보내도 친구 기기에서는 안 열려요.</p>
                <button class="btn small ghost" id="asFriend">다른 친구인 척 들어가기</button>
              </div>`
            : ''
        }
      </section>`;
    if (LOCAL) {
      $('#asFriend').onclick = async () => {
        token = crypto.randomUUID();
        store.set('mx_token', token);
        tape = await api('/tapes/' + id, { key });
        picked = null;
        manual = false;
        render();
        toast('새 친구로 들어왔어요');
      };
    }
    paintTray(false);
    paintPanel();

    if (tape.owner) {
      $('#copyAdmin').onclick = () => copy(`${url}#k=${key}`, '관리 링크를 복사했어요');
      $('#forceOpen').onclick = async () => {
        if (!confirm(`아직 ${left}자리 남았어요. 지금 개봉할까요?`)) return;
        try {
          tape = await api(`/tapes/${id}/open`, { method: 'POST', key });
          render();
        } catch (err) {
          toast(err.message);
        }
      };
    }
  }

  function paintTray(fromPoll) {
    const tray = $('#tray');
    if (!tray) return;
    const n = tape.slots;
    const count = $('#count');
    count.innerHTML = `<span><b>${tape.filled}</b>/${n}</span>`;
    if (justDropped || fromPoll) {
      count.classList.remove('bump');
      void count.offsetWidth;
      count.classList.add('bump');
    }
    // 자리 수가 많아질수록 코인이 작아져서 고리에 딱 맞게
    const f = (0.8 * Math.PI) / (n + 0.8 * Math.PI);
    tray.style.setProperty('--s', `min(88px, ${(f * 100).toFixed(2)}cqw)`);
    tray.innerHTML = Array.from({ length: n }, (_, i) => {
      const wrap = (inner) => `<span class="slot" style="--a:${(i * 360) / n}deg"><span class="up">${inner}</span></span>`;
      if (i >= tape.filled) return wrap(`<span class="coin empty" aria-label="빈 자리"></span>`);
      const mine = tape.mine?.index === i;
      const isNew = i === tape.filled - 1 && (justDropped || fromPoll);
      return wrap(`<button class="coin ${mine ? 'mine' : ''} ${isNew ? 'drop' : ''}" style="--c:${COLORS[i % COLORS.length]}"
        aria-label="${mine ? '내가 넣은 곡' : '누군가 넣은 곡'}">${eyes(i)}</button>`);
    }).join('');
    justDropped = false;
    // 톡 치면 흔들린다. 뭐가 들었는지는 안 알려준다
    for (const c of tray.querySelectorAll('button.coin')) {
      c.onclick = () => {
        c.classList.remove('wob', 'drop');
        void c.offsetWidth;
        c.classList.add('wob');
        toast(c.classList.contains('mine') ? `내 곡: ${tape.mine.title}` : '다 찰 때까지 비밀이에요');
      };
    }
  }

  function paintPanel() {
    const panel = $('#panel');
    const left = tape.slots - tape.filled;

    if (tape.mine) {
      const nudge = `📼 "${tape.title}" 아직 ${left}자리 남았어. 한 곡만 몰래 넣고 가`;
      panel.innerHTML = `
        <div class="sheet stack">
          <span class="label">내가 넣은 곡 · 나만 보여요</span>
          <div class="song">${artCoin(tape.mine.art, tape.mine.index)}
            <span class="txt"><span class="t">${esc(tape.mine.title)}</span><span class="a">${esc(tape.mine.artist)}</span></span>
          </div>
          <div class="row mt">
            <button class="btn" id="nudge">독촉장 보내기</button>
            <button class="btn ghost" id="copyLink">링크 복사</button>
          </div>
          <p class="hint">${left}자리가 더 차면 열려요. 이 화면은 알아서 바뀌어요.</p>
        </div>`;
      $('#nudge').onclick = () => share(nudge, url);
      $('#copyLink').onclick = () => copy(url, '링크를 복사했어요');
      return;
    }

    if (picked) {
      panel.innerHTML = `
        <form class="sheet stack" id="putForm" autocomplete="off">
          <div class="song">${artCoin(picked.art, tape.filled)}
            <span class="txt"><span class="t">${esc(picked.title)}</span><span class="a">${esc(picked.artist)}</span></span>
          </div>
          <input class="field mt" id="nick" maxlength="16" placeholder="닉네임 (개봉 때 공개돼요)" value="${esc(store.get('mx_nick') || '')}" />
          <div class="row">
            <button type="button" class="btn ghost" id="back">다른 곡</button>
            <button class="btn" id="put">몰래 넣기</button>
          </div>
        </form>`;
      $('#nick').focus();
      $('#back').onclick = () => {
        picked = null;
        paintPanel();
      };
      $('#putForm').onsubmit = put;
      return;
    }

    if (manual) {
      panel.innerHTML = `
        <form class="sheet stack" id="manualForm" autocomplete="off">
          <span class="label">직접 적기</span>
          <input class="field" id="mTitle" maxlength="80" placeholder="곡 제목" />
          <input class="field" id="mArtist" maxlength="80" placeholder="가수" />
          <div class="row">
            <button type="button" class="btn ghost" id="back">검색으로</button>
            <button class="btn">이 곡으로</button>
          </div>
        </form>`;
      $('#mTitle').focus();
      $('#back').onclick = () => {
        manual = false;
        paintPanel();
      };
      $('#manualForm').onsubmit = (e) => {
        e.preventDefault();
        const title = $('#mTitle').value.trim();
        const artist = $('#mArtist').value.trim();
        if (!title || !artist) return toast('제목과 가수를 적어주세요');
        picked = { title, artist, art: null };
        paintPanel();
      };
      return;
    }

    panel.innerHTML = `
      <label class="search">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <input id="q" type="search" placeholder="몰래 넣을 곡 찾기" aria-label="곡 검색" enterkeyhint="search" />
      </label>
      <ul class="results" id="results"></ul>
      <div class="center"><button class="linkish" id="toManual">검색에 없으면 직접 적기</button></div>`;
    $('#toManual').onclick = () => {
      manual = true;
      paintPanel();
    };

    let timer;
    let seq = 0;
    $('#q').oninput = (e) => {
      clearTimeout(timer);
      const q = e.target.value.trim();
      const list = $('#results');
      if (!q) return (list.innerHTML = '');
      timer = setTimeout(async () => {
        const mySeq = ++seq;
        try {
          const { results } = await api('/search?q=' + encodeURIComponent(q));
          if (mySeq !== seq || !$('#results')) return;
          list.innerHTML = results.length
            ? results
                .map(
                  (r, i) => `<li style="--i:${i}"><button class="song" data-i="${i}">${artCoin(r.art, i)}
                    <span class="txt"><span class="t">${esc(r.title)}</span><span class="a">${esc(r.artist)}</span></span></button></li>`,
                )
                .join('')
            : `<li class="hint center">못 찾았어요. 아래에서 직접 적을 수 있어요.</li>`;
          for (const b of list.querySelectorAll('button.song')) {
            b.onclick = () => {
              picked = results[Number(b.dataset.i)];
              paintPanel();
            };
          }
        } catch (err) {
          if (mySeq === seq) list.innerHTML = `<li class="hint center">${esc(err.message)}</li>`;
        }
      }, 280);
    };
  }

  async function put(e) {
    e.preventDefault();
    const nick = $('#nick').value.trim();
    if (!nick) {
      $('#nick').focus();
      return toast('닉네임을 적어주세요');
    }
    $('#put').disabled = true;
    try {
      const next = await api(`/tapes/${id}/tracks`, { method: 'POST', key, body: { nick, ...picked } });
      store.set('mx_nick', nick);
      const opening = next.opened;
      tape = next;
      picked = null;
      if (opening) return render();
      justDropped = true;
      paintTray(false);
      paintPanel();
      toast('쏙. 아무도 몰라요');
    } catch (err) {
      toast(err.message);
      if (err.status === 409) {
        tape = await api('/tapes/' + id, { key }).catch(() => tape);
        picked = null;
        render();
      } else $('#put').disabled = false;
    }
  }

  // ── 개봉 ──
  function renderOpened() {
    clearInterval(pollTimer);
    const tracks = tape.tracks;
    const q = (t) => encodeURIComponent(`${t.artist} ${t.title}`);
    const listText = tracks.map((t, i) => `${i + 1}. ${t.artist} - ${t.title}`).join('\n');

    app.innerHTML = `
      <section class="view">
        <div class="center">
          <p class="eyebrow">개봉 · ${tracks.length}곡</p>
          <h1>${esc(tape.title)}</h1>
        </div>
        ${
          tracks.length
            ? `<ol class="reveal">${tracks
                .map(
                  (t, i) => `<li style="--i:${i}"><div class="track">
                    <span class="no">${String(i + 1).padStart(2, '0')}</span>
                    ${artCoin(t.art, i)}
                    <div>
                      <div class="t">${esc(t.title)}<span class="by">${esc(t.nick)}</span></div>
                      <div class="a">${esc(t.artist)}</div>
                      <div class="listen">
                        <a href="https://music.youtube.com/search?q=${q(t)}" target="_blank" rel="noopener">YouTube Music</a>
                        <a href="https://open.spotify.com/search/${q(t)}" target="_blank" rel="noopener">Spotify</a>
                        <a href="https://music.apple.com/kr/search?term=${q(t)}" target="_blank" rel="noopener">Apple Music</a>
                        <a href="https://www.melon.com/search/total/index.htm?q=${q(t)}" target="_blank" rel="noopener">멜론</a>
                      </div>
                    </div>
                  </div></li>`,
                )
                .join('')}</ol>
              <div class="row mt" style="margin-top:36px">
                <button class="btn" id="shareOpen">단톡방에 알리기</button>
                <button class="btn ghost" id="copyList">목록 복사</button>
                <button class="btn ghost" id="csv">CSV 받기</button>
              </div>
              <p class="hint">CSV는 TuneMyMusic 같은 변환 서비스에 올리면 쓰는 앱의 플레이리스트로 옮길 수 있어요.</p>`
            : `<p class="lead center">아무도 곡을 넣지 않고 마감됐어요.</p>`
        }
      </section>`;

    if (!tracks.length) return;
    $('#shareOpen').onclick = () => share(`📼 "${tape.title}" 개봉됐어. 누가 뭘 넣었는지 보러 와`, url);
    $('#copyList').onclick = () => copy(`${tape.title}\n\n${listText}`, '목록을 복사했어요');
    $('#csv').onclick = () => {
      const cell = (s) => `"${String(s).replace(/"/g, '""')}"`;
      const rows = [['Track name', 'Artist name', 'Added by'], ...tracks.map((t) => [t.title, t.artist, t.nick])];
      const blob = new Blob(['﻿' + rows.map((r) => r.map(cell).join(',')).join('\n')], { type: 'text/csv' });
      const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(blob),
        download: `${tape.title}.csv`,
      });
      a.click();
      URL.revokeObjectURL(a.href);
    };
  }
}

route();
