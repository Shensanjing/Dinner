/* 核心逻辑：日期 / 排期 / 采购聚合 / 库存。浏览器与 node 共用。 */
(function (root) {
  const DATA = root.DATA;
  const DISH = {};
  DATA.dishes.forEach(d => { DISH[d.id] = d; });
  const ING = {};
  DATA.ingredients.forEach(i => { ING[i.key] = i; });

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

  /* ---------- 菜品特征 ---------- */
  const PROTEIN = {
    pork_belly: '猪', pork_shoulder: '猪', pork_ribs: '猪', pork_fat: '猪',
    beef: '牛', beef_rib: '牛', chicken_breast: '鸡', chicken_leg: '鸡',
    shrimp: '虾', shrimp_meat: '虾', egg: '蛋',
    tofu_soft: '豆', tofu_firm: '豆', tofu_dry: '豆'
  };
  const FROZEN_CATS = ['肉禽蛋', '水产'];

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
  /* 一顿饭的总热量：菜 + 主食 */
  function mealKcal(state, m) {
    const d = DISH[(m.dishes || [])[0]];
    const eaters = Math.max(1, (m.eaters || []).length || 1);
    const riceK = m.rice ? stapleOf(state, m).kcalPerBowl * m.rice : 0;
    return Math.round(((d ? d.kcal : 0) + riceK) * eaters);
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

  /* 一周的"菜品结构"：荤菜顿数由用户定（默认 3），其余是半荤 / 素 / 面饭。
     荤菜只放工作日、且两天不挨着；周末留给简单的（素、面饭、半荤）。 */
  function templateFor(nMeat) {
    const n = Math.max(1, Math.min(5, nMeat | 0));
    const slots = new Array(7).fill('veg');
    let pos = [];
    for (let t = 0; t < 80; t++) {
      const cand = shuffle([0, 1, 2, 3, 4]).slice(0, n).sort((a, b) => a - b);
      if (cand.every((p, i) => i === 0 || p - cand[i - 1] >= 2)) { pos = cand; break; }
    }
    if (!pos.length) pos = [0, 2, 4].slice(0, n);
    pos.forEach(i => { slots[i] = 'meat'; });

    const pickFrom = arr => arr.length ? arr.splice(Math.floor(Math.random() * arr.length), 1)[0] : -1;
    const freeOf = () => [0, 1, 2, 3, 4, 5, 6].filter(x => slots[x] === 'veg');
    let i = pickFrom(freeOf().filter(x => x >= 5));      // 面饭优先放周末
    if (i < 0) i = pickFrom(freeOf());
    if (i >= 0) slots[i] = 'onepot';
    i = pickFrom(freeOf().filter(x => x < 5));           // 半荤优先放工作日
    if (i < 0) i = pickFrom(freeOf());
    if (i >= 0) slots[i] = 'half';
    return slots;
  }
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function generate(ws, state) {
    const cfg = constraints(state);
    const days = weekDays(ws);
    const used = usedRecently(state, ws, 14);
    const bs = batchesOf(ws);
    const pool = DATA.dishes;
    let best = null, bestScore = -1e9;

    for (let attempt = 0; attempt < 180; attempt++) {
      const tpl = templateFor(cfg.meatPerWeek);
      const picked = [];
      const chosen = new Set();
      const proteinCount = {};
      let score = 0, ok = true;

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

        const base = d => {
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
        let cands = pool.filter(d => d.kind === wantKind && base(d));
        if (!cands.length) {
          /* 这类菜今天一个都排不进去（保质期/撞菜/上限），退一步：优先补还没排满的类别 */
          const quota = {}, used2 = {};
          tpl.forEach(k => { quota[k] = (quota[k] || 0) + 1; });
          picked.forEach(m => { used2[m.kind] = (used2[m.kind] || 0) + 1; });
          cands = pool.filter(d => base(d) && (used2[d.kind] || 0) < (quota[d.kind] || 0));
        }
        if (!cands.length) cands = pool.filter(d => base(d));
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
          if (v > bestLocal) { bestLocal = v; pick = c; sc = v; }
        }
        score += sc;
        const p = mainProtein(pick);
        proteinCount[p] = (proteinCount[p] || 0) + 1;
        chosen.add(pick.id);
        picked.push({
          date, dishes: [pick.id], protein: p, kind: pick.kind, min: pick.min,
          status: 'cook', locked: false, staple: cfg.staple,
          rice: pick.kind === 'onepot' ? 0 : cfg.riceDefault, age
        });
      }
      if (ok && score > bestScore) { bestScore = score; best = picked; }
    }

    if (!best) {
      best = days.map(date => ({ date, dishes: [], protein: '素', status: 'empty', locked: false, rice: 0, age: 0 }));
    }
    return { weekStart: ws, days: best };
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

  function shopping(ws, state) {
    const bs = batchesOf(ws);
    const out = bs.map(b => ({ ...b, items: [], opt: [], have: [], carry: [], restock: [], total: 0, needs: {}, covers: [] }));
    const plans = state.plans || {};
    const anyPlan = Object.keys(plans).length > 0;
    if (!anyPlan) return { ws, batches: [] };

    const eaters = (state.profiles || []).length || 1;

    /* 一单实际服务的不是"本周"，而是从上一次到货到下一次到货之间的每一顿：
       周日单吃 周日/周一/周二，周三单吃 周三/周四/周五/周六。
       所以周日那单里既有本周周一、周二的菜，也有上周日的晚饭——那才是这一车的真实金额。 */
    out.forEach((b, i) => {
      const D = b.deliver;
      const isLast = i === out.length - 1;
      const end = isLast ? addD(D, 2) : addD(out[i + 1].deliver, -1);
      for (let dt0 = D; dt0 <= end; dt0 = addD(dt0, 1)) {
        const pw = mondayOf(dt0);
        if (isLast && pw !== ws && !plans[pw]) continue;   // 下周还没排就不算这单
        const pl = plans[pw];
        if (!pl) continue;
        const m = (pl.days || []).find(x => x.date === dt0);
        if (!m || m.status !== 'cook' || !m.dishes || !m.dishes.length) continue;
        b.covers.push({ date: dt0, name: m.dishes.map(id => (DISH[id] || {}).name).filter(Boolean).join(' + '), week: pw === ws ? 'this' : 'adj' });
        m.dishes.forEach(id => {
          const d = DISH[id]; if (!d) return;
          const scale = Math.max(1, (m.eaters && m.eaters.length) || eaters);
          d.ing.forEach(x => {
            if (x.key === 'rice_cooked' || x.key === 'brown_rice_cooked' || x.key === 'water') return;
            const grams = x.g * scale;
            if (x.opt) { b.optSet = b.optSet || {}; b.optSet[x.key] = (b.optSet[x.key] || 0) + grams; return; }
            b.needs[x.key] = (b.needs[x.key] || 0) + grams;
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
          b.needs[st.key] = (b.needs[st.key] || 0) + m.rice * st.rawPerBowl;
        }
      }
    });

    /* 按时间顺序结算：上一单用不完的、且还放得住的，抵扣下一单 */
    const leftover = {};
    out.forEach(b => {
      Object.keys(b.needs).forEach(key => {
        const it = ING[key]; if (!it) return;
        const need = b.needs[key];
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
        const fromInv = invQty(state, key, b.deliver);
        const carry = leftover[key] || 0;
        const avail = fromInv + carry;
        const net = need - avail;
        if (net <= 0) {
          b.have.push({ key, name: it.name, g: Math.round(need), note: carry > 0 ? '上一单剩的' : '库存够' });
          if (carry > 0) leftover[key] = carry - Math.max(0, need - fromInv);
          return;
        }
        const packs = Math.max(1, Math.ceil(net / sku.specG));
        const gain = packs * sku.specG;
        const rest = gain - net;
        leftover[key] = keepDays(key) >= 5 ? rest : 0;
        b.items.push({
          key, name: it.name, sku: sku.name, spec: sku.spec, specG: sku.specG,
          packs, price: Math.round(sku.price * packs * 100) / 100, unit: sku.price,
          need: Math.round(net), gross: Math.round(need), share: net / gain, real: sku.real, cat: it.cat,
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
      });
      b.items = [...bySku.values()];
      b.total = b.items.reduce((a, x) => a + x.unit * x.packs, 0);
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
    });
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
    ((state && state.custom) || []).forEach(d => { if (d && d.id && !DISH[d.id]) DISH[d.id] = d; });
  }

  root.Core = {
    DAY, WEEK_CN, DISH, ING, SUGGEST, dt, iso, addD, dow, dspan, md, weekDays, mondayOf, money, yuan,
    mainProtein, shelfOf, hasLeafy, dishCost, batchesOf, batchIndexOf, generate, shopping, skuOf, keepDays,
    invQty, fillers, copyText, usedRecently, constraints, STAPLE, stapleOf, mealKcal,
    priceFactor, hydrateCustom
  };
})(typeof window !== 'undefined' ? window : globalThis);
