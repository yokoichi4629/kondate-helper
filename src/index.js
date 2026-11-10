// 献立ヘルパー — サーバー側(Cloudflare Workers)
// /api/scan : 食材やレシートの写真から、食材名・量・単位を読み取る
// /api/menu : 1日分の献立(主菜・副菜)と作り方を作る。ジャンル(和・洋・中)はアプリが決めて渡す
// 日数の計算はアプリ側(public/calc.js)で行い、AIには「読み取り」と「料理の中身」だけを任せる。
// 写真はどこにも保存しない(読み取りが終わったら捨てる)。

const MODEL = '@cf/google/gemma-4-26b-a4b-it';
const MAX_IMAGES = 4;
const MAX_IMAGE_CHARS = 2_000_000; // 1枚あたり(base64)。画面側で小さくしてから送る
const CATEGORIES = ['meat', 'fish', 'egg', 'tofu', 'veg', 'other'];
const UNITS = ['g', 'kg', '個', '本', '玉', 'パック', '丁', '袋', '切れ', '束', '株', '枚'];

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function sameOrigin(req, url) {
  const origin = req.headers.get('Origin');
  if (origin) { try { return new URL(origin).host === url.host; } catch { return false; } }
  return req.headers.get('Sec-Fetch-Site') === 'same-origin';
}

function extractText(res) {
  if (typeof res === 'string') return res;
  if (res?.response !== undefined) return typeof res.response === 'string' ? res.response : JSON.stringify(res.response);
  const c = res?.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => p?.text || '').join('');
  return '';
}

export function parseJson(raw) {
  const text = String(raw || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '').trim();
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

const str = (v, max = 80) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

// ---- 食材の読み取り ----
const SCAN_PROMPT = [
  'あなたは家庭の買い物を整理するアシスタントです。写真は、買ってきた食材、またはスーパーのレシートです。',
  '写っている食材をすべて日本語の一般的な名前で書き出してください(商品名ではなく「鶏もも肉」「にんじん」のように)。',
  '同じ食材が複数の写真に写っている場合は、二重に数えないでください。レシートと食材の写真がある場合は、レシートの数量を優先します。',
  'category は次のどれか: meat(肉), fish(魚介), egg(卵), tofu(豆腐・厚揚げ・納豆などの大豆製品), veg(野菜・きのこ・果物), other(調味料・パン・麺・飲み物など)。',
  `unit は次のどれか: ${UNITS.join(', ')}。パック入りの肉や魚は、ラベルのグラム数が読めれば g で書く。`,
  'grams_per_unit は、その単位1つあたりのおおよその重さ(g)。卵は1個=1として個数で数える(卵1パックなら qty:1, unit:"パック", grams_per_unit:10)。unit が g なら 1。',
  '量がわからない場合は、一般的な売り場の量で推測してください。',
  'JSONだけを出力してください。形式:',
  '{"items":[{"name":"鶏もも肉","category":"meat","qty":300,"unit":"g","grams_per_unit":1}]}',
].join('\n');

export function cleanItems(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 60).map((x) => {
    const name = str(x?.name, 30);
    if (!name) return null;
    const category = CATEGORIES.includes(x?.category) ? x.category : 'other';
    const unit = UNITS.includes(x?.unit) ? x.unit : 'g';
    const qty = num(x?.qty) || 1;
    const gpu = unit === 'g' ? 1 : unit === 'kg' ? 1000 : num(x?.grams_per_unit);
    return { name, category, qty: Math.round(qty * 10) / 10, unit, gpu: gpu ? Math.round(gpu) : 0 };
  }).filter(Boolean);
}

export async function scan(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const images = Array.isArray(body?.images) ? body.images : [];
  if (!images.length || images.length > MAX_IMAGES) return json({ error: 'bad_images' }, 400);
  for (const img of images) {
    if (typeof img !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(img) || img.length > MAX_IMAGE_CHARS) {
      return json({ error: 'bad_images' }, 400);
    }
  }
  const content = [{ type: 'text', text: SCAN_PROMPT }, ...images.map((url) => ({ type: 'image_url', image_url: { url } }))];
  const res = await env.AI.run(MODEL, {
    messages: [{ role: 'user', content }],
    max_tokens: 1500,
    temperature: 0.2,
    chat_template_kwargs: { enable_thinking: false },
  });
  const out = parseJson(extractText(res));
  return json({ items: cleanItems(out?.items) });
}

// ---- 1日分の献立 ----
const fmtList = (list) => (list.length ? list.map((x) => `${x.name} ${x.amount}`).join('、') : 'なし');

export const GENRES = {
  和: '和食(しょうゆ・みそ・だし・みりんなどを使った日本の家庭料理)',
  洋: '洋食(ソテー、グラタン、ハンバーグ、トマト煮、サラダなど)',
  中: '中華(炒め物、あんかけ、オイスターソース・ごま油・鶏ガラスープの素などを使った家庭の中華)',
};

export function buildMenuPrompt(b) {
  return [
    'あなたは家庭料理が得意な料理研究家です。日本の家庭の夕食1日分の献立(主菜1品と副菜1品)を作ってください。',
    `この日のジャンル: ${GENRES[b.genre]}。主菜も副菜もこのジャンルに合わせること。`,
    `食べる人: ${b.people}(大人${b.eq}人分の量)。主食(ご飯など)と汁物は献立に含めません。`,
    `主菜に使う食材(この量を全部使う。2種類あって片方が少ない場合は、少ない方を副菜に回してもよい): ${fmtList(b.main)}`,
    b.veg.length
      ? `副菜に使う野菜(この量をなるべく全部使う。多い場合は主菜のつけ合わせや具に使ってもよい): ${fmtList(b.veg)}`
      : '野菜はありません。副菜は、わかめ・のり・ごま・乾物など家によくある常備品を使った簡単なものにしてください。',
    b.pantry.length ? `家にあるもの(必要なら少し使ってよい): ${b.pantry.join('、')}` : '',
    '一般的な調味料(塩、こしょう、しょうゆ、みそ、砂糖、みりん、酒、酢、油、だし、片栗粉など)は自由に使ってよい。',
    b.avoid.length ? `次の食材は絶対に使わないこと(アレルギー・苦手): ${b.avoid.join('、')}` : '',
    b.previous.length ? `これまでの日の料理と似たものは避けること: ${b.previous.join('、')}` : '',
    '上に書いた食材以外の肉・魚・野菜は使わないこと。子どもも食べやすい味つけにし、主菜は30分以内で作れるものにする。',
    'ingredients の amount は家族全員分の量を書く(例: "300g", "大さじ1", "1/2個")。steps は短い文で3〜6個。',
    'JSONだけを出力してください。形式:',
    '{"main":{"name":"","minutes":20,"ingredients":[{"name":"","amount":""}],"steps":[""]},"side":{...同じ形}}',
  ].filter(Boolean).join('\n');
}

function cleanDish(d) {
  if (!d || typeof d !== 'object') return null;
  const name = str(d.name, 40);
  if (!name) return null;
  const ingredients = (Array.isArray(d.ingredients) ? d.ingredients : []).slice(0, 20)
    .map((x) => ({ name: str(x?.name, 30), amount: str(String(x?.amount ?? ''), 20) })).filter((x) => x.name);
  const steps = (Array.isArray(d.steps) ? d.steps : []).slice(0, 10).map((s) => str(s, 200)).filter(Boolean);
  const minutes = Math.min(180, Math.round(num(d.minutes))) || null;
  return { name, minutes, ingredients, steps };
}

export function cleanDay(o) {
  const main = cleanDish(o?.main), side = cleanDish(o?.side);
  return main && side ? { main, side } : null;
}

const cleanAmounts = (list) => (Array.isArray(list) ? list : []).slice(0, 15)
  .map((x) => ({ name: str(x?.name, 30), amount: str(String(x?.amount ?? ''), 20) })).filter((x) => x.name);
const cleanWords = (list, n) => (Array.isArray(list) ? list : []).slice(0, n).map((x) => str(x, 40)).filter(Boolean);

export async function menu(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const b = {
    people: str(body?.people, 60) || '家族',
    eq: Math.min(20, num(body?.eq)) || 2,
    genre: GENRES[body?.genre] ? body.genre : '和',
    main: cleanAmounts(body?.main),
    veg: cleanAmounts(body?.veg),
    pantry: cleanWords(body?.pantry, 20),
    avoid: cleanWords(body?.avoid, 20),
    previous: cleanWords(body?.previous, 20),
  };
  if (!b.main.length) return json({ error: 'no_main' }, 400);
  const res = await env.AI.run(MODEL, {
    messages: [{ role: 'user', content: buildMenuPrompt(b) }],
    max_tokens: 1800,
    temperature: 0.7,
    chat_template_kwargs: { enable_thinking: false },
  });
  const day = cleanDay(parseJson(extractText(res)));
  if (!day) return json({ error: 'empty' }, 502);
  return json(day);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!sameOrigin(req, url)) return json({ error: 'forbidden' }, 403);
    try {
      if (url.pathname === '/api/scan') return await scan(req, env);
      if (url.pathname === '/api/menu') return await menu(req, env);
      return json({ error: 'not_found' }, 404);
    } catch (e) {
      const msg = String(e?.message || e);
      const limited = /429|3036|4006|capacity|limit|neurons/i.test(msg);
      return json({ error: limited ? 'limit' : 'ai_error', detail: msg.slice(0, 200) }, limited ? 429 : 502);
    }
  },
};
