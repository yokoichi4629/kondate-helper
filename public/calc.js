// 献立ヘルパー — 日数と量の計算(設計書 4章のルール)
// AIには任せず、ここで決まったルールどおりに計算する。
(function (root) {
  'use strict';

  // 子どもの年齢 → 係数(大人=1.0)
  function childFactor(age) {
    const a = Number(age);
    if (!(a >= 0)) return 0.6;
    if (a <= 2) return 0.3;
    if (a <= 5) return 0.5;
    if (a <= 8) return 0.6;
    if (a <= 11) return 0.8;
    return 1.0;
  }

  // 家族の人数を「大人何人分」に換算
  function adultEq(settings) {
    const adults = Math.max(0, Number(settings.adults) || 0);
    const kids = (settings.children || []).reduce((s, age) => s + childFactor(age), 0);
    return Math.round((adults + kids) * 10) / 10;
  }

  // 1食あたりの量の目安(大人1人分)。卵は個数、それ以外はグラム。野菜は副菜とつけ合わせの合計
  const STD = { meat: 100, fish: 100, egg: 2, tofu: 150, veg: 120 };
  const MAIN_CATS = ['meat', 'fish', 'egg', 'tofu'];

  const CAT_LABEL = { meat: '肉', fish: '魚', egg: '卵', tofu: '豆腐など', veg: '野菜', other: 'その他' };
  const UNITS = ['g', 'kg', '個', '本', '玉', 'パック', '丁', '袋', '切れ', '束', '株', '枚'];

  // 単位1つあたりの重さの初期値(AIが推測できなかったとき用)
  const DEFAULT_GPU = {
    meat: { パック: 250, 枚: 250, 切れ: 100 },
    fish: { パック: 200, 切れ: 80, 枚: 80, 本: 150 },
    egg: { 個: 1, パック: 10 },
    tofu: { 丁: 300, パック: 300, 個: 150, 枚: 150 },
    veg: { 個: 150, 本: 150, 玉: 300, パック: 150, 袋: 200, 束: 200, 株: 200, 枚: 50 },
  };

  // 食材の量を「基準の量」(卵は個数、それ以外はg)に直す
  function baseAmount(item) {
    const qty = Number(item.qty) || 0;
    if (item.category === 'egg') {
      if (item.unit === '個') return qty;
      if (item.unit === 'パック') return qty * (item.gpu && item.gpu < 30 ? item.gpu : 10);
      if (item.unit === 'g' || item.unit === 'kg') return Math.round((qty * (item.unit === 'kg' ? 1000 : 1)) / 60);
      return qty;
    }
    if (item.unit === 'g') return qty;
    if (item.unit === 'kg') return qty * 1000;
    const gpu = Number(item.gpu) || (DEFAULT_GPU[item.category] || {})[item.unit] || 100;
    return qty * gpu;
  }

  // 傷みやすさ(小さいほど先に使う)
  function freshRank(item) {
    const n = item.name || '';
    if (/冷凍/.test(n)) return 3;
    if (item.category === 'fish') return 1;
    if (item.category === 'meat') return /ひき|挽|ミンチ/.test(n) ? 1 : 2;
    if (item.category === 'tofu') return 2;
    if (item.category === 'egg') return 3;
    if (item.category === 'veg') {
      if (/もやし|ほうれん|レタス|小松菜|水菜|ニラ|にら|春菊|ベビーリーフ|豆苗|かいわれ|貝割|葉|青じそ|大葉|三つ葉/.test(n)) return 1;
      if (/きのこ|しめじ|えのき|舞茸|まいたけ|しいたけ|椎茸|エリンギ|マッシュルーム|トマト|きゅうり|ブロッコリー|なす|ナス|ピーマン|アスパラ|オクラ/.test(n)) return 2;
      return 3;
    }
    return 3;
  }

  function fmtAmount(cat, base) {
    if (cat === 'egg') return `${Math.max(1, Math.round(base))}個`;
    return `${Math.max(10, Math.round(base / 10) * 10)}g`;
  }

  // 計画を立てる:何日分になるか、毎日どの食材を使うか、足りない・余る食材
  function plan(items, settings) {
    const eq = adultEq(settings) || 1;
    const maxDays = Number(settings.maxDays) || 5;
    const order = (a, b) => a.rank - b.rank || a.idx - b.idx;

    const mains = [], vegs = [], others = [];
    items.forEach((it, idx) => {
      const base = baseAmount(it);
      const row = { idx, name: it.name, category: it.category, base, rank: freshRank(it) };
      if (MAIN_CATS.includes(it.category)) {
        if (base > 0) mains.push({ ...row, portions: base / (STD[it.category] * eq) });
      } else if (it.category === 'veg') {
        if (base > 0) vegs.push(row);
      } else {
        others.push(it.name);
      }
    });
    mains.sort(order);
    vegs.sort(order);

    const totalPortions = mains.reduce((s, m) => s + m.portions, 0);
    const possibleDays = Math.floor(totalPortions + 1e-6);
    const days = Math.min(possibleDays, maxDays);

    // 主菜:傷みやすい順に1日1食分ずつ割り当てる(1日に2種類を合わせることもある)
    const left = mains.map((m) => ({ ...m, remain: m.portions }));
    const dayPlans = [];
    for (let d = 0; d < days; d++) {
      let need = 1;
      const main = [];
      for (const m of left) {
        if (need <= 1e-6) break;
        if (m.remain <= 1e-6) continue;
        const take = Math.min(m.remain, need);
        m.remain -= take; need -= take;
        main.push({ name: m.name, category: m.category, base: take * STD[m.category] * eq });
      }
      dayPlans.push({ main, veg: [] });
    }

    // 野菜:1日の目安は 120g × 人数換算。全部を日数で割って、傷みやすい順に先の日へ
    const vegNeedPerDay = STD.veg * eq;
    const vegTotal = vegs.reduce((s, v) => s + v.base, 0);
    const vegShort = days ? Math.max(0, vegNeedPerDay * days - vegTotal) : 0;
    if (days) {
      const quota = vegTotal / days;
      const vleft = vegs.map((v) => ({ ...v, remain: v.base }));
      for (let d = 0; d < days; d++) {
        let need = d === days - 1 ? Infinity : quota;
        for (const v of vleft) {
          if (need <= 1) break;
          if (v.remain <= 1) continue;
          const take = Math.min(v.remain, need);
          v.remain -= take; need -= take;
          dayPlans[d].veg.push({ name: v.name, category: 'veg', base: take });
        }
      }
    }

    // 残りの食材(主菜の端数や、最大日数を超えた分)
    const leftovers = left.filter((m) => m.remain * STD[m.category] * eq >= (m.category === 'egg' ? 1 : 30))
      .map((m) => ({ name: m.name, amount: fmtAmount(m.category, m.remain * STD[m.category] * eq) }));
    if (!days) vegs.forEach((v) => leftovers.push({ name: v.name, amount: fmtAmount('veg', v.base) }));

    dayPlans.forEach((p) => {
      p.main = p.main.filter((x) => x.base >= (x.category === 'egg' ? 0.5 : 10)).map((x) => ({ name: x.name, amount: fmtAmount(x.category, x.base) }));
      p.veg = p.veg.filter((x) => x.base >= 10).map((x) => ({ name: x.name, amount: fmtAmount('veg', x.base) }));
    });

    return {
      eq,
      totalPortions: Math.round(totalPortions * 10) / 10,
      possibleDays,
      days,
      capped: possibleDays > maxDays,
      dayPlans,
      leftovers,
      pantry: others,
      vegNeedPerDay: Math.round(vegNeedPerDay),
      vegShort: vegShort >= 10 ? Math.round(vegShort / 10) * 10 : 0,
    };
  }

  // 日ごとのジャンル:和50%・洋25%・中25%。同じジャンルが続きにくい順番でくり返す
  // (5日分なら 和・洋・和・中・和)
  const GENRE_CYCLE = ['和', '洋', '和', '中'];
  const genreFor = (i) => GENRE_CYCLE[i % GENRE_CYCLE.length];

  // アレルギー・苦手な食材が料理に入っていないかを確かめる(AIだけに頼らない)
  function findAvoided(day, avoid) {
    const words = (avoid || []).map((w) => w.trim()).filter(Boolean);
    if (!words.length || !day) return [];
    const hits = new Set();
    for (const key of ['main', 'side']) {
      const dish = day[key];
      if (!dish) continue;
      const texts = [dish.name, ...dish.ingredients.map((x) => x.name)];
      for (const w of words) if (texts.some((t) => t.includes(w))) hits.add(w);
    }
    return [...hits];
  }

  const Calc = { childFactor, adultEq, baseAmount, freshRank, plan, findAvoided, genreFor, GENRE_CYCLE, STD, CAT_LABEL, UNITS, DEFAULT_GPU, MAIN_CATS };
  if (typeof module !== 'undefined' && module.exports) module.exports = Calc;
  else root.Calc = Calc;
})(typeof window !== 'undefined' ? window : globalThis);
