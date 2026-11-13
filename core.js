/* 核心逻辑：日期 / 排期 / 采购聚合 / 库存。浏览器与 node 共用。 */
(function (root) {
  const DATA = root.DATA;
  const DISH = {};
  DATA.dishes.forEach(d => { DISH[d.id] = d; });
  const ING = {};
  DATA.ingredients.forEach(i => { ING[i.key] = i; });

  /* ---------- 菜谱里"可变"的三种情况 ----------
     1) 可选加（x.opt）：加了更像饭馆版，不加也行 → 不进采购，库里有就顺手用掉
     2) 二选一（d.alts）：菜谱里写"（或…）"的地方，白菜 or 包菜 → 只买一个，优先家里有的
     3) 随便放（FLEX）：什锦炒饭/炒面这类打扫冰箱的 → 蔬菜不硬买，排期优先清冰箱
     二选一是按菜登记的：牛肉和猪肉只在麻婆豆腐里能互换，不能全局通用。 */
  const DISH_ALTS = {
    '蒜薹炒肉': { pork_belly: ['pork_shoulder'], pork_shoulder: ['pork_belly'] },
    '麻婆豆腐': { beef: ['pork_belly'], pork_belly: ['beef'] },
    '咖喱鸡': { chicken_breast: ['chicken_leg'], chicken_leg: ['chicken_breast'] },
    '鸡丝凉面': { chicken_breast: ['chicken_leg'], chicken_leg: ['chicken_breast'] },
    '干蒸排骨': { scallion: ['spring_onion'], spring_onion: ['scallion'] },
    '菜丝炒面': { garden_cabbage: ['cabbage'], cabbage: ['garden_cabbage'] }
  };
  const FLEX_NAMES = ['什锦炒饭', '什锦炒面'];
  DATA.dishes.forEach(d => {
    if (DISH_ALTS[d.name]) d.alts = DISH_ALTS[d.name];
    if (FLEX_NAMES.indexOf(d.name) >= 0) d.flex = true;
  });
  (DATA.suggest || []).forEach(d => {
    if (DISH_ALTS[d.name]) d.alts = DISH_ALTS[d.name];
    if (FLEX_NAMES.indexOf(d.name) >= 0) d.flex = true;
  });
  const isFlex = d => !!(d && d.flex);
  const altsOf = (d, key) => (d && d.alts && d.alts[key]) || null;
  /* 二选一：优先拿家里有的 / 这天别的菜也要用的，都没有就用原配 */
  function pickKey(state, d, key, date, also) {
    const alts = altsOf(d, key);
    if (!alts) return key;
    const cands = [key].concat(alts);
    for (const k of cands) if (invQty(state, k, date) > 0) return k;
    if (also) for (const k of cands) if (also[k]) return k;
    return key;
  }

  const DAY = 864e5;
  const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  const dt = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const iso = d => d.toISOString().slice(0, 10);
  const addD = (s, n) => iso(new Date(dt(s).getTime() + n * DAY));
  const dow = s => dt(s).getUTCDay();
  const dspan = (a, b) => Math.round((dt(b) - dt(a)) / DAY);
  const md = s => s.slice(5).replace('-', '.');
  const weekDays = ws => [0, 1, 2, 3, 4, 5, 6].map(i => addD(ws, i));
  function mondayOf(s) {
    const w = dow(s);
    return addD(s, w === 0 ? -6 : 1 - w);
  }
  const money = n => '¥' + (Math.round(n * 100) / 100).toFixed(2);
  const yuan = money;
  const todayStr = () => { const d = new Date(); return iso(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))); };

  /* ---------- 菜品特征 ---------- */
  const PROTEIN = {
    pork_belly: '猪', pork_shoulder: '猪', pork_ribs: '猪', pork_fat: '猪',
    beef: '牛', beef_rib: '牛', chicken_breast: '鸡', chicken_leg: '鸡',
    shrimp: '虾', shrimp_meat: '虾', egg: '蛋',
    tofu_soft: '豆', tofu_firm: '豆', tofu_dry: '豆'
  };
  const FROZEN_CATS = ['肉禽蛋', '水产'];
  /* 家里有同类别的肉就能顶：牛肉末这种"顺手切一点"的，用牛肋条/牛腩顶上完全没问题，
     不然会为了 50g 肉末去买一整包牛里脊。只收窄到"同一个大类、能切能剁"的配对。 */
  const SUBST = {
    beef: ['beef_rib'],
    beef_rib: ['beef']
  };

  function mainProtein(d) {
    let best = null, g = -1;
    d.ing.forEach(x => {
      if (x.opt) return;
      const p = PROTEIN[x.key];
      if (p && x.g > g) { g = x.g; best = p; }
    });
    return best || '素';
  }
  /* 这道菜"必须当天吃完"的最短保质期（可冷冻的肉按 30 天算） */
  function shelfOf(d) {
    let m = 99;
    d.ing.forEach(x => {
      if (x.opt) return;
      const it = ING[x.key];
      if (!it) return;
      let s = it.shelf;
      if (it.freeze > 0 && FROZEN_CATS.includes(it.cat)) s = Math.min(it.freeze, 30);
      if (x.key === 'rice_cooked' || x.key === 'brown_rice_cooked') s = 1;
      m = Math.min(m, s);
    });
    return m;
  }
  const hasLeafy = d => d.ing.some(x => {
    const it = ING[x.key];
    return it && !it.pantry && it.cat === '蔬菜' && it.shelf <= 5 && it.freeze < 0;
  });

  function costShare(d, key) {
    const it = ING[key]; if (!it || !it.sku || !it.sku.specG) return 0;
    return it.sku.price * (d.ing.find(x => x.key === key) || { g: 0 }).g / it.sku.specG;
  }
  function dishCost(d, scale) {
    let c = 0;
    d.ing.forEach(x => { if (!x.opt) c += costShare(d, x.key); });
    return c * (scale || 1);
  }

  /* ---------- 采购批次 ---------- */
  /* 周日单（周日晚到，覆盖 周一/周二 + 当天晚饭）；周三单 17:30 到，覆盖 周三–周六；
     周日晚上那顿由"下一个周日单"当天送到，所以周日永远吃新鲜的。 */
  function batchesOf(ws) {
    return [
      { b: 0, name: '周日单', order: addD(ws, -1), deliver: addD(ws, -1), note: '周日下午下单 · 即时送达' },
      { b: 1, name: '周三单', order: addD(ws, 2), deliver: addD(ws, 2), note: '周三 17:30–18:00 送达' },
      { b: 2, name: '周日单(下周)', order: addD(ws, 6), deliver: addD(ws, 6), note: '周日当天到 · 只覆盖周日晚饭' }
    ];
  }
  function batchIndexOf(ws, date) {
    const bs = batchesOf(ws);
    let idx = 0;
    bs.forEach(x => { if (x.deliver <= date) idx = x.b; });
    return idx;
  }

  /* ---------- 排期 ---------- */
  function usedRecently(state, ws, back) {
    const set = new Set();
    const from = addD(ws, -(back || 14)), to = addD(ws, 13);
    Object.keys(state.plans || {}).forEach(k => {
      (state.plans[k].days || []).forEach(m => {
        if (m.date >= from && m.date <= to) (m.dishes || []).forEach(id => set.add(id));
      });
    });
    return set;
  }

  /* ---------- 主食 ---------- */
  /* 1 碗＝标准家庭饭碗的熟饭 ≈ 150g 熟饭。
     生米→熟饭的吸水率：白米加水约 1.5 倍（100g 生米 ≈ 250–300g 熟饭，
     按《中国食物成分表》米饭 116 kcal/100g、大米 346 kcal/100g 反推 ≈ 300g）；
     糙米吸水更多（1.6–1.7 倍水，糙米饭约 111 kcal/100g → 100g 生米 ≈ 310g 熟饭）。
     所以同样一碗 150g 熟饭：白米约 50g 生米，糙米约 48g 生米。 */
  const STAPLE = {
    brown: { key: 'brown_rice', name: '糙米饭', rawPerBowl: 48 },
    white: { key: 'rice', name: '米饭', rawPerBowl: 50 }
  };
  function stapleOf(state, meal) {
    let id = meal && meal.staple;
    if (!STAPLE[id]) id = state && state.settings && state.settings.staple;
    if (!STAPLE[id]) id = 'brown';
    const s = STAPLE[id];
    const it = ING[s.key] || ING.rice || {};
    return {
      id, key: s.key, name: s.name, rawPerBowl: s.rawPerBowl,
      kcalPerBowl: Math.round((it.kcal || 346) * s.rawPerBowl / 100)
    };
  }
  /* 没设置「这顿几个人吃」时按几份算（默认 1 人，周末可以单独调） */
  function eatDefault(state) {
    return Math.max(1, (state && state.settings && state.settings.eatersDefault) || 1);
  }
  /* 这天谁来吃：先看按日期定好的人，再看默认人数 */
  function eaterIdsFor(state, date) {
    const byDate = (state && state.eatersByDate) || {};
    const ids = byDate[date];
    if (ids && ids.length) return ids.slice();
    const profs = (state && state.profiles) || [];
    return profs.slice(0, eatDefault(state)).map(p => p.id);
  }
  /* 这几个人加起来吃几"份"（饭量 1.3 的人算 1.3 份） */
  function portionOf(state, ids) {
    const profs = (state && state.profiles) || [];
    if (!ids || !ids.length) return eatDefault(state);
    let s = 0;
    ids.forEach(id => { const p = profs.find(x => x.id === id); s += (p && p.portion) || 1; });
    return s > 0 ? Math.round(s * 10) / 10 : ids.length;
  }
  function mealEaters(state, m) {
    if (m && m.eaters && m.eaters.length) return m.eaters;
    return eaterIdsFor(state, m && m.date);
  }
  /* 一顿饭的总份数：菜量和米量都按它放大 */
  function mealScale(state, m) { return portionOf(state, mealEaters(state, m)); }
  /* 每道菜做几份：两个人吃两道菜，是"两人份分两道"，不是"每道都做两份" */
  function dishScale(state, m) {
    const n = Math.max(1, ((m && m.dishes) || []).length);
    return Math.round((mealScale(state, m) / n) * 10) / 10;
  }
  /* 一顿饭的总热量：菜（可能两道）+ 主食，乘以份数；外食不算热量 */
  function mealKcal(state, m) {
    if (!m || m.status === 'out') return 0;
    const kc = (m.dishes || []).reduce((a, id) => a + ((DISH[id] || {}).kcal || 0), 0);
    const riceK = m.rice ? stapleOf(state, m).kcalPerBowl * m.rice : 0;
    return Math.round(kc * dishScale(state, m) + riceK * mealScale(state, m));
  }

  /* 这道菜的主食是面还是米饭：决定这天算"面日"还是"米饭日" */
  const NOODLE_KEYS = ['noodle', 'flour', 'dough'];
  function stapleKind(d) {
    const ks = ((d && d.ing) || []).map(x => x.key);
    if (ks.some(k => NOODLE_KEYS.indexOf(k) >= 0)) return 'noodle';
    if (ks.indexOf('rice_cooked') >= 0 || ks.indexOf('brown_rice_cooked') >= 0) return 'rice_dish';
    return 'plain';
  }
  /* 一周主食怎么穿插：2–3 天吃面，不连吃三天面，米饭也不连排三天以上；
     meatIdx 里的日子已经被荤菜占了，不会排面 */
  function stapleWeek(meatIdx, want) {
    const busy = meatIdx || [];
    const n = want || (Math.random() < 0.45 ? 3 : 2);
    for (let t = 0; t < 200; t++) {
      const free = [0, 1, 2, 3, 4, 5, 6].filter(i => busy.indexOf(i) < 0);
      if (free.length < n) break;
      const idx = shuffle(free.slice()).slice(0, n).sort((a, b) => a - b);
      let ok = true;
      for (let i = 2; i < idx.length; i++) if (idx[i] - idx[i - 2] === 2) ok = false;
      const runs = []; let run = 0;
      for (let i = 0; i < 7; i++) {
        if (idx.indexOf(i) >= 0) { runs.push(run); run = 0; } else run++;
      }
      runs.push(run);
      if (Math.max.apply(null, runs) > 3) ok = false;
      if (!ok) continue;
      const s = new Array(7).fill('rice');
      idx.forEach(i => { s[i] = 'noodle'; });
      return s;
    }
    const s = new Array(7).fill('rice');
    if (busy.indexOf(2) < 0) s[2] = 'noodle';
    if (busy.indexOf(5) < 0) s[5] = 'noodle';
    return s;
  }

  /* 荤菜放在哪几天：只放工作日，两天不挨着 */
  function meatDays(nMeat) {
    const n = Math.max(0, Math.min(5, nMeat | 0));
    if (!n) return [];
    for (let t = 0; t < 120; t++) {
      const pick = shuffle([0, 1, 2, 3, 4]).slice(0, n).sort((a, b) => a - b);
      if (pick.every((p, i) => i === 0 || p - pick[i - 1] >= 2)) return pick;
    }
    return [0, 2, 4].slice(0, n);
  }

  function constraints(state) {
    const s = state.settings || {};
    const stId = STAPLE[s.staple] ? s.staple : 'brown';
    const rawPer = STAPLE[stId].rawPerBowl;
    const grams = s.riceGrams == null ? 130 : s.riceGrams;
    return {
      weekdayMax: s.weekdayMax || 40,
      weekendMax: s.weekendMax || 120,
      spicyNights: s.spicyNights == null ? 3 : s.spicyNights,
      riceGrams: grams,
      riceDefault: Math.round(grams / rawPer * 10) / 10,
      meatPerWeek: s.meatPerWeek == null ? 3 : s.meatPerWeek,
      staple: stId
    };
  }

  const CAP = { 猪: 2, 牛: 1, 鸡: 1, 虾: 1, 蛋: 2, 豆: 2, 素: 9 };

  /* 一周的"菜品结构"：先把面日定下来（那天必须一锅出），再在剩下的米饭日里排荤菜。
     荤菜只放工作日、且两天不挨着；周末留给简单的。 */
  function templateFor(nMeat, staples, meatIdx) {
    const n = Math.max(1, Math.min(5, nMeat | 0));
    const slots = new Array(7).fill('veg');
    staples.forEach((s, i) => { if (s === 'noodle') slots[i] = 'onepot'; });

    const cands = [0, 1, 2, 3, 4].filter(i => slots[i] === 'veg');   // 荤菜只排工作日、且不是面日
    let pos = (meatIdx || []).filter(i => slots[i] === 'veg').slice(0, n);
    if (!pos.length) {
      for (let t = 0; t < 80; t++) {
        const pick = shuffle(cands.slice()).slice(0, n).sort((a, b) => a - b);
        if (pick.length === n && pick.every((p, i) => i === 0 || p - pick[i - 1] >= 2)) { pos = pick; break; }
      }
    }
    if (!pos.length) pos = cands.filter((x, i) => i % 2 === 0).slice(0, n);
    pos.forEach(i => { slots[i] = 'meat'; });

    const freeOf = () => [0, 1, 2, 3, 4, 5, 6].filter(x => slots[x] === 'veg');
    const pickFrom = arr => arr.length ? arr.splice(Math.floor(Math.random() * arr.length), 1)[0] : -1;
    let i = pickFrom(freeOf().filter(x => x < 5));           // 半荤优先放工作日
    if (i < 0) i = pickFrom(freeOf());
    if (i >= 0) slots[i] = 'half';
    return slots;
  }
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  /* 清冰箱：这道菜能把库存里（尤其是快过期的）东西用掉，就加分 */
  function fridgeScore(state, d, onDate) {
    if (!state || !state.inventory || !state.inventory.length) return 0;
    let v = 0;
    (d.ing || []).forEach(x => {
      const k = pickKey(state, d, x.key, onDate, null);
      const have = invQty(state, k, onDate);
      if (have <= 0) return;
      /* 可选加的食材：家里有就顺手用了，加一点点分 */
      if (x.opt) { v += Math.min(1, have / Math.max(1, x.g)); return; }
      v += Math.min(2, have / Math.max(1, x.g));      // 够用越多越该做
      const days = invDays(state, k, onDate);
      if (days !== null && days <= 3) v += 2.5;       // 三天内要坏的，优先
      else if (days !== null && days <= 6) v += 1;
    });
    /* 打扫冰箱的菜：冰箱里临期的蔬菜越多，越该排它 */
    if (isFlex(d)) {
      const near = (state.inventory || []).filter(it => {
        const meta = ING[it.key];
        return meta && meta.cat === '蔬菜' && it.g > 20;
      }).map(it => invDays(state, it.key, onDate)).filter(n => n !== null);
      const urgent = near.filter(n => n <= 4).length;
      const soon = near.filter(n => n > 4 && n <= 8).length;
      v += Math.min(6, urgent * 3 + soon * 1.2);
    }
    return v;
  }

  function generate(ws, state) {
    const cfg = constraints(state);
    const days = weekDays(ws);
    const used = usedRecently(state, ws, 14);
    const bs = batchesOf(ws);
    const pool = DATA.dishes;
    const arch = new Set((state && state.archived) || []);
    const wantN = Math.random() < 0.45 ? 3 : 2;         // 这周吃 2 顿面还是 3 顿面，一次定死
    let best = null, bestScore = -1e9;

    /* 两个人吃的时候配的第二道菜：和主菜互补、不重样、不和主菜一样的主料 */
    const pickSecond = (date, main, taken, usedSet, archSet, age, limit) => {
      const wantKinds = main.kind === 'meat' ? ['veg', 'half']
        : main.kind === 'veg' ? ['half', 'meat', 'veg']
          : ['veg', 'half'];
      const mp = mainProtein(main);
      const okP = d => !taken.has(d.id) && !usedSet.has(d.id) && !archSet.has(d.id)
        && d.min <= Math.max(20, limit - main.min + 15)
        && shelfOf(d) >= age + 1
        && wantKinds.indexOf(d.kind) >= 0
        && stapleKind(d) === 'plain'                 // 别在主食上打架（面/饭/盖饭不算配菜）
        && mainProtein(d) !== mp;
      const list = pool.filter(okP);
      if (!list.length) return null;
      let pick2 = null, bs2 = -1e9;
      list.forEach(c => {
        let v = Math.random() * 2;
        if (c.min <= 15) v += 3; else if (c.min <= 25) v += 1;
        if (c.spice >= 2) v += 3;
        if (hasLeafy(c)) v += 2;
        v += fridgeScore(state, c, date);
        if (v > bs2) { bs2 = v; pick2 = c; }
      });
      return pick2;
    };

    for (let attempt = 0; attempt < 180; attempt++) {
      const md = meatDays(cfg.meatPerWeek);            // 荤菜占哪几天
      const sp = stapleWeek(md, wantN);                 // 这周哪几天吃面（不会和荤菜撞）
      const tpl = templateFor(cfg.meatPerWeek, sp, md);
      const picked = [];
      const chosen = new Set();
      const proteinCount = {};
      let score = 0, ok = true, meatMiss = 0;

      for (let i = 0; i < 7; i++) {
        const date = days[i];
        const w = dow(date);
        const weekend = (w === 0 || w === 6);
        const limit = weekend ? cfg.weekendMax : cfg.weekdayMax;
        const age = dspan(bs[batchIndexOf(ws, date)].deliver, date);
        const prev = i > 0 ? picked[i - 1] : null;
        const prevProt = prev ? prev.protein : null;
        const prevKind = prev ? prev.kind : null;
        const prevMin = prev ? prev.min : 0;
        const wantKind = tpl[i];
        const wantStaple = sp[i];

        const base = d => {
          if (arch.has(d.id)) return false;                                 // 移进备选库的不再自动排
          if (chosen.has(d.id) || used.has(d.id)) return false;
          if (d.min > limit) return false;
          if (shelfOf(d) < age + 1) return false;
          const p = mainProtein(d);
          if (p === prevProt && p !== '素') return false;
          if ((proteinCount[p] || 0) >= (CAP[p] || 2)) return false;
          if (d.kind === 'meat' && prevKind === 'meat') return false;   // 不连着两天吃肉
          if (prevMin >= 45 && d.min >= 45) return false;               // 不连着两天做硬菜
          return true;
        };
        /* 面日只吃面；米饭日不吃面（盖饭/炒饭自带米饭，算米饭日） */
        const okStaple = d => wantStaple === 'noodle'
          ? stapleKind(d) === 'noodle'
          : stapleKind(d) !== 'noodle';
        const okKind = d => wantStaple === 'noodle'
          ? d.kind === 'onepot'
          : (d.kind === wantKind || (d.kind === 'onepot' && stapleKind(d) === 'rice_dish'));
        let cands = pool.filter(d => okKind(d) && okStaple(d) && base(d));
        if (!cands.length) {
          /* 这类菜今天一个都排不进去（保质期/撞菜/上限），退一步：优先补还没排满的类别 */
          const quota = {}, used2 = {};
          tpl.forEach(k => { quota[k] = (quota[k] || 0) + 1; });
          picked.forEach(m => { used2[m.kind] = (used2[m.kind] || 0) + 1; });
          cands = pool.filter(d => okStaple(d) && base(d) && (used2[d.kind] || 0) < (quota[d.kind] || 0));
        }
        if (!cands.length) cands = pool.filter(d => okStaple(d) && base(d));
        /* 最后兜底：撞菜/上限/相邻这些都让步，只保证"放得住、来得及、是这类主食"，
           否则极端情况（比如备选库里移走了很多菜）会整周排空 */
        if (!cands.length) cands = pool.filter(d => !arch.has(d.id) && !chosen.has(d.id) &&
          d.min <= limit && shelfOf(d) >= age + 1 && okStaple(d));
        /* 真到这一步只放宽"难度/保质期/14 天内吃过"，绝不重复本周已经排过的菜 */
        if (!cands.length) cands = pool.filter(d => !arch.has(d.id) && !chosen.has(d.id) && okStaple(d));
        if (!cands.length) { ok = false; break; }

        let pick = cands[Math.floor(Math.random() * cands.length)], sc = 0, bestLocal = -1e9;
        for (let k = 0; k < Math.min(cands.length * 2, 48); k++) {
          const c = cands[Math.floor(Math.random() * cands.length)];
          let v = Math.random() * 2;
          if (weekend) {
            /* 周末倾向于简单：快、素、一锅出 */
            if (c.min <= 20) v += 5; else if (c.min <= 30) v += 3;
            else if (c.min <= 40) v += 1; else v -= 4;
            if (c.kind === 'onepot') v += 4;
            if (c.kind === 'veg') v += 3;
            if (c.kind === 'meat') v -= 4;
            if (hasLeafy(c)) v += 2;
          } else {
            if (c.min <= 30) v += 2;
            if (c.kind === 'meat') v += 2;
            if (c.min >= 60) v -= 2;
          }
          if (c.spice >= 2) v += 4;
          if (c.kind === 'onepot') v += 1;
          if (hasLeafy(c) && age <= 1) v += 4;
          if (age >= 3 && shelfOf(c) <= 5) v -= 20;
          v += fridgeScore(state, c, date);   // 冰箱里快坏的先吃掉
          if (v > bestLocal) { bestLocal = v; pick = c; sc = v; }
        }
        if (wantKind === 'meat' && pick.kind !== 'meat') meatMiss++;   // 荤菜位被别的菜顶了，扣分
        score += sc;
        const p = mainProtein(pick);
        proteinCount[p] = (proteinCount[p] || 0) + 1;
        chosen.add(pick.id);
        const sk = stapleKind(pick);
        const meal = {
          date, dishes: [pick.id], protein: p, kind: pick.kind, min: pick.min,
          status: 'cook', locked: false, staple: cfg.staple,
          rice: (sk === 'noodle' || sk === 'rice_dish') ? 0 : cfg.riceDefault, age
        };
        const eIds = eaterIdsFor(state, date);
        const eScale = portionOf(state, eIds);
        if (eIds.length) meal.eaters = eIds.slice();
        /* 两个人吃就别只做一道菜：加一道互补的（荤配素、素配半荤或荤） */
        if (eScale >= 1.8) {
          const second = pickSecond(date, pick, chosen, used, arch, age, limit);
          if (second) {
            meal.dishes.push(second.id);
            chosen.add(second.id);
            if (second.min > meal.min) meal.min = second.min;
          }
        }
        picked.push(meal);
      }
      if (ok && score - 50 * meatMiss > bestScore) { bestScore = score - 50 * meatMiss; best = picked; }
    }

    if (!best) {
      best = days.map(date => ({ date, dishes: [], protein: '素', status: 'empty', locked: false, rice: 0, age: 0 }));
    }
    return { weekStart: ws, created: todayStr(), days: best };
  }

  /* ---------- 库存 ---------- */
  function invQty(state, key, onDate) {
    let g = 0;
    (state.inventory || []).forEach(it => {
      if (it.key !== key) return;
      if (onDate && it.exp && it.exp < onDate) return;
      g += it.g;
    });
    return g;
  }
  /* 这一顿要用的东西是不是全在库存里（用来判断"到货第 N 天"还有没有意义） */
  function mealInStock(state, m) {
    if (!m || !m.dishes || !m.dishes.length) return false;
    if (m.status && m.status !== 'cook') return false;   // 外食/清空的天不谈库存
    const scale = dishScale(state, m);
    const onDate = m.date || todayStr();
    let any = false;
    for (const id of m.dishes) {
      const d = DISH[id]; if (!d) continue;
      for (const x of d.ing) {
        if (x.key === 'rice_cooked' || x.key === 'brown_rice_cooked' || x.key === 'water' || x.opt) continue;
        const it = ING[x.key];
        if (!it || it.pantry) continue;
        if (isFlex(d) && it.cat === '蔬菜') continue;   // 这种菜的蔬菜家里有什么放什么，不算缺
        any = true;
        const k2 = pickKey(state, d, x.key, onDate, null);
        if (invQty(state, k2, onDate) < x.g * scale) return false;
      }
    }
    if (m.rice) {
      const st = stapleOf(state, m);
      any = true;
      if (invQty(state, st.key, onDate) < m.rice * st.rawPerBowl * mealScale(state, m)) return false;
    }
    return any;
  }

  /* 这项食材最早哪天到期（当天起算还剩几天），没有记录返回 null */
  function invDays(state, key, onDate) {    const d0 = onDate || todayStr();
    let best = null;
    (state.inventory || []).forEach(it => {
      if (it.key !== key || !it.exp || it.exp < d0) return;
      const n = dspan(d0, it.exp);
      if (best === null || n < best) best = n;
    });
    return best;
  }
  /* 买了东西：进库存。肉类按冷冻天数放，别的按保质期 */
  function addInv(state, key, grams) {
    if (!(grams > 0)) return null;
    const it = ING[key] || {};
    const days = it.freeze > 0 && FROZEN_CATS.indexOf(it.cat) >= 0
      ? Math.min(it.freeze, 60) : Math.max(1, it.shelf || 7);
    const exp = addD(todayStr(), days);
    state.inventory = state.inventory || [];
    const same = state.inventory.find(x => x.key === key && x.exp === exp);
    if (same) same.g = Math.round((same.g + grams) * 10) / 10;
    else state.inventory.push({ id: 'i' + Math.random().toString(36).slice(2, 9), key, g: Math.round(grams * 10) / 10, exp });
    return exp;
  }
  /* 做了一顿饭：按这顿的用量从库存里扣，先扣快过期的；不够就扣到 0 并记缺口 */
  function consumeInv(state, needs) {
    const used = {}, short = {};
    Object.keys(needs || {}).forEach(key => {
      let need = needs[key];
      const items = (state.inventory || []).filter(x => x.key === key)
        .sort((a, b) => (a.exp || '9999-99-99').localeCompare(b.exp || '9999-99-99'));
      items.forEach(it => {
        if (need <= 0) return;
        const take = Math.min(it.g, need);
        it.g = Math.round((it.g - take) * 10) / 10;
        need -= take;
        used[key] = Math.round(((used[key] || 0) + take) * 10) / 10;
      });
      if (need > 0.5) short[key] = Math.round(need);
    });
    state.inventory = (state.inventory || []).filter(x => x.g > 0.5);
    return { used, short };
  }
  /* 一顿饭要用多少东西（不含调料和"要用米饭"这种中间品） */
  function mealNeeds(state, meal) {
    const out = {};
    if (!meal) return out;
    if (meal.status && meal.status !== 'cook') return out;   // 外食不用扣库存
    const scale = dishScale(state, meal);
    (meal.dishes || []).forEach(id => {
      const d = DISH[id]; if (!d) return;
      (d.ing || []).forEach(x => {
        if (x.key === 'rice_cooked' || x.key === 'brown_rice_cooked' || x.key === 'water' || x.opt) return;
        const it0 = ING[x.key] || {};
        if (isFlex(d) && it0.cat === '蔬菜') return;    // 打扫冰箱的菜，蔬菜用了什么说不准
        const k2 = pickKey(state, d, x.key, meal.date || todayStr(), out);
        out[k2] = (out[k2] || 0) + x.g * scale;
      });
    });
    if (meal.rice) {
      const st = stapleOf(state, meal);
      out[st.key] = (out[st.key] || 0) + meal.rice * st.rawPerBowl * mealScale(state, meal);
    }
    return out;
  }

  /* ---------- 采购清单 ---------- */
  /* 实付校准：用户下单后回填实际付款，之后所有预估按这个系数缩放 */
  function priceFactor(state) {
    const f = state && state.priceFactor;
    return typeof f === 'number' && f > 0.3 && f < 1.5 ? f : 1;
  }
  function skuOf(key, state) {
    const it = ING[key];
    if (!it || !it.sku) return null;
    const ov = (state.skuOverride || {})[key];
    const base = ov && ov.price ? { ...it.sku, price: ov.price, spec: ov.spec || it.sku.spec, specG: ov.specG || it.sku.specG } : it.sku;
    const F = priceFactor(state);
    return F === 1 ? base : { ...base, price: Math.round(base.price * F * 100) / 100 };
  }
  /* 剩余的包内食材能否留到下一单：能冷冻的按 30 天，否则按保质期 */
  function keepDays(key) {
    const it = ING[key]; if (!it) return 0;
    if (it.freeze > 0 && FROZEN_CATS.includes(it.cat)) return Math.min(it.freeze, 30);
    return it.shelf;
  }

  /* ---------- 采购波次：从菜单和保质期里长出来 ---------- */
  /* 一天要用到的食材（不含可选项、水、做好的饭），返回 key 集合 */
  function dayKeys(state, date) {
    const pl = (state.plans || {})[mondayOf(date)];
    const m = pl && (pl.days || []).find(x => x.date === date);
    if (!m || m.status !== 'cook' || !m.dishes || !m.dishes.length) return [];
    const set = new Set();
    const also = {};
    m.dishes.forEach(id => {
      const d = DISH[id]; if (!d) return;
      d.ing.forEach(x => {
        if (x.key === 'rice_cooked' || x.key === 'brown_rice_cooked' || x.key === 'water' || x.opt) return;
        const it = ING[x.key];
        if (!it || it.pantry) return;
        /* 打扫冰箱的菜，蔬菜部分不硬买 */
        if (isFlex(d) && it.cat === '蔬菜') return;
        const k = pickKey(state, d, x.key, date, also);
        set.add(k);
        also[k] = 1;
      });
    });
    return [...set];
  }

  /* 把未来的饭按"这一单能送到哪天还不坏"切成若干单 */
  function wavesOf(state, from, horizon) {
    const days = [];
    for (let i = 0; i < (horizon || 21); i++) {
      const d = addD(from, i);
      if (dayKeys(state, d).length) days.push(d);
    }
    const waves = [];
    let i = 0;
    while (i < days.length) {
      const start = days[i];
      let end = i;
      while (end + 1 < days.length) {
        const nd = days[end + 1];
        if (dspan(start, nd) >= 7) break;                        // 一单最多覆盖一周
        const ok = dayKeys(state, nd).every(k => dspan(start, nd) <= Math.max(1, keepDays(k) - 1));
        if (!ok) break;
        end++;
      }
      waves.push({ deliver: start, days: days.slice(i, end + 1) });
      i = end + 1;
    }
    /* 小单合并：只有一两样、而且都放得住，就并到前一单，省一趟 */
    for (let k = waves.length - 1; k > 0; k--) {
      const w = waves[k], prev = waves[k - 1];
      const keys = new Set();
      w.days.forEach(d => dayKeys(state, d).forEach(x => keys.add(x)));
      const last = w.days[w.days.length - 1];
      const ok = keys.size > 0 && keys.size <= 2 && dspan(prev.deliver, last) <= 6 &&
        [...keys].every(x => keepDays(x) >= 5 && dspan(prev.deliver, last) <= keepDays(x) - 1);
      if (ok) { prev.days = prev.days.concat(w.days); waves.splice(k, 1); }
    }
    /* 想省事：一周只买一次 —— 按自然周合并（放不住的食材交给"这顿做了/换一道"去处理） */
    if (state && state.settings && state.settings.shopMode === 'week') {
      const byWeek = new Map();
      waves.forEach(w => {
        const k = mondayOf(w.days[0]);
        if (!byWeek.has(k)) byWeek.set(k, { deliver: w.deliver, days: [] });
        byWeek.get(k).days = byWeek.get(k).days.concat(w.days);
      });
      return [...byWeek.values()];
    }
    return waves;
  }

  /* 某一顿属于哪一单 */
  function waveFor(state, date, from) {
    const start = from || (todayStr() < date ? todayStr() : addD(date, -20));
    const ws = wavesOf(state, start, Math.max(21, dspan(start, date) + 3));
    return ws.find(w => w.days.indexOf(date) >= 0) || null;
  }

  function shopping(ws, state) {
    const plans = state.plans || {};
    const today = todayStr();
    if (!Object.keys(plans).length) return { ws, batches: [] };
    const from = ws > today ? ws : today;
    const waves = wavesOf(state, from, 21);
    if (!waves.length) return { ws, batches: [] };
    const out = waves.map((w, i) => ({
      b: i, order: w.deliver, deliver: w.deliver, days: w.days,
      name: (w.deliver === today ? '今天 ' : WEEK_CN[dow(w.deliver)] + ' ') + md(w.deliver),
      note: w.days.length > 1 ? `送 ${md(w.deliver)}–${md(w.days[w.days.length - 1])}` : `送 ${md(w.deliver)}`,
      items: [], opt: [], have: [], carry: [], restock: [], total: 0, needs: {}, uses: {}, covers: [], needByDay: {}
    }));
    const eaters = (state.profiles || []).length || 1;

    /* 每一单服务的，就是它覆盖的那几天（由保质期算出来的，不再是固定星期几） */
    out.forEach((b, i) => {
      for (const dt0 of b.days) {
        const pw = mondayOf(dt0);
        const pl = plans[pw];
        if (!pl) continue;
        const m = (pl.days || []).find(x => x.date === dt0);
        if (!m || m.status !== 'cook' || !m.dishes || !m.dishes.length) continue;
        b.covers.push({ date: dt0, name: m.dishes.map(id => (DISH[id] || {}).name).filter(Boolean).join(' + '), week: pw === ws ? 'this' : 'adj' });
        const nb = (b.needByDay[dt0] = b.needByDay[dt0] || {});   // 这一天的用量，用来算"最早能哪天到货"
        m.dishes.forEach(id => {
          const d = DISH[id]; if (!d) return;
          const scale = dishScale(state, m);
          d.ing.forEach(x => {
            if (x.key === 'rice_cooked' || x.key === 'brown_rice_cooked' || x.key === 'water') return;
            const grams = x.g * scale;
            if (x.opt) { b.optSet = b.optSet || {}; b.optSet[x.key] = (b.optSet[x.key] || 0) + grams; return; }
            const it0 = ING[x.key] || {};
            /* 打扫冰箱的菜：蔬菜部分用家里现成的，不硬买（葱姜蒜一起跳过，本来也是常备） */
            if (isFlex(d) && it0.cat === '蔬菜') {
              if (['scallion', 'ginger', 'garlic', 'spring_onion'].indexOf(x.key) < 0) {
                const fl = (b.flex = b.flex || []);
                const hitF = fl.find(f => f.dish === d.name && f.name === it0.name);
                if (hitF) hitF.g = Math.max(hitF.g, Math.round(grams));
                else fl.push({ dish: d.name, name: it0.name, g: Math.round(grams) });
              }
              return;
            }
            const k2 = pickKey(state, d, x.key, dt0, b.needs);
            b.needs[k2] = (b.needs[k2] || 0) + grams;
            nb[k2] = (nb[k2] || 0) + grams;
            b.swaps = b.swaps || {};
            if (k2 !== x.key) b.swaps[k2] = x.key;
            /* 记下"这 50g 是哪道菜要的"，采购行展开就能看到 */
            const use = (b.uses[k2] = b.uses[k2] || []);
            const hit = use.find(u => u.name === d.name);
            if (hit) hit.g += grams; else use.push({ name: d.name, g: grams });
          });
          /* 调料：永远不进购物车，只看要不要提醒补货 */
          (d.season || []).forEach(x => {
            const it = ING[x.key];
            if (it && it.pantry && (state.pantry || {})[x.key] === 'low') {
              b.restock.push({ key: x.key, name: it.name });
            }
          });
        });
        if (m.rice) {
          const st = stapleOf(state, m);
          const g = m.rice * st.rawPerBowl * mealScale(state, m);
          b.needs[st.key] = (b.needs[st.key] || 0) + g;
          nb[st.key] = (nb[st.key] || 0) + g;
          const use = (b.uses[st.key] = b.uses[st.key] || []);
          const nm = st.name + ' ' + m.rice + ' 碗';
          const hit = use.find(u => u.name === nm);
          if (hit) hit.g += g; else use.push({ name: nm, g });
        }
      }
    });

    /* 按时间顺序结算：上一单用不完的、且还放得住的，抵扣下一单。
       但如果上一单已经"买了"，那些余量已经进库存了，就不能再算一次 carry。 */
    const leftover = {};
    /* 库存要一单一单往下扣，不能每单都拿今天的全部库存去抵 */
    const stockLeft = {};
    Object.keys(ING).forEach(k => { stockLeft[k] = invQty(state, k, from); });
    const isOrdered = d => !!((state.ordered || {})[d]);
    let prevOrdered = false;
    out.forEach(b => {
      const stock0 = Object.assign({}, stockLeft);   // 这一单开始前的库存快照，用来算"能不能晚点再买"
      Object.keys(b.needs).forEach(key => {
        const it = ING[key]; if (!it) return;
        const need = b.needs[key];
        if (prevOrdered) leftover[key] = 0;
        if (it.pantry) {
          const low = (state.pantry || {})[key] === 'low';
          /* 调料永远不进购物车：标了待补就提醒一下，否则算常备 */
          if (it.cat === '调料') {
            if (low) b.restock.push({ key, name: it.name });
            else b.have.push({ key, name: it.name, g: Math.round(need), note: '常备' });
            return;
          }
          if (!low) { b.have.push({ key, name: it.name, g: Math.round(need), note: '常备' }); return; }
          if (!it.sku) { b.restock.push({ key, name: it.name }); return; }   // 没有七鲜价的，只提醒
        }
        const sku = skuOf(key, state);
        if (!sku || !sku.specG) { b.have.push({ key, name: it.name, g: Math.round(need), note: '自备' }); return; }
        /* 同类食材可以互相顶：牛肉末没了用牛肋条、里脊没了用肋条（反向也行） */
        const fam = [key].concat(SUBST[key] || []);
        let fromInv = 0;
        fam.forEach(k => { fromInv += (stockLeft[k] || 0); });
        const carry = leftover[key] || 0;
        const avail = fromInv + carry;
        const net = need - avail;
        if (net <= 0) {
          const useInv = Math.min(fromInv, need);
          /* 先扣本尊，不够再从替代品扣，并记下到底是哪个顶上的 */
          let left = useInv, subUsed = '';
          fam.forEach(k => {
            const take = Math.min(stockLeft[k] || 0, left);
            if (take > 0) {
              stockLeft[k] = (stockLeft[k] || 0) - take;
              left -= take;
              if (k !== key) subUsed = (ING[k] || {}).name || k;
            }
          });
          const note = carry > 0 ? '上一单剩的' : (subUsed ? '库存够 · 用' + subUsed + '顶' : '库存够');
          b.have.push({ key, name: it.name, g: Math.round(need), note });
          if (carry > 0) leftover[key] = Math.max(0, carry - Math.max(0, need - useInv));
          return;
        }
        fam.forEach(k => { stockLeft[k] = 0; });
        const packs = Math.max(1, Math.ceil(net / sku.specG));
        const gain = packs * sku.specG;
        const rest = gain - net;
        leftover[key] = keepDays(key) >= 5 ? rest : 0;
        b.items.push({
          key, name: it.name, sku: sku.name, spec: sku.spec, specG: sku.specG,
          packs, price: Math.round(sku.price * packs * 100) / 100, unit: sku.price,
          need: Math.round(net), gross: Math.round(need), share: net / gain, real: sku.real, cat: it.cat,
          uses: (b.uses[key] || []).map(u => ({ name: u.name, g: Math.round(u.g) })),
          carry: carry > 0 ? Math.round(carry) : 0, rest: Math.round(rest)
        });
      });
      /* 同一种 SKU 可能被多个食材 key 命中，合并成一行再算钱 */
      const bySku = new Map();
      b.items.forEach(x => {
        const hit = bySku.get(x.sku);
        if (!hit) { bySku.set(x.sku, { ...x }); return; }
        hit.packs += x.packs; hit.need += x.need; hit.gross += x.gross;
        hit.rest += x.rest; hit.carry = Math.max(hit.carry, x.carry);
        hit.share = Math.min(hit.share, x.share);
        (x.uses || []).forEach(u => {
          const f = hit.uses.find(y => y.name === u.name);
          if (f) f.g += u.g; else hit.uses.push({ name: u.name, g: u.g });
        });
      });
      b.items = [...bySku.values()];
      b.total = b.items.reduce((a, x) => a + x.unit * x.packs, 0);
      /* 下单日往后挪：前面几天靠库存就够的话，没必要提前一天把菜买回来放着 */
      if (b.items.length && b.needByDay) {
        const bought = {};
        b.items.forEach(x => { bought[x.key] = (bought[x.key] || 0) + x.need; });
        let best = b.deliver;
        for (const cand of b.days) {
          if (cand < b.deliver) continue;
          const avail = Object.assign({}, stock0);
          let ok = true, arrived = false;
          for (const d of b.days) {
            if (!arrived && d >= cand) {
              Object.keys(bought).forEach(k => { avail[k] = (avail[k] || 0) + bought[k]; });
              arrived = true;
            }
            const nd = b.needByDay[d] || {};
            for (const k of Object.keys(nd)) {
              /* 常备/自备的（米面调料）不看库存，只看"这单要不要为它跑一趟" */
              if (!bought[k] && !((avail[k] || 0) > 0)) continue;
              if ((avail[k] || 0) + 0.01 < nd[k]) { ok = false; break; }
            }
            if (!ok) break;
            Object.keys(nd).forEach(k => { avail[k] = (avail[k] || 0) - nd[k]; });
          }
          if (ok) best = cand;
        }
        if (best > b.deliver) {
          b.deliver0 = b.deliver;
          b.deliver = best;
          b.name = (best === today ? '今天 ' : WEEK_CN[dow(best)] + ' ') + md(best);
          b.note = b.days.length > 1 ? `送 ${md(best)}–${md(b.days[b.days.length - 1])}` : `送 ${md(best)}`;
        }
      }
      if (b.items.some(x => x.carry > 0)) b.carry = b.items.filter(x => x.carry > 0);
      const order = ['肉禽蛋', '水产', '蔬菜', '菌菇', '豆制品', '水果', '主食', '乳品'];
      b.items.sort((x, y) => (order.indexOf(x.cat) - order.indexOf(y.cat)) || (y.price - x.price));
      b.total = Math.round(b.total * 100) / 100;
      b.factor = priceFactor(state);
      b.rawTotal = Math.round(b.total / b.factor * 100) / 100;   // 未校准的标价合计，回填实付时用它算比例
      b.ship = b.total > 0 && b.total < 39 ? 3 : 0;
      b.gap = b.total > 0 ? Math.round((39 - b.total) * 100) / 100 : 0;
      b.pay = Math.round((b.total + b.ship) * 100) / 100;
      b.opt = Object.keys(b.optSet || {}).map(k => ({ key: k, name: (ING[k] || {}).name || k, g: Math.round(b.optSet[k]) }));
      b.restock = [...new Map(b.restock.map(r => [r.key, r])).values()];
      b.ordered = isOrdered(b.deliver);
      b.past = b.deliver < todayStr();                   // 这单的下单日已经过去
      prevOrdered = b.ordered;
    });

    /* 提前买：后面的单里"放得住"的东西，挪到前面这单来，好凑满 ¥39 起送。
       只是把下单时机提前，总花销不变；放不到那天的（叶菜、鲜鱼、豆腐）不挪。 */
    const canEarly = (x, gap) => {
      const key = x.key;
      const it = ING[key]; if (!it) return false;
      const keep = keepDays(key);
      if (keep < gap + 2) return false;
      /* 一大包只用一点点、又挺贵的东西，别为了凑单提前买回家占冰箱 */
      const packPay = x.unit * x.packs;
      if (x.share < 0.25 && packPay >= 15) return false;
      if (packPay > Math.max(gap * 3, 30)) return false;
      if (FROZEN_CATS.indexOf(it.cat) >= 0) return true;         // 肉可以买回来就冻
      return ['蔬菜', '主食', '菌菇', '水果', '干货'].indexOf(it.cat) >= 0 && keep >= 7;
    };
    const retotal = b => {
      b.total = Math.round(b.items.reduce((a, x) => a + x.unit * x.packs, 0) * 100) / 100;
      b.factor = priceFactor(state);
      b.rawTotal = Math.round(b.total / b.factor * 100) / 100;
      b.ship = b.total > 0 && b.total < 39 ? 3 : 0;
      b.gap = b.total > 0 ? Math.round((39 - b.total) * 100) / 100 : 0;
      b.pay = Math.round((b.total + b.ship) * 100) / 100;
    };
    for (let i = 0; i < out.length - 1; i++) {
      const b = out[i];
      if (!b.items.length || b.total >= 39 || b.ordered) continue;
      for (let j = i + 1; j < out.length && b.total < 39; j++) {
        const nb = out[j];
        if (!nb.items.length) continue;
        const gap = Math.max(1, dspan(b.deliver, nb.deliver));
        const move = nb.items.filter(x => canEarly(x, gap));
        if (!move.length) continue;
        const moved = [];
        move.forEach(x => {
          if (b.total >= 39) return;
          b.items.push(Object.assign({}, x, { early: nb.name, earlyDate: nb.deliver }));
          b.total += x.unit * x.packs;
          moved.push(x);
        });
        if (!moved.length) continue;
        nb.items = nb.items.filter(x => moved.indexOf(x) < 0);
        retotal(nb);
      }
      retotal(b);
      b.earlyCount = b.items.filter(x => x.early).length;
    }
    return { ws, batches: out.filter(b => b.items.length || b.have.length) };
  }

  /* 凑单建议：只推耐放的 */
  const FILLERS = ['egg', 'milk', 'noodle', 'shrimp_meat', 'tofu_dry', 'rice', 'potato', 'onion', 'carrot', 'cabbage', 'garden_cabbage', 'garlic', 'ginger', 'scallion', 'wood_ear', 'dried_chili', 'flour'];
  function fillers(batch) {
    const skip = new Set(batch.items.map(x => x.key));
    (batch.have || []).forEach(h => { if (!h.note.startsWith('上一单')) skip.add(h.key); });
    return FILLERS.filter(k => ING[k] && ING[k].sku && !skip.has(k))
      .map(k => ({ key: k, name: ING[k].name, sku: ING[k].sku.name, spec: ING[k].sku.spec, price: ING[k].sku.price }))
      .sort((a, b) => a.price - b.price);
  }

  function copyText(batch) {
    const lines = [`【${batch.name}】${batch.deliver} ${batch.note}`];
    batch.items.forEach(x => lines.push(`${x.sku} ×${x.packs}  ¥${(x.unit * x.packs).toFixed(2)}`));
    lines.push(`合计 ¥${batch.total.toFixed(2)}${batch.ship ? ` + 运费 ¥3` : '（免运费）'}`);
    if (batch.restock && batch.restock.length) lines.push('还要补：' + batch.restock.map(r => r.name).join('、'));
    return lines.join('\n');
  }

  /* 推荐新菜式（不在用户菜谱里，标"未尝试"） */
  const SUGGEST = ((root.DATA && root.DATA.suggest) || []).slice();
  /* 用户"加进我的菜谱"的菜（含从推荐里收的）：启动时并回 DISH，排期和采购就都认了 */
  function hydrateCustom(state) {
    ((state && state.custom) || []).forEach(d => { if (d && d.id) DISH[d.id] = d; });   // 自己的改动覆盖原始菜谱
  }

  root.Core = {
    DAY, WEEK_CN, DISH, ING, SUGGEST, dt, iso, addD, dow, dspan, md, weekDays, mondayOf, money, yuan,
    mainProtein, shelfOf, hasLeafy, dishCost, batchesOf, batchIndexOf, generate, shopping, skuOf, keepDays,
    invQty, fillers, copyText, usedRecently, constraints, STAPLE, stapleOf, mealKcal, stapleKind, stapleWeek,
    priceFactor, hydrateCustom, todayStr, invDays, addInv, consumeInv, mealNeeds, fridgeScore, mealInStock,
    wavesOf, waveFor, dayKeys, eaterIdsFor, portionOf, mealScale, dishScale, mealEaters,
    altKeys: (id, k) => altsOf(DISH[id] || (DATA.suggest || []).find(d => d.id === id), k),
    altsOf, isFlex
  };
})(typeof window !== 'undefined' ? window : globalThis);
