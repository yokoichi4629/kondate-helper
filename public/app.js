// 献立ヘルパー — 画面と機能
// 画面: ホーム / 撮影 / 食材の確認 / 献立 / 料理の詳細 / 設定
'use strict';

const APP_VERSION = '1.1';
const STORE_KEY = 'kondate-helper.v1';
const MAX_PHOTOS = 4;
const DISH_KEYS = ['main', 'side'];
const DISH_LABEL = { main: '主菜', side: '副菜' };
const GENRE_LABEL = { 和: '和食', 洋: '洋食', 中: '中華' };
const genreOf = (plan, i) => plan.days[i].genre || Calc.genreFor(i);
const $app = document.getElementById('app');

// ---------- 保存 ----------
const DEFAULT_STATE = {
  settings: { adults: 2, children: [8], avoid: [], maxDays: 5 },
  draft: [],   // 確認中の食材
  plan: null,  // 作った献立
};
let state = load();
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    if (s && s.settings) return { ...structuredClone(DEFAULT_STATE), ...s, settings: { ...DEFAULT_STATE.settings, ...s.settings } };
  } catch { /* 読めなければ初期状態 */ }
  return structuredClone(DEFAULT_STATE);
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { toast('保存できませんでした'); }
}

// ---------- 小道具 ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
function peopleText(s = state.settings) {
  const parts = [`大人${s.adults}人`];
  if (s.children.length) parts.push(`子ども${s.children.length}人(${s.children.map((a) => `${a}歳`).join('・')})`);
  return parts.join('、');
}
function dayLabel(plan, i) {
  const d = new Date(plan.createdAt); d.setDate(d.getDate() + i);
  return `${d.getMonth() + 1}/${d.getDate()}(${'日月火水木金土'[d.getDay()]})`;
}
function todayIndex(plan) {
  if (!plan) return -1;
  const i = plan.days.findIndex((d) => !d.done);
  return i;
}
async function api(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'error');
    err.code = res.status === 429 || data.error === 'limit' ? 'limit' : data.error;
    throw err;
  }
  return data;
}
function errorText(e) {
  if (!navigator.onLine) return '電波がつながっていません。つながる場所でもう一度お試しください。';
  if (e?.code === 'limit') return '今日のAIの無料枠を使い切りました。朝9時を過ぎるとまた使えます。';
  return 'うまくいきませんでした。少し待ってからもう一度お試しください。';
}

// ---------- 画面の切り替え ----------
window.addEventListener('hashchange', render);
let lastHash = null;
function render() {
  const [route, a, b] = location.hash.replace(/^#\/?/, '').split('/');
  const tab = route === 'settings' ? 'settings' : ['menu', 'dish'].includes(route) ? 'menu' : 'home';
  document.querySelectorAll('.tabbar a').forEach((el) => el.classList.toggle('on', el.dataset.tab === tab));
  const y = window.scrollY;
  requestAnimationFrame(() => window.scrollTo(0, location.hash === lastHash ? y : 0));
  lastHash = location.hash;
  if (route === 'scan') return renderScan();
  if (route === 'confirm') return renderConfirm();
  if (route === 'menu') return renderMenu(a);
  if (route === 'dish') return renderDish(Number(a), b);
  if (route === 'settings') return renderSettings();
  return renderHome();
}

// ---------- ホーム ----------
function renderHome() {
  const plan = state.plan;
  const ti = todayIndex(plan);
  const remainDays = plan ? plan.days.filter((d) => !d.done).length : 0;
  const leftCount = plan ? plan.calc.leftovers.length : 0;
  let today = '';
  if (plan && ti >= 0) {
    const day = plan.days[ti];
    today = `
      <h2>${ti === 0 && !plan.days.some((d) => d.done) ? '今日' : '次'}の献立 <span class="small">${esc(dayLabel(plan, ti))} ・ ${esc(GENRE_LABEL[genreOf(plan, ti)])}</span></h2>
      <a class="card" href="#/menu/${ti}">
        ${day.dishes ? DISH_KEYS.map((k) => `
          <div class="today-dish"><span class="tag ${k}">${DISH_LABEL[k]}</span><span class="grow">${esc(day.dishes[k].name)}</span></div>`).join('')
          : '<p class="small">献立がまだできていません。タップして作り直してください。</p>'}
      </a>`;
  } else if (plan) {
    today = `<h2>献立</h2><div class="card"><p>すべての献立を作り終えました。おつかれさまでした！</p><p class="small" style="margin-top:6px">次の買い物のあとに、また食材を撮ってください。</p></div>`;
  }
  $app.innerHTML = `
    <section class="hero">
      <h1>献立ヘルパー</h1>
      <p>買ってきた食材を撮るだけで、何日分になるかと、その日数分の夕食の献立がわかります。</p>
      <a class="btn big" href="#/scan">📷 食材を撮る</a>
    </section>
    ${plan ? `
      <div class="stats">
        <a class="stat" href="#/menu"><span class="label">献立の残り</span><b>${remainDays}<small style="font-size:15px">日分</small></b></a>
        <a class="stat" href="#/menu"><span class="label">残りの食材</span><b>${leftCount}<small style="font-size:15px">品</small></b></a>
      </div>${today}` : `
      <h2>使い方</h2>
      <div class="card stack">
        <p>1. 買ってきた食材(またはレシート)を撮る</p>
        <p>2. 読み取った食材と量を確かめる</p>
        <p>3. 「献立を作る」を押すと、何日分になるかと献立が出ます</p>
      </div>
      <p class="small" style="margin:12px 2px">家族の人数は「設定」で変えられます(いまは ${esc(peopleText())})。</p>`}
    <p class="small" style="text-align:center;margin-top:28px">バージョン ${APP_VERSION}</p>`;
}

// ---------- 撮影 ----------
let photos = []; // { url, kind } 端末の中だけ。サーバーには保存しない
function renderScan() {
  $app.innerHTML = `
    <a class="back" href="#/">‹ ホーム</a>
    <h1>食材を撮る</h1>
    <p class="lead">買ってきた食材を並べて撮ってください。複数枚(最大${MAX_PHOTOS}枚)撮れます。レシートの写真を足すと、量の精度が上がります。</p>
    <div class="btns" style="grid-template-columns:1fr 1fr">
      <label class="btn primary">📷 撮影する<input type="file" accept="image/*" capture="environment" data-kind="食材"></label>
      <label class="btn">🧾 レシート<input type="file" accept="image/*" capture="environment" data-kind="レシート"></label>
    </div>
    <label class="btn ghost block sm" style="margin-top:10px">🖼 アルバムから選ぶ<input type="file" accept="image/*" multiple data-kind="食材"></label>
    ${photos.length ? `<div class="shots">${photos.map((p, i) => `
      <div class="shot"><img src="${p.url}" alt="${esc(p.kind)}の写真 ${i + 1}"><span class="kind">${esc(p.kind)}</span><button data-del="${i}" aria-label="この写真を消す">×</button></div>`).join('')}</div>`
      : '<div class="drop">まだ写真がありません</div>'}
    <div class="btns">
      <button class="btn accent big" id="read" ${photos.length ? '' : 'disabled'}>読み取る(${photos.length}枚)</button>
      <a class="btn ghost" href="#/confirm" id="manual">写真を使わず、手で入力する</a>
    </div>
    <p class="small" style="margin-top:12px">写真は読み取りにだけ使い、保存しません。</p>`;

  $app.querySelectorAll('input[type=file]').forEach((input) => input.addEventListener('change', async () => {
    const files = [...input.files].slice(0, MAX_PHOTOS - photos.length);
    if (input.files.length > files.length) toast(`写真は${MAX_PHOTOS}枚までです`);
    for (const f of files) {
      try { photos.push({ url: await shrink(f), kind: input.dataset.kind }); } catch { toast('この写真は読み込めませんでした'); }
    }
    renderScan();
  }));
  $app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { photos.splice(Number(b.dataset.del), 1); renderScan(); }));
  $app.querySelector('#manual').addEventListener('click', () => { if (!state.draft.length) { state.draft = []; save(); } });
  $app.querySelector('#read').addEventListener('click', readPhotos);
}

// 写真を小さくしてから送る(通信量とAIの使用量を減らす)
function shrink(file, max = 1280) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
    img.src = url;
  });
}

async function readPhotos() {
  $app.innerHTML = `
    <div class="card" style="text-align:center;margin-top:40px">
      <div class="spinner"></div>
      <p><b>食材を読み取っています…</b></p>
      <p class="small" style="margin-top:6px">10〜30秒ほどかかります</p>
    </div>`;
  try {
    const { items } = await api('/api/scan', { images: photos.map((p) => p.url) });
    if (!items.length) { toast('食材が見つかりませんでした。撮り直すか、手で入力してください'); return renderScan(); }
    state.draft = items;
    save();
    photos = []; // 読み取りが終わったら写真は捨てる
    go('#/confirm');
  } catch (e) {
    toast(errorText(e));
    renderScan();
  }
}

// ---------- 食材の確認 ----------
function renderConfirm() {
  const items = state.draft;
  const unitOptions = (u) => Calc.UNITS.map((x) => `<option ${x === u ? 'selected' : ''}>${x}</option>`).join('');
  const catOptions = (c) => Object.entries(Calc.CAT_LABEL).map(([k, v]) => `<option value="${k}" ${k === c ? 'selected' : ''}>${v}</option>`).join('');
  $app.innerHTML = `
    <a class="back" href="#/scan">‹ 撮影にもどる</a>
    <h1>食材の確認</h1>
    <p class="lead">AIが読み取った食材と量です。写真から量を正確に測ることはできないので、ちがうところは直してください。<b style="color:var(--accent)">赤い線</b>の食材が主菜になり、日数を決めます。</p>
    <div id="items" class="stack">${items.map((it, i) => `
      <div class="card item ${Calc.MAIN_CATS.includes(it.category) ? 'main-food' : ''}" data-i="${i}">
        <div class="top">
          <input class="name grow" data-f="name" value="${esc(it.name)}" aria-label="食材名" placeholder="食材名">
          <button class="del" data-del="${i}" aria-label="${esc(it.name)}を削除">🗑</button>
        </div>
        <div class="bottom">
          <input type="number" inputmode="decimal" min="0" step="any" data-f="qty" value="${esc(it.qty)}" aria-label="量">
          <select data-f="unit" aria-label="単位">${unitOptions(it.unit)}</select>
          <select data-f="category" aria-label="種類">${catOptions(it.category)}</select>
        </div>
        ${needsGpu(it) ? `<div class="gpu">1${esc(it.unit)} ≈ <input type="number" inputmode="numeric" min="1" data-f="gpu" value="${esc(gpuOf(it))}" aria-label="1${esc(it.unit)}あたりの重さ">${it.category === 'egg' ? '個' : 'g'}</div>` : ''}
      </div>`).join('')}
    </div>
    <button class="btn ghost block" id="add" style="margin-top:12px">＋ 食材を追加(家にある残り物など)</button>
    <div class="summary" id="summary"></div>`;

  const update = () => {
    const p = Calc.plan(state.draft, state.settings);
    const box = $app.querySelector('#summary');
    box.innerHTML = `
      <div class="row"><div class="grow">
        <div class="label">主菜になる食材 ${p.totalPortions}食分(${esc(peopleText())} = 大人${p.eq}人分)</div>
        <div style="font-size:20px;font-weight:900">${p.days ? `${p.days}日分の献立になります` : '主菜になる食材が足りません'}</div>
        ${p.capped ? `<div class="small">${p.possibleDays}日分ありますが、献立は${p.days}日分までにして、残りは次に回します</div>` : ''}
      </div></div>
      <button class="btn primary block" id="make" ${p.days ? '' : 'disabled'}>献立を作る</button>`;
    box.querySelector('#make').addEventListener('click', () => makePlan());
  };
  update();

  $app.querySelector('#items').addEventListener('input', (e) => {
    const el = e.target.closest('[data-f]'); if (!el) return;
    const i = Number(el.closest('[data-i]').dataset.i), f = el.dataset.f;
    const it = state.draft[i];
    if (f === 'qty' || f === 'gpu') it[f] = Number(el.value) || 0;
    else it[f] = el.value;
    if (f === 'unit' || f === 'category') {
      it.gpu = it.unit === 'g' ? 1 : it.unit === 'kg' ? 1000 : (Calc.DEFAULT_GPU[it.category] || {})[it.unit] || it.gpu || 0;
      save(); return renderConfirm();
    }
    save(); update();
  });
  $app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    state.draft.splice(Number(b.dataset.del), 1); save(); renderConfirm();
  }));
  $app.querySelector('#add').addEventListener('click', () => {
    state.draft.push({ name: '', category: 'veg', qty: 1, unit: '個', gpu: 150 });
    save(); renderConfirm();
    const inputs = $app.querySelectorAll('.item .name'); inputs[inputs.length - 1]?.focus();
  });
}
const needsGpu = (it) => !['g', 'kg'].includes(it.unit) && it.category !== 'other' && !(it.category === 'egg' && it.unit === '個');
const gpuOf = (it) => it.gpu || (Calc.DEFAULT_GPU[it.category] || {})[it.unit] || 100;

// ---------- 献立を作る ----------
let generating = false;
async function makePlan() {
  const items = state.draft.filter((it) => it.name.trim() && Number(it.qty) > 0).map((it) => ({ ...it, gpu: needsGpu(it) ? gpuOf(it) : it.gpu }));
  const calc = Calc.plan(items, state.settings);
  if (!calc.days) return toast('主菜になる食材が足りません');
  state.plan = {
    createdAt: new Date().setHours(0, 0, 0, 0),
    calc,
    people: peopleText(),
    days: calc.dayPlans.map((_, i) => ({ genre: Calc.genreFor(i), dishes: null, done: false, error: false })),
  };
  save();
  go('#/menu');
  generateMissing();
}

async function generateMissing() {
  if (generating || !state.plan) return;
  generating = true;
  const plan = state.plan;
  for (let i = 0; i < plan.days.length; i++) {
    if (plan.days[i].dishes) continue;
    plan.days[i].error = false;
    drawProgress();
    try {
      plan.days[i].dishes = await makeDay(plan, i);
    } catch (e) {
      plan.days[i].error = true;
      toast(errorText(e));
      if (e?.code === 'limit' || !navigator.onLine) break;
    }
    if (state.plan !== plan) break; // 途中で作り直した
    save();
    if (location.hash.startsWith('#/menu')) render();
  }
  generating = false;
  if (location.hash.startsWith('#/menu') || location.hash === '#/' || location.hash === '') render();
}

async function makeDay(plan, i, avoidExtra = []) {
  const dp = plan.calc.dayPlans[i];
  const previous = plan.days.filter((d, j) => j !== i && d.dishes).flatMap((d) => DISH_KEYS.map((k) => d.dishes[k].name));
  const avoid = state.settings.avoid;
  const body = { people: plan.people, eq: plan.calc.eq, genre: genreOf(plan, i), main: dp.main, veg: dp.veg, pantry: plan.calc.pantry, avoid, previous: [...previous, ...avoidExtra] };
  let dishes = await api('/api/menu', body);
  // アレルギー・苦手な食材が入っていたら、1回だけ作り直す
  if (Calc.findAvoided(dishes, avoid).length) dishes = await api('/api/menu', body);
  return dishes;
}

function drawProgress() {
  const box = document.getElementById('gen');
  if (!box || !state.plan) return;
  const n = state.plan.days.length, done = state.plan.days.filter((d) => d.dishes).length;
  box.querySelector('span').style.width = `${Math.round((done / n) * 100)}%`;
  box.nextElementSibling.textContent = `${done} / ${n}日分 できました`;
}

// ---------- 献立 ----------
function renderMenu(sel) {
  const plan = state.plan;
  if (!plan) {
    $app.innerHTML = `
      <h1>献立</h1>
      <div class="card"><p>まだ献立がありません。</p><p class="small" style="margin-top:6px">買ってきた食材を撮ると、何日分になるかと献立が出ます。</p></div>
      <div class="btns"><a class="btn primary big" href="#/scan">📷 食材を撮る</a></div>`;
    return;
  }
  const n = plan.days.length;
  const doneCount = plan.days.filter((d) => d.dishes).length;
  let i = sel === undefined ? Math.max(0, todayIndex(plan)) : Math.min(n - 1, Math.max(0, Number(sel) || 0));
  const day = plan.days[i], dp = plan.calc.dayPlans[i];
  const busy = doneCount < n && (generating || !plan.days.some((d) => d.error));

  $app.innerHTML = `
    <div class="card days-banner">
      <b>${n}日分</b><p style="font-weight:900">になりました</p>
      <p class="small" style="margin-top:4px">${esc(plan.people)} ・ 夕食</p>
      ${doneCount < n && busy ? `<div class="progress" id="gen"><span style="width:${Math.round((doneCount / n) * 100)}%"></span></div><p class="small">${doneCount} / ${n}日分 できました</p>` : ''}
    </div>
    <div class="daytabs" role="tablist">${plan.days.map((d, j) => `
      <button class="daytab ${d.done ? 'done' : ''}" role="tab" aria-selected="${j === i}" data-day="${j}">${j + 1}日目・${esc(genreOf(plan, j))}<small>${esc(dayLabel(plan, j))}</small></button>`).join('')}
    </div>
    <p class="genre-line"><span class="genre g-${esc(genreOf(plan, i))}">${esc(GENRE_LABEL[genreOf(plan, i)])}</span>の日</p>
    <p class="uses">この日に使う食材:</p>
    <div class="chips" style="margin:6px 0 12px">${[...dp.main, ...dp.veg].map((x) => `<span class="chip">${esc(x.name)} ${esc(x.amount)}</span>`).join('')}</div>
    ${day.dishes ? DISH_KEYS.map((k) => `
      <a class="card dish" href="#/dish/${i}/${k}">
        <span class="tag ${k}">${DISH_LABEL[k]}</span>
        <div class="grow"><div class="name">${esc(day.dishes[k].name)}</div>${day.dishes[k].minutes ? `<div class="small">約${day.dishes[k].minutes}分</div>` : ''}</div>
        <span class="chev">›</span>
      </a>`).join('') + avoidWarning(day.dishes) + `
      <div class="btns" style="grid-template-columns:1fr 1fr">
        <button class="btn ${day.done ? 'ghost' : 'primary'}" id="done">${day.done ? '✓ 作った' : '作った'}</button>
        <button class="btn" id="redo">🔄 別の献立に</button>
      </div>`
      : day.error ? `
      <div class="card"><p>この日の献立を作れませんでした。</p></div>
      <div class="btns"><button class="btn primary" id="retry">もう一度作る</button></div>`
      : `<div class="card" style="text-align:center"><div class="spinner"></div><p class="small">この日の献立を作っています…</p></div>`}

    ${plan.calc.vegShort ? `<h2>買い足すとよいもの</h2><div class="notice warn">野菜があと<b>約${plan.calc.vegShort}g</b>あると、毎日の副菜とつけ合わせに十分な量になります(1日の目安 ${plan.calc.vegNeedPerDay}g)。</div>` : ''}
    <h2>残りの食材</h2>
    ${plan.calc.leftovers.length || plan.calc.pantry.length ? `<div class="chips">${plan.calc.leftovers.map((x) => `<span class="chip">${esc(x.name)} ${esc(x.amount)}</span>`).join('')}${plan.calc.pantry.map((x) => `<span class="chip">${esc(x)}</span>`).join('')}</div>
      <p class="small" style="margin-top:8px">次の献立を作るときに「家にある食材」として追加してください。</p>` : '<p class="small">ありません。すべて使い切れます。</p>'}
    <div class="btns"><a class="btn ghost" href="#/confirm">食材を直して作り直す</a></div>`;

  $app.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => go(`#/menu/${b.dataset.day}`)));
  $app.querySelector('#done')?.addEventListener('click', () => {
    day.done = !day.done; save();
    if (day.done) toast('記録しました。おつかれさまでした！');
    renderMenu(String(i));
  });
  $app.querySelector('#redo')?.addEventListener('click', async () => {
    const old = DISH_KEYS.map((k) => day.dishes[k].name);
    day.dishes = null; save(); renderMenu(String(i));
    try { day.dishes = await makeDay(plan, i, old); } catch (e) { day.error = true; toast(errorText(e)); }
    save(); if (location.hash.startsWith('#/menu')) renderMenu(String(i));
  });
  $app.querySelector('#retry')?.addEventListener('click', () => { generateMissing(); renderMenu(String(i)); });
  const tab = $app.querySelector('.daytab[aria-selected=true]');
  if (tab) tab.parentElement.scrollLeft = tab.offsetLeft - tab.parentElement.clientWidth / 2 + tab.clientWidth / 2;
}

function avoidWarning(dishes) {
  const hits = Calc.findAvoided(dishes, state.settings.avoid);
  return hits.length ? `<div class="notice ng" style="margin-top:12px">⚠️ 登録した「${esc(hits.join('・'))}」が入っている可能性があります。「別の献立に」を押して作り直してください。</div>` : '';
}

// ---------- 料理の詳細 ----------
function renderDish(i, k) {
  const day = state.plan?.days[i];
  const dish = day?.dishes?.[k];
  if (!dish) return go('#/menu');
  $app.innerHTML = `
    <a class="back" href="#/menu/${i}">‹ ${i + 1}日目の献立</a>
    <span class="tag ${k}" style="display:inline-block;margin-top:6px">${DISH_LABEL[k]}</span>
    <h1>${esc(dish.name)}</h1>
    <p class="small" style="margin:0 2px">${dish.minutes ? `調理時間 約${dish.minutes}分 ・ ` : ''}${esc(state.plan.people)}分</p>
    <h2>材料</h2>
    <div class="card">${dish.ingredients.map((x) => `<div class="ing"><span>${esc(x.name)}</span><span>${esc(x.amount)}</span></div>`).join('') || '<p class="small">材料の情報がありません</p>'}</div>
    <h2>作り方</h2>
    <div class="card"><ol class="steps">${dish.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>
    ${avoidWarning(day.dishes)}
    ${state.settings.avoid.length ? '<p class="small" style="margin-top:12px">アレルギーのある方は、材料を必ずご自身でも確認してください。</p>' : ''}
    <div class="btns">
      <button class="btn ${day.done ? 'ghost' : 'primary'} big" id="done">${day.done ? '✓ 作った(記録済み)' : 'この日の献立を作った'}</button>
    </div>`;
  $app.querySelector('#done').addEventListener('click', () => {
    day.done = !day.done; save();
    if (day.done) toast('記録しました。おつかれさまでした！');
    renderDish(i, k);
  });
}

// ---------- 設定 ----------
function renderSettings() {
  const s = state.settings;
  const eq = Calc.adultEq(s);
  $app.innerHTML = `
    <h1>設定</h1>
    <h2>家族構成</h2>
    <div class="card">
      <div class="field"><span>大人の人数</span>
        <div class="stepper"><button data-adults="-1" aria-label="大人を減らす">−</button><output>${s.adults}</output><button data-adults="1" aria-label="大人を増やす">＋</button></div>
      </div>
      ${s.children.map((age, j) => `
      <div class="field"><span>子ども${s.children.length > 1 ? j + 1 : ''}の年齢 <span class="small">(係数${Calc.childFactor(age)})</span></span>
        <div class="stepper"><button data-age="${j}" data-d="-1" aria-label="年齢を下げる">−</button><output>${age}歳</output><button data-age="${j}" data-d="1" aria-label="年齢を上げる">＋</button>
        <button data-rm="${j}" aria-label="この子どもを削除" style="font-size:16px">🗑</button></div>
      </div>`).join('')}
      <div class="field"><button class="btn sm ghost" id="addchild">＋ 子どもを追加</button><span class="small">大人${eq}人分</span></div>
    </div>
    <p class="small" style="margin:8px 2px">子どもは年齢に応じて量を減らして計算します(1〜2歳 0.3、3〜5歳 0.5、6〜8歳 0.6、9〜11歳 0.8、12歳以上 1.0)。</p>

    <h2>苦手な食材・アレルギー</h2>
    <div class="card">
      <div class="field" style="display:block">
        <textarea id="avoid" placeholder="例: えび、かに、セロリ">${esc(s.avoid.join('、'))}</textarea>
        <p class="small" style="margin-top:6px">「、」で区切って入力。献立から外し、入っていたら警告を出します。</p>
      </div>
    </div>

    <h2>献立</h2>
    <div class="card">
      <div class="field"><span>対象の食事</span><b>夕食のみ</b></div>
      <div class="field"><span>献立の中身</span><b>主菜・副菜</b></div>
      <div class="field"><span>主食(ご飯など)・汁物</span><b>含めない</b></div>
      <div class="field"><span>ジャンル</span><b>和50%・洋25%・中25%</b></div>
      <div class="field"><span>最大の日数</span><b>${s.maxDays}日分</b></div>
    </div>

    <h2>データ</h2>
    <div class="card">
      <p class="small">記録はこのスマホの中だけに保存されています。</p>
      <button class="btn sm ghost" id="reset" style="margin-top:10px">献立と食材をすべて消す</button>
    </div>
    <p class="small" style="text-align:center;margin-top:28px">献立ヘルパー バージョン ${APP_VERSION}</p>`;

  const rerender = () => { save(); renderSettings(); };
  $app.querySelectorAll('[data-adults]').forEach((b) => b.addEventListener('click', () => {
    s.adults = Math.min(10, Math.max(1, s.adults + Number(b.dataset.adults))); rerender();
  }));
  $app.querySelectorAll('[data-age]').forEach((b) => b.addEventListener('click', () => {
    const j = Number(b.dataset.age); s.children[j] = Math.min(18, Math.max(1, s.children[j] + Number(b.dataset.d))); rerender();
  }));
  $app.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { s.children.splice(Number(b.dataset.rm), 1); rerender(); }));
  $app.querySelector('#addchild').addEventListener('click', () => { if (s.children.length < 8) s.children.push(6); rerender(); });
  // 1文字ごとに保存する(画面を切り替えたときに保存が間に合わないことがないように)
  const avoidBox = $app.querySelector('#avoid');
  avoidBox.addEventListener('input', () => {
    s.avoid = avoidBox.value.split(/[、,，\s]+/).map((w) => w.trim()).filter(Boolean).slice(0, 20);
    save();
  });
  avoidBox.addEventListener('change', () => toast('保存しました'));
  $app.querySelector('#reset').addEventListener('click', () => {
    if (!confirm('献立と食材をすべて消します。よろしいですか?(家族の設定は残ります)')) return;
    state.plan = null; state.draft = []; save(); toast('消しました'); go('#/');
  });
}

render();
if (state.plan && state.plan.days.some((d) => !d.dishes && !d.error)) generateMissing();
