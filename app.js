/* 今晚吃什么 —— 界面层 */
(function () {
  const C = window.Core, DISH = C.DISH, ING = C.ING;
  const LS = 'dinner.v1';
  const KIND = { meat: '荤', half: '半荤', veg: '素', onepot: '面饭' };
  const $ = s => document.querySelector(s);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const p2 = n => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
  const num = n => Math.round(n * 10) / 10;
  const unitTxt = v => String(Math.round(v * 10) / 10);
  const uid = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  /* ---------------- 状态 ---------------- */
  function seedInventory() {
    const d = (n) => C.addD(today(), n);
    return [
      { key: 'brown_rice', g: 5000, exp: d(180) }, { key: 'garlic', g: 250, exp: d(45) },
      { key: 'ginger', g: 200, exp: d(25) }, { key: 'scallion', g: 300, exp: d(12) },
      { key: 'egg', g: 1650, exp: d(21) }, { key: 'wood_ear', g: 80, exp: d(300) },
      { key: 'flour', g: 1000, exp: d(200) }
    ].map(x => ({ id: uid(), ...x }));
  }
  const DEF = () => ({
    v: 4, tab: 'week', weekStart: C.mondayOf(today()), day0: today(),
    plans: {}, history: {}, inventory: seedInventory(), pantry: {}, custom: [], archived: [], customIng: [],
    profiles: [{ id: 'p1', name: '我', portion: 1 }],
    settings: {
      weekdayMax: 40, weekendMax: 60, riceGrams: 130, spicyNights: 3,
      meatPerWeek: 3, staple: 'brown', eatersDefault: 1
    },
    skuOverride: {}, checked: {}, batch: 0, seen: false, priceFactor: 1, paid: {}, ordered: {}
  });
  let S;
  try { S = JSON.parse(localStorage.getItem(LS)) || DEF(); } catch (e) { S = DEF(); }
  Object.keys(DEF()).forEach(k => { if (S[k] === undefined) S[k] = DEF()[k]; });
  Object.keys(DEF().settings).forEach(k => { if (S.settings[k] === undefined) S.settings[k] = DEF().settings[k]; });
  /* 老版本迁移 */
  if (!S.v || S.v < 2) {
    if (S.settings.weekendMax > 60) S.settings.weekendMax = 60;   // 120 太松，会把大菜排到周末
    S.v = 2;
  }
  if (!S.v || S.v < 3) {
    /* v2 存的是"每顿几碗"，改成克：一碗糙米按 48g、白米按 50g 生米算 */
    const st = C.STAPLE[S.settings.staple] ? S.settings.staple : 'brown';
    if (S.settings.riceGrams == null) {
      S.settings.riceGrams = Math.round((S.settings.ricePerMeal == null ? 2 : S.settings.ricePerMeal) * C.STAPLE[st].rawPerBowl);
    }
    delete S.settings.ricePerMeal;
    S.v = 3;
  }
  if (!S.v || S.v < 4) {
    /* v4：历史改成"过一天拍一张快照"，不再拿当前计划回算。
       老计划的 created 一律记成今天 —— 之前的日子本来就没按那个计划吃过。 */
    S.history = S.history || {};
    Object.values(S.plans || {}).forEach(p => { if (p && !p.created) p.created = today(); });
    S.v = 4;
  }
  C.hydrateCustom(S);   // 用户自己收进菜谱的菜要能被排期和采购认出来
  /* 日程页以"今天"为顶，每次打开都重新对齐到本周一，跨周不用手动翻 */
  S.weekStart = C.mondayOf(today());
  /* 库存记录补唯一 id：以前按下标删，列表按到期日排序后会删错行 */
  S.archived = S.archived || [];
  (S.inventory || []).forEach(x => { if (!x.id) x.id = uid(); });
  /* 自定义食材：买了菜谱里没有的东西（藕、秋葵、某个牌子的酸奶），也要能进库存 */
  const ING_CATS = ['肉禽蛋', '水产', '蔬菜', '菌菇', '豆制品', '水果', '主食', '乳品', '调料', '其他'];
  function hydrateIng() {
    (S.customIng || []).forEach(it => { if (it && it.key && !C.ING[it.key]) C.ING[it.key] = it; });
  }
  hydrateIng();
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) { toast('存储失败：空间不足'); } };

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1800);
  }
  const plan = ws => S.plans[ws];
  const mealAt = (ws, date) => { const p = plan(ws); return p && p.days.find(m => m.date === date); };

  /* ---------------- 顶部 ---------------- */
  const TITLES = { week: '今晚吃什么', shop: '采购清单', lib: '菜谱库', inv: '食品库存', set: '设置' };
  function renderTop() {
    const ws = S.weekStart, we = C.addD(ws, 6);
    $('#title').textContent = TITLES[S.tab] || '今晚吃什么';
    const wk = `${ws.slice(5).replace('-', '.')} – ${we.slice(5).replace('-', '.')}`;
    let s = (S.tab === 'week' || S.tab === 'shop') ? wk : '';
    if (S.tab === 'week') {
      const m = mealForDate(today());
      const d = m && m.dishes && m.dishes[0] ? DISH[m.dishes[0]] : null;
      s = d ? `今天吃 ${d.name}${m.status === 'out' ? '（外食）' : ''}` : (m && m.status === 'out' ? '今天外食' : '今天还没定');
      const n = (S.plans[ws] || { days: [] }).days.filter(x => x.status === 'cook' && x.dishes.length).length;
      s += ` · 这周已排 ${n} 顿`;
    }
    if (S.tab === 'shop') {
      const sh = C.shopping(ws, S);
      const t = sh.batches.reduce((a, b) => a + b.pay, 0);
      if (sh.batches.length) s += ` · 预计 ${C.yuan(t)}`;
    }
    if (S.tab === 'lib') s = `${Object.keys(DISH).length} 道家常菜`;
    if (S.tab === 'inv') s = S.inventory.length ? `${S.inventory.length} 样在库` : '还没有记录';
    $('#subtitle').textContent = s;
    const nav = S.tab === 'shop';                       // 日程页是连续滚动，不再左右翻页
    $('#btnPrev').style.display = $('#btnNext').style.display = nav ? '' : 'none';
    document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  }

  /* ---------------- 本周 ---------------- */
  function freshBadge(m) {
    const age = m.age || 0;
    if (m.status !== 'cook') return '';
    /* 食材全在库存里的时候，"到货第 N 天"没有意义（你并不需要这单买东西） */
    if (C.mealInStock(S, m)) return '<span class="badge ok">库存够</span>';
    if (age === 0) return '<span class="badge">刚送到</span>';
    if (age <= 1) return '';
    return `<span class="badge warn">到货第 ${age + 1} 天</span>`;
  }
  function mealCard(m) {
    const d = m.dishes && m.dishes[0] ? DISH[m.dishes[0]] : null;
    const [y, mo, da] = m.date.split('-');
    const isToday = m.date === today();
    let inner;
    if (m.status === 'out') {
      inner = `<div class="dish-line"><span class="dish-name" style="color:#9a8d84">外食 🍽</span></div>
        <div class="dish-meta">这顿不做饭，食材会剩下来</div>`;
    } else if (!d) {
      inner = `<div class="empty-day">还没安排 · 点一下选菜</div>`;
    } else {
      const meta = [];
      const st = C.stapleOf(S, m);
      meta.push(`${C.mealKcal(S, m)} kcal`);
      meta.push(`${d.min} 分钟`);
      meta.push(KIND[d.kind]);
      if (m.rice) meta.push(`${st.name} ${m.rice} 碗`);
      const nEat = (m.eaters && m.eaters.length) || S.settings.eatersDefault || 1;
      if (nEat > 1) meta.push(`${nEat} 人`);
      if (d.spice >= 2) meta.push('辣');
      inner = `<div class="dish-line"><span class="dish-name">${esc(d.name)}</span>
          ${d.spice >= 2 ? '<span class="badge spicy">辣</span>' : ''}
        </div><div class="dish-meta">${meta.join(' · ')}</div>`;
    }
    return `<div class="card day-card" data-act="meal" data-arg="${m.date}">
      <div class="day-head">
        <span class="day-name">${C.WEEK_CN[C.dow(m.date)]}</span>
        <span class="day-date">${mo}.${da}</span>
        ${isToday ? '<span class="badge">今天</span>' : ''}
        <span class="sp"></span>${m.done ? '<span class="badge ok">✓ 已做</span>' : ''}${freshBadge(m)}${m.locked ? '<span class="badge">🔒 锁定</span>' : ''}      </div>${inner}</div>`;
  }
  /* 任意一天的那顿（跨周自动找） */
  function mealForDate(date) {
    const p = plan(C.mondayOf(date));
    return p ? p.days.find(m => m.date === date) || null : null;
  }
  /* 往后补排：缺哪周就排哪周，已锁定的不动；已经过去的那几周不补 */
  function ensureAhead(weeks) {
    let changed = false;
    const cur = C.mondayOf(today());
    for (let i = 0; i <= weeks; i++) {
      const ws = C.mondayOf(C.addD(S.weekStart, i * 7));
      if (ws < cur) continue;
      if (!S.plans[ws]) { S.plans[ws] = C.generate(ws, S); changed = true; }
    }
    if (changed) save();
  }
  /* 历史快照：过一天就拍一张，之后重排菜单不会改动它 */
  function syncHistory() {
    const t = today();
    S.history = S.history || {};
    let changed = false;
    Object.keys(S.plans || {}).forEach(ws => {
      const p = S.plans[ws];
      if (!p || !p.days) return;
      const from = p.created || t;          // 计划没建立之前的日子不算"吃过"
      p.days.forEach(m => {
        if (!(m.date < t && m.date >= from)) return;
        const d = m.dishes && m.dishes[0] ? DISH[m.dishes[0]] : null;
        const out = m.status === 'out';
        if (!d && !out) return;
        const old = S.history[m.date];
        if (!old) { S.history[m.date] = { name: d ? d.name : '外食', kcal: d ? C.mealKcal(S, m) : 0, out, done: !!m.done }; changed = true; }
        else if (m.done && !old.done) { old.done = true; changed = true; }
      });
    });
    return changed;
  }
  /* 过去 N 天：只读历史快照，不再从当前计划回算 */
  function pastStats(n) {
    const out = { days: [], kcal: 0, done: 0, spend: 0, shopN: 0 };
    const t = today();
    Object.keys(S.history || {}).forEach(date => {
      const gap = C.dspan(date, t);
      if (gap <= 0 || gap > n) return;
      const x = S.history[date] || {};
      out.days.push({ date, name: x.name || '', kcal: x.kcal || 0, done: !!x.done, out: !!x.out });
      out.kcal += x.kcal || 0;
      if (x.done) out.done++;
    });
    out.days.sort((a, b) => (a.date < b.date ? 1 : -1));
    Object.keys(S.ordered || {}).forEach(k => {
      const gap = C.dspan(k, t);
      if (gap > 0 && gap <= n + 6) { out.spend += (S.ordered[k].total || 0); out.shopN++; }
    });
    return out;
  }
  let histOpen = false;
  function viewWeek() {
    ensureAhead(1);                       // 今天这周 + 下一周，滚动就是连续的
    const days = [];
    for (let i = 0; i < 14; i++) days.push(C.addD(today(), i));
    const hist = pastStats(14);
    const cook = days.map(d => mealForDate(d)).filter(m => m && m.status === 'cook' && m.dishes.length);
    const cost = cook.reduce((a, m) => { const d = DISH[m.dishes[0]]; return a + (d ? C.dishCost(d) : 0); }, 0);
    const histCard = (hist.days.length || hist.spend) ? `
      <div class="card" style="padding:11px 14px" data-act="hist">
        <div class="row"><span class="muted">过去 14 天 · ${hist.days.length} 顿 · ${hist.kcal} kcal${hist.spend ? ` · 买菜 ${C.yuan(hist.spend)}` : ''}</span>
        <span class="sp"></span><span class="muted">${histOpen ? '收起' : '查看'}</span></div>
        ${histOpen ? `<div style="margin-top:6px">${hist.days.map(x => `<div class="row" style="padding:3px 0">
            <span class="muted" style="width:56px">${C.md(x.date)}</span>
            <span style="flex:1">${esc(x.name)}${x.done ? ' <span class="badge ok">✓</span>' : ''}</span>
            <span class="muted">${x.kcal} kcal</span></div>`).join('')}
          ${hist.spend ? `<div class="muted" style="margin-top:6px">这 ${hist.shopN} 次买菜共 ${C.yuan(hist.spend)}（实付）</div>` : ''}</div>` : ''}
      </div>` : '';
    let html = histCard + `
      <div class="card" style="padding:11px 14px">
        <div class="row"><span class="muted">往后 14 天 · ${cook.length} 顿 · 食材约 ${C.yuan(cost)}</span>
        <span class="sp"></span><button class="btn" style="padding:6px 11px;font-size:13px" data-act="regen">重排</button></div>
      </div>`;
    let lastWeek = '';
    /* 到货天数现在是"这天离它所属那一单的送达到底几天"，由波次算出来 */
    const ageMap = {};
    (C.shopping(S.weekStart, S).batches || []).forEach(b => {
      (b.days || []).forEach(d => { ageMap[d] = C.dspan(b.deliver, d); });
    });
    days.forEach(date => {
      const ws = C.mondayOf(date);
      if (ws !== lastWeek) {
        html += `<div class="sec-title">${C.md(ws)} 那一周</div>`;
        lastWeek = ws;
      }
      const m = mealForDate(date) || { date, status: 'empty', dishes: [], rice: 0 };
      if (ageMap[date] != null) m.age = ageMap[date];
      html += mealCard(m);
    });
    html += `<div class="muted center" style="margin:14px 0 6px">点任意一天可换菜 / 外食 / 改人数 / 锁定</div>`;
    $('#view').innerHTML = html;
  }

  /* ---------------- 采购 ---------------- */
  let shopBatch = -1;                     // -1 = 自动选"还没下单的那一单"
  /* 默认停在"还没下单的那一单"，别一进来就是一车过去的菜 */
  function firstOpenBatch() {
    const sh = C.shopping(S.weekStart, S);
    const i = sh.batches.findIndex(x => !x.past);
    return i < 0 ? 0 : i;
  }
  function viewShop() {
    const sh = C.shopping(S.weekStart, S);
    if (shopBatch < 0 || shopBatch >= sh.batches.length) shopBatch = firstOpenBatch();
    if (!sh.batches.length) {
      $('#view').innerHTML = `<div class="card" style="text-align:center;padding:22px">
        <div style="margin-bottom:6px">还没有排菜，先排一周</div>
        <button class="btn primary" data-act="goto" data-arg="week">去排菜</button></div>`;
      return;
    }
    const bi = shopBatch;
    const b = sh.batches[bi];
    const past = !!b.past;
    const checked = S.checked[S.weekStart + ':' + bi] || {};
    const pct = Math.min(100, b.total / 39 * 100);
    const items = b.items.map(x => {
      const on = past ? false : checked[x.key];
      const pack = x.rest >= x.specG * 0.45
        ? `<span class="badge warn">整包 ${x.specG}g · 剩 ${x.rest}g</span>` : '';
      const early = x.early ? `<span class="badge ok">提前到这一单</span>` : '';
      return `<div class="item ${on ? 'done' : ''}" ${past ? '' : `data-act="chk" data-arg="${bi}:${x.key}"`}>
        <div class="cb ${on ? 'on' : ''}">✓</div>
        <div style="flex:1;min-width:0">
          <div class="nm">${esc(x.name)} ×${x.packs} ${pack}${early}</div>
          <div class="sk">${esc(x.sku)}${x.real ? '' : ' · 估价'} · 这单用 ${x.gross}g${x.carry ? `（上单剩 ${x.carry}g 已抵扣）` : ''}${x.early ? ` · 本来在「${esc(x.early)}」` : ''}</div>
        </div>
        <div class="pr">${C.yuan(x.unit * x.packs)}</div></div>`;
    }).join('');
    const f = !past && b.gap > 0 && b.items.length ? C.fillers(b).slice(0, 4) : [];
    const fSum = f.reduce((a, x) => a + x.price, 0);
    const fAll = b.total + fSum;
    const fix = f.find(x => x.price >= b.gap);            // 加它就能过 39
    const sumCard = past ? `
      <div class="card sum-card" style="opacity:.8">
        <div class="row">
          <div><div class="muted">${b.note}</div><div class="sum-num">${C.yuan(b.total)}</div></div>
          <span class="sp"></span>
          <div style="text-align:right">${b.ship ? `<span class="badge warn">运费 ¥3</span>` : `<span class="badge">免运费</span>`}
            <div class="muted" style="margin-top:4px">共 ${b.items.reduce((a, x) => a + x.packs, 0)} 件</div></div>
        </div>
        <div class="muted" style="margin-top:6px">这一单的下单日（${C.md(b.deliver)}）已经过去了，下面只是那车菜的参考明细。真要改计划，请改还没下单的那几单。</div>
        <div class="covers">当时吃 ${b.covers.length} 顿：${b.covers.map(c =>
          `<span class="${c.week === 'adj' ? 'adj' : ''}">${C.WEEK_CN[C.dow(c.date)]} ${C.md(c.date)}</span>`).join(' · ')}</div>
      </div>` : b.items.length ? `
      <div class="card sum-card">
        <div class="row">
          <div><div class="muted">${b.note}</div><div class="sum-num">${C.yuan(b.total)}</div></div>
          <span class="sp"></span>
          <div style="text-align:right">${b.ship ? `<span class="badge warn">运费 ¥3</span>` : `<span class="badge">免运费</span>`}
            <div class="muted" style="margin-top:4px">共 ${b.items.reduce((a, x) => a + x.packs, 0)} 件</div></div>
        </div>
        <div class="bar"><i class="${b.total < 39 ? 'low' : ''}" style="width:${pct}%"></i></div>
        <div class="muted">${b.total >= 39 ? '已满 ¥39，免运费'
          : (fix ? `还差 ${C.yuan(39 - b.total)} —— 加 ${esc(fix.name)} ¥${fix.price} 就够（合计 ${C.yuan(b.total + fix.price)}）`
                 : `还差 ${C.yuan(39 - b.total)} 免运费（现在 +¥3）`)}</div>
        <div class="muted" style="margin-top:4px">${b.factor !== 1
          ? `已按实付校准 ×${b.factor.toFixed(2)}（标价合计 ${C.yuan(b.rawTotal)}）`
          : '金额按七鲜标价估算'} · <span class="link" data-act="paid" data-arg="${bi}">回填实付</span></div>
        <div class="covers">这一单吃 ${b.covers.length} 顿：${b.covers.map(c =>
          `<span class="${c.week === 'adj' ? 'adj' : ''}">${C.WEEK_CN[C.dow(c.date)]} ${C.md(c.date)}</span>`).join(' · ')}</div>
        ${b.earlyCount ? `<div class="muted" style="margin-top:4px">其中 ${b.earlyCount} 样是从后面几单<b>提前买</b>的（放得住），这样才凑得满 ¥39。</div>` : ''}
      </div>` : `
      <div class="card sum-card">
        <div style="font-size:15px;font-weight:600;margin-bottom:4px">这一单不用下单</div>
        <div class="muted">${b.note}。这几顿要用的食材，家里还有或者上一单的整包够用，不用再花钱。</div>
        <div class="covers">本来要吃 ${b.covers.length} 顿：${b.covers.map(c =>
          `<span class="${c.week === 'adj' ? 'adj' : ''}">${C.WEEK_CN[C.dow(c.date)]} ${C.md(c.date)}</span>`).join(' · ')}</div>
      </div>`;
    $('#view').innerHTML = `
      ${sh.batches.every(x => !x.items.length) ? `<div class="hint" style="margin-bottom:10px">这一周的食材家里都有，<b>不用下单</b>。想少花点钱的话，可以把「一周做几顿荤菜」调高一点，多吃点冰箱里的。</div>` : ''}
      <div class="hint" style="margin-bottom:10px">接下来要买 ${sh.batches.length} 次：${sh.batches.map((x, i) =>
        `<span class="link" data-act="batch" data-arg="${i}">${esc(x.name)}${x.items.length ? ' ' + C.yuan(x.total) : '（不用买）'}</span>`).join(' · ')}</div>
      <div class="batch-tabs">${sh.batches.map((x, i) =>
        `<button class="chip ${i === bi ? 'on' : ''}" data-act="batch" data-arg="${i}">${x.name}</button>`).join('')}</div>
      ${sumCard}
      ${f.length ? `<div class="sec-title">凑单建议（耐放的，凑满 ¥39）</div><div class="card" style="padding:8px 14px">
        ${f.map(x => `<div class="row" style="padding:5px 0"><span>${esc(x.name)}</span>${x === fix ? ' <span class="badge">加它就够</span>' : ''}<span class="sp"></span>
          <span class="muted">${esc(x.spec)}</span><b style="margin-left:8px">¥${x.price}</b></div>`).join('')}
        <div class="muted" style="margin-top:6px;border-top:1px dashed var(--line);padding-top:6px">
          全加 ¥${fSum.toFixed(2)} → 合计 ${C.yuan(fAll)}${fAll >= 39 ? '，免运费' : `，仍差 ${C.yuan(39 - fAll)}`}</div></div>` : ''}
      <div class="sec-title">要买 ${b.items.length} 样${past ? '（当时）' : ''}</div>
      <div class="card">${items || '<div class="muted">这一单不用买生鲜</div>'}</div>
      ${b.opt.length ? `<div class="sec-title">可选加的</div><div class="card" style="padding:8px 14px">
        ${b.opt.map(x => `<div class="row" style="padding:4px 0"><span class="muted">${esc(x.name)}</span><span class="sp"></span><span class="muted">${x.g}g</span></div>`).join('')}</div>` : ''}
      <div class="sec-title">家里还有 / 常备（不用买）</div>
      <div class="card" style="padding:8px 14px">
        ${b.have.map(h => `<div class="row" style="padding:4px 0;font-size:13px"><span>${esc(h.name)}</span><span class="sp"></span>
          <span class="muted">${h.note}${h.g ? ' · ' + h.g + 'g' : ''}</span></div>`).join('') || '<span class="muted">—</span>'}
      </div>
      ${b.restock && b.restock.length ? `<div class="sec-title">该补的调料</div>
      <div class="card" style="padding:10px 14px">
        <div class="row"><span>${b.restock.map(r => esc(r.name)).join('、')}</span></div>
        <div class="muted" style="margin-top:6px">你在「库存」里标了待补。七鲜没有固定规格价，没算进金额；买完点回「充足」就行。</div>
      </div>` : ''}
      ${past ? `<div class="hint" style="margin:14px 0">这一单已经过去了。要看接下来买什么，点上面「周三单 / 周日单(下周)」，或者翻到下一周。</div>` : `
      <div class="row" style="margin:14px 0"><button class="btn primary block" data-act="buy" data-arg="${bi}">${b.ordered ? '这单已记进库存（点一下撤销）' : '这单买了 → 记进库存'}</button></div>
      <div class="row" style="margin-top:-6px;margin-bottom:14px"><button class="btn block" data-act="copy" data-arg="${bi}">复制清单</button></div>
      <div class="hint">点「这单买了」以后，整包的量会进库存，后面的排期和采购会自动扣掉，不用再买第二遍。
        买完回来点「回填实付」，填一次真实扣款，之后所有估价都按你的券后价来（现在是 ${
        b.factor === 1 ? '标价' : '标价的 ' + Math.round(b.factor * 100) + '%'}）。</div>`}`;
  }

  /* ---------------- 菜库 ---------------- */
  let libQ = '', libKind = '', libTab = 'mine', newPage = 0;
  const customIds = () => new Set((S.custom || []).map(d => d.id));
  const archIds = () => new Set(S.archived || []);
  const dishById = id => DISH[id] || (C.SUGGEST || []).find(x => x.id === id);
  /* 我的菜谱：原始 53 道去掉移出的，再加上自己收编的 */
  const isMine = d => (!d.src || d.src !== 'suggest' || customIds().has(d.id)) && !archIds().has(d.id);
  /* 推荐菜按固定顺序一屏 8 道，「换一批」是往后翻一屏，真的换成别的菜 */
  const NEW_PER = 8;
  function viewLib() {
    const all = Object.values(DISH);
    const mine = all.filter(isMine);
    const arch = (S.archived || []).map(dishById).filter(Boolean);
    const pool = (C.SUGGEST || []).slice().sort((a, b) => (a.id < b.id ? -1 : 1))
      .filter(d => !customIds().has(d.id) && !archIds().has(d.id));
    const hit = list => list.filter(d =>
      (!libKind || d.kind === libKind) &&
      (!libQ || d.name.includes(libQ) || d.ing.some(i => i.name.includes(libQ))));
    const freshAll = hit(pool);
    const pages = Math.max(1, Math.ceil(freshAll.length / NEW_PER));
    const pg = newPage % pages;
    const base = libTab === 'new'
      ? freshAll.slice(pg * NEW_PER, pg * NEW_PER + NEW_PER)
      : hit(libTab === 'arch' ? arch : mine);
    const list = base;
    const tip = libTab === 'new' ? ' · 没做过的，试过觉得行就收进菜谱'
      : libTab === 'arch' ? ' · 移出来的菜不参与自动排期，想吃了再加回去'
        : ' · 不想再吃的点「移出」';
    const countTxt = libTab === 'new'
      ? `第 ${pg + 1}/${pages} 批 · 共 ${freshAll.length} 道推荐${libQ || libKind ? '（已筛选）' : ''}`
      : `${list.length} 道${tip}`;
    $('#view').innerHTML = `
      <div class="chips" style="margin-bottom:8px">
        <button class="chip ${libTab === 'mine' ? 'on' : ''}" data-act="libtab" data-arg="mine">我的菜谱 ${mine.length}</button>
        <button class="chip ${libTab === 'arch' ? 'on' : ''}" data-act="libtab" data-arg="arch">备选库 ${arch.length}</button>
        <button class="chip ${libTab === 'new' ? 'on' : ''}" data-act="libtab" data-arg="new">新菜推荐 ${freshAll.length}</button>
      </div>
      <input type="text" id="libq" placeholder="搜菜名或食材，比如：茄子" value="${esc(libQ)}">
      ${libTab === 'new' ? `<button class="btn ghost" style="margin-top:8px" data-act="newfresh">换一批（按 id 往后翻，36 道里轮换）</button>` : ''}
      <div class="chips" style="margin-top:10px">
        ${['', 'meat', 'half', 'veg', 'onepot'].map(k =>
          `<button class="chip ${libKind === k ? 'on' : ''}" data-act="libkind" data-arg="${k}">${k ? KIND[k] : '全部'}</button>`).join('')}
      </div>
      <div class="muted" style="margin:2px 2px 8px">${countTxt}</div>
      ${list.map(d => `<div class="card" style="padding:11px 14px" data-act="dish" data-arg="${d.id}">
        <div class="row"><span class="dish-name" style="font-size:15.5px">${esc(d.name)}</span>
        ${d.src === 'suggest' && !customIds().has(d.id) ? '<span class="badge warn">未尝试</span>' : ''}
        ${d.spice >= 2 ? '<span class="badge spicy">辣</span>' : ''}
        <span class="sp"></span><span class="muted">${d.kcal} kcal</span></div>
        <div class="dish-meta">${KIND[d.kind]} · ${d.min} 分钟 · ${d.ing.length} 种食材 · ${C.yuan(C.dishCost(d))}
          ${libTab === 'mine' ? `<span class="link" data-act="archive" data-arg="${d.id}">移出</span>` : ''}
          ${libTab === 'arch' ? `<span class="link" data-act="restore" data-arg="${d.id}">加回菜谱</span>` : ''}
          ${libTab === 'new' ? `<span class="link" data-act="addcustom" data-arg="${d.id}">加进我的菜谱</span>` : ''}
        </div>
      </div>`).join('') || '<div class="card"><div class="muted" style="text-align:center;padding:16px 0">这里面还没有菜</div></div>'}`;
    const q = $('#libq');
    q.oninput = e => { libQ = e.target.value; viewLib(); $('#libq').focus(); };
  }

  /* ---------------- 库存 ---------------- */
  /* 能数个数就显示个数（3 枚 ≈ 165g），否则只显示克数；太轻的东西（木耳 1.2g/朵）只给克数 */
  function invText(it, g) {
    if (it.unit && it.per && it.per >= 15) return `${num(Math.round(g / it.per * 10) / 10)}${it.unit}（${num(g)}g）`;
    return `${num(g)}g`;
  }
  const PANTRY = () => Object.values(ING).filter(i => i.pantry && !i.sku);
  function viewInv() {
    const items = S.inventory.slice().sort((a, b) => (a.exp || '').localeCompare(b.exp || ''));
    const soon = items.filter(i => i.exp && C.dspan(today(), i.exp) <= 2);
    const pt = PANTRY();
    const low = pt.filter(i => S.pantry[i.key] === 'low');
    $('#view').innerHTML = `
      ${soon.length ? `<div class="hint" style="margin-bottom:10px">临期 ${soon.length} 样：${soon.map(x => esc((ING[x.key] || {}).name || x.key)).join('、')} —— 优先安排吃掉</div>` : ''}
      <div class="card">${items.map(x => {
        const it = ING[x.key] || {};
        const left = x.exp ? C.dspan(today(), x.exp) : null;
        const soon2 = left !== null && left <= 2;
        return `<div class="item" data-act="editinv" data-arg="${x.id}">
          <div style="flex:1"><div class="nm">${esc(it.name || x.key)}</div>
          <div class="sk">${invText(it, x.g)}${x.exp ? ` · <span style="${soon2 ? 'color:#b7791f' : ''}">${left < 0 ? '已过期' : left + ' 天后到期'}</span>` : ''}</div></div>
          <button class="btn" style="padding:5px 10px;font-size:12px" data-act="delinv" data-arg="${x.id}">删</button>
        </div>`;
      }).join('') || '<div class="muted">还没有记录。买回来的东西先记一笔，排菜时自动扣。</div>'}</div>
      <div class="hint" style="margin-bottom:10px">点任意一条可以改数量、改保质期。</div>
      <button class="btn primary block" data-act="addinv">＋ 记一笔库存</button>
      <div class="sec-title">常备调料（点一下切换）</div>
      <div class="card">
        <div class="chips wrap" style="margin:0">
          ${pt.map(it => `<button class="chip ${S.pantry[it.key] === 'low' ? 'low' : ''}" data-act="ptoggle" data-arg="${it.key}">${esc(it.name)}${S.pantry[it.key] === 'low' ? ' · 待补' : ''}</button>`).join('')}
        </div>
        <div class="muted" style="margin-top:8px">深色的表示快用完了：下一单会在清单里提醒你补，但不会算进凑单金额。</div>
      </div>
      <div class="hint" style="margin-top:10px">牛肉这类一次买 2–3kg 的，记「还能放 60 天」放冷冻；排菜时会先扣库存，不会重复买。</div>`;
  }

  /* ---------------- 设置 ---------------- */
  function viewSet() {
    const s = S.settings;
    $('#view').innerHTML = `
      <div class="sec-title">吃饭的人</div>
      <div class="card">
        ${S.profiles.map((p, i) => `<div class="row" style="padding:6px 0">
          <input type="text" value="${esc(p.name)}" data-act="pname" data-arg="${i}" style="flex:1">
          <select data-act="pportion" data-arg="${i}" style="width:96px">
            ${[0.6, 0.8, 1, 1.3, 1.6].map(v => `<option value="${v}" ${v === p.portion ? 'selected' : ''}>${v} 人份</option>`).join('')}
          </select>
          ${S.profiles.length > 1 ? `<button class="link" style="margin-left:6px;background:none;border:0;color:#c0563a" data-act="delprofile" data-arg="${i}">删除</button>` : ''}</div>`).join('')}
        <button class="btn block" style="margin-top:8px" data-act="addprofile">＋ 加一个人</button>
      </div>
      <div class="sec-title">排期偏好</div>
      <div class="card">
        <label class="fld">一周做几顿荤菜</label>
        <div class="chips" style="margin:0 0 2px">
          ${[1, 2, 3, 4, 5].map(n => `<button class="chip ${s.meatPerWeek === n ? 'on' : ''}" data-act="setmeat" data-arg="${n}">${n} 顿</button>`).join('')}
        </div>
        <div class="muted" style="margin-bottom:10px">荤菜会排到工作日、两天不挨着；周末默认安排快手的素菜或面饭。</div>
        <label class="fld">默认主食</label>
        <div class="chips" style="margin:0 0 2px">
          ${Object.keys(C.STAPLE).map(k => `<button class="chip ${s.staple === k ? 'on' : ''}" data-act="setstaple" data-arg="${k}">${C.STAPLE[k].name}</button>`).join('')}
        </div>
        <div class="muted" style="margin-bottom:10px">单顿可以在当天抽屉里临时换。</div>
        <label class="fld">默认几个人吃</label>
        <div class="chips" style="margin:0 0 2px">
          ${[1, 2, 3, 4].map(n => `<button class="chip ${(s.eatersDefault || 1) === n ? 'on' : ''}" data-act="seteaters" data-arg="${n}">${n} 人</button>`).join('')}
        </div>
        <div class="muted" style="margin-bottom:10px">影响用量和热量；某天来客人，在当天抽屉里单独调就行。</div>
        <label class="fld">采购节奏</label>
        <div class="chips" style="margin:0 0 2px">
          <button class="chip ${s.shopMode !== 'week' ? 'on' : ''}" data-act="shopmode" data-arg="auto">按保质期分单</button>
          <button class="chip ${s.shopMode === 'week' ? 'on' : ''}" data-act="shopmode" data-arg="week">一周只买一次</button>
        </div>
        <div class="muted" style="margin-bottom:10px">「按保质期分单」会算好哪天该补一次菜，叶菜不会放到第 5 天；「一周只买一次」就是一车买齐一周。</div>
        <label class="fld">工作日最多做多久（分钟）</label>
        <input type="number" value="${s.weekdayMax}" data-act="setnum" data-arg="weekdayMax">
        <label class="fld">周末最多做多久（分钟）</label>
        <input type="number" value="${s.weekendMax}" data-act="setnum" data-arg="weekendMax">
        <label class="fld">每顿吃多少米（生米克数）</label>
        <div class="row" style="gap:8px">
          <input type="number" value="${s.riceGrams}" data-act="setrice" style="flex:1">
          <span class="muted" style="white-space:nowrap">≈ ${Math.round(s.riceGrams / C.STAPLE[s.staple || 'brown'].rawPerBowl * 10) / 10} 碗${C.STAPLE[s.staple || 'brown'].name}</span>
        </div>
        <div class="muted" style="margin-bottom:10px">1 碗熟饭按 150g 算：白米约 50g 生米、糙米约 48g（糙米蒸的时候吸水更多）。</div>
      </div>
      <div class="sec-title">价格</div>
      <div class="card">
        <div class="row"><span>按实付校准</span><span class="sp"></span>
          <b>×${(S.priceFactor || 1).toFixed(2)}</b></div>
        <div class="muted" style="margin-top:6px">在「采购」里点「回填实付」填一次真实扣款，所有金额就按你的券后价估。${
          S.priceFactor && S.priceFactor !== 1 ? '' : '现在还是七鲜标价。'}</div>
        ${S.priceFactor && S.priceFactor !== 1 ? '<button class="btn block" style="margin-top:8px" data-act="resetprice">恢复标价</button>' : ''}
      </div>
      <div class="sec-title">数据</div>
      <div class="card">
        <button class="btn block" data-act="export">导出备份（JSON）</button>
        <button class="btn block" style="margin-top:8px" data-act="import">导入备份</button>
        <button class="btn block" style="margin-top:8px;color:#c0392b" data-act="reset">清空所有数据</button>
        <div class="muted" style="margin-top:8px">数据只存在这台手机的浏览器里，换设备请先导出。</div>
      </div>
      <div class="sec-title">关于</div>
      <div class="card muted" style="font-size:12.5px;line-height:1.7">
        v0.7 · 菜谱 53 道 + 36 道新菜推荐，不想吃的可以移进备选库；价格为七鲜标价（¥39 免运费，未满 +¥3），可回填实付校准。<br>
        数字都是查表算的：卡路里按食材克数 × 每 100g 热量（含主食）；成本按整包价折算。
      </div>`;
    document.querySelectorAll('[data-act=pname]').forEach(el => el.onchange = e => { S.profiles[+el.dataset.arg].name = e.target.value; save(); });
    document.querySelectorAll('[data-act=pportion]').forEach(el => el.onchange = e => { S.profiles[+el.dataset.arg].portion = +e.target.value; save(); });
    document.querySelectorAll('[data-act=setnum]').forEach(el => el.onchange = e => { S.settings[el.dataset.arg] = +e.target.value; save(); });
    document.querySelectorAll('[data-act=setrice]').forEach(el => el.onchange = e => ACT.setrice(e.target.value));
  }

  /* ---------------- 渲染 ---------------- */
  const TABS = ['week', 'shop', 'lib', 'inv', 'set'];
  function syncHash() { try { if (location.hash !== '#' + S.tab) history.replaceState(null, '', '#' + S.tab); } catch (e) {} }
  /* 老备份导入的库存可能没有 id，渲染前补齐（删改都靠 id，不再靠下标） */
  function ensureInvIds() {
    (S.inventory || []).forEach(x => { if (!x.id) x.id = uid(); });
    if (!Array.isArray(S.archived)) S.archived = [];
  }
  function render() {
    ensureInvIds();
    /* 换天了才重新对到本周一：平时保留用户自己点左右翻出来的那一周 */
    const t = today();
    if (S.day0 !== t) { S.day0 = t; S.weekStart = C.mondayOf(t); }
    if (S.tab === 'week' || S.tab === 'shop') ensureAhead(1);
    if (syncHistory()) save();
    renderTop();
    ({ week: viewWeek, shop: viewShop, lib: viewLib, inv: viewInv, set: viewSet }[S.tab] || viewWeek)();
    syncHash();
  }

  /* ---------------- 抽屉 ---------------- */
  function showSheet(html) {
    const sh = $('#sheet'); sh.innerHTML = `<div class="grab"></div>${html}`;
    $('#backdrop').classList.add('on'); sh.classList.add('on'); sh.scrollTop = 0;
  }
  function hideSheet() {
    $('#sheet').classList.remove('on'); $('#backdrop').classList.remove('on');
  }
  $('#backdrop').onclick = hideSheet;

  function sheetMeal(date) {
    const m = mealForDate(date) || { date, status: 'empty', dishes: [], rice: 0 };
    const d = m.dishes && m.dishes[0] ? DISH[m.dishes[0]] : null;
    const st = C.stapleOf(S, m);
    const [y, mo, da] = date.split('-');
    const eaters = (m.eaters || S.profiles.map(p => p.id));
    showSheet(`
      <h2>${C.WEEK_CN[C.dow(date)]} ${+mo}月${+da}日</h2>
      <div class="sheet-sub">${d ? esc(d.name) + ' · ' + C.mealKcal(S, m) + ' kcal · ' + d.min + ' 分钟' : (m.status === 'out' ? '外食' : '还没安排')}</div>
      ${d ? `<div class="act-list">
        <button class="act" data-act="dish" data-arg="${d.id}"><span class="em">📖</span>看食材 / 做法</button>
      </div>` : ''}
      <div class="act-list">
        <button class="act" data-act="picker" data-arg="${date}"><span class="em">🔄</span>${d ? '换一道' : '选一道菜'}</button>
        <button class="act" data-act="done" data-arg="${date}"><span class="em">✅</span>${m.done ? '已经做了（点一下撤销）' : '这顿做了 → 从库存扣掉'}</button>
        <button class="act" data-act="out" data-arg="${date}"><span class="em">🍽</span>${m.status === 'out' ? '改成在家吃' : (date === today() ? '今天出去吃' : '这天出去吃')}</button>
        <button class="act" data-act="lock" data-arg="${date}"><span class="em">🔒</span>${m.locked ? '解锁这顿' : '锁定这顿（重排时不动）'}</button>
        <button class="act" data-act="eaters" data-arg="${date}"><span class="em">👥</span>这顿 ${(m.eaters && m.eaters.length) || S.settings.eatersDefault || 1} 人吃（点一下改）</button>
        <button class="act" data-act="rice" data-arg="${date}"><span class="em">🍚</span>${st.name}：${m.rice || 0} 碗${m.rice ? `（生米 ${Math.round(m.rice * st.rawPerBowl)}g）` : ''}</button>
        <button class="act" data-act="staple" data-arg="${date}"><span class="em">🌾</span>这顿换成${st.id === 'brown' ? '白米饭' : '糙米饭'}</button>
        <button class="act danger" data-act="clear" data-arg="${date}"><span class="em">🗑</span>清空这顿</button>
      </div>`);
  }

  function sheetDish(id, eaters) {
    const d = dishById(id); if (!d) return;
    const k = Math.max(1, eaters || 1);
    const ing = d.ing.map(x => {
      const u = x.unit || '';
      const gramLike = u === 'g' || u === 'ml' || u === '';
      const raw = x.qty && !gramLike ? `${unitTxt(x.qty * k)}${u}` : '';
      return `<tr><td>${esc(x.name)}${x.opt ? ' <span class="muted">(可选)</span>' : ''}</td>
        <td>${raw ? raw + ' · ' : ''}${num(x.g * k)}g</td></tr>`;
    }).join('');
    const sea = d.season.map(x => `<tr><td>${esc(x.name)}</td><td>${x.qty ? unitTxt(x.qty * k) + (x.unit || '') + ' · ' : ''}${num(x.g * k)}g</td></tr>`).join('');
    const needCookRice = d.ing.some(x => x.key === 'rice_cooked');
    showSheet(`
      <h2>${esc(d.name)}</h2>
      <div class="kv">
        <span><b>${d.kcal * k}</b> kcal /${k}人</span><span><b>${d.min}</b> 分钟</span>
        <span><b>${KIND[d.kind]}</b></span>${d.spice ? `<span>辣度 <b>${d.spice}</b>/3</span>` : ''}
        <span>食材约 <b>${C.yuan(C.dishCost(d) * k)}</b></span>
      </div>
      ${needCookRice ? '<div class="hint" style="margin-bottom:10px">这顿用隔夜米饭：前一晚多煮 1 碗，第二天直接炒。</div>' : ''}
      <div class="sec-title">食材（${k} 人份）</div>
      <table class="tbl">${ing}</table>
      <div class="sec-title">调料（常备）</div>
      <table class="tbl">${sea}</table>
      <div class="sec-title">做法</div>
      <ol class="steps">${d.steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      ${d.src === 'suggest' && !customIds().has(d.id) ? `<div class="row" style="margin-top:14px"><button class="btn primary block" data-act="addcustom" data-arg="${d.id}">加进我的菜谱</button></div>` : ''}
      ${archIds().has(d.id) ? `<div class="row" style="margin-top:14px"><button class="btn primary block" data-act="restore" data-arg="${d.id}">加回菜谱</button></div>` : ''}
      <div class="row" style="margin-top:14px"><button class="btn ghost block" data-act="editdish" data-arg="${d.id}">✏️ 改这道菜（食材 / 调料 / 做法）</button></div>
      <div class="row" style="margin-top:8px"><button class="btn block" data-act="close">关闭</button></div>`);
  }

  /* 编辑菜谱：三块文本，改完解析回结构 */
  function linesOf(arr, fmt) { return arr.map(fmt).join('\n'); }
  /* 食材名 → key；菜谱里没有的就新建一个自定义食材 */
  function keyOfName(name) {
    const hit = Object.values(C.ING).find(i => i.name === name);
    if (hit) return hit.key;
    const key = 'xc' + Math.random().toString(36).slice(2, 8);
    const obj = { key, name, cat: '其他', shelf: 7, freeze: 0, unit: null, per: null, sku: null, pantry: false, kcal: 0, custom: true };
    S.customIng = S.customIng || []; S.customIng.push(obj); C.ING[key] = obj;
    return key;
  }
  const SEASON_G = { '勺': 12, '茶匙': 5, '碗': 150, '朵': 4, '片': 3, '根': 1.5, '段': 1.5, '块': 10, '个': 50, '颗': 5, 'g': 1, 'ml': 1 };
  function parseRows(txt, isSeason) {
    const out = [];
    (txt || '').split('\n').forEach(line => {
      const s = line.trim(); if (!s) return;
      const opt = /可选/.test(s);
      const clean = s.replace(/[（(]\s*可选\s*[)）]/g, ' ').replace(/\s+/g, ' ').trim();
      const m = clean.match(/^(.+?)\s+([\d.]+)\s*(\S*)$/);
      if (!m) { out.push({ bad: s }); return; }
      const name = m[1].trim();
      const num1 = +m[2] || 0;
      const unit = m[3] || 'g';
      const key = keyOfName(name);
      if (isSeason) {
        const per = SEASON_G[unit] == null ? (unit === 'g' || unit === 'ml' ? 1 : 5) : SEASON_G[unit];
        out.push({ key, name, qty: num1, unit, g: Math.round(num1 * per * 10) / 10 });
      } else {
        /* 第一个数字是克数；后面若还跟了“1.5根”这种，就同时记下个数 */
        let qty = 0, u = 'g';
        const um = String(m[3] || '').match(/^([\d.]+)\s*(\S*)$/);
        if (um) { qty = +um[1] || 0; u = um[2] || 'g'; }
        out.push({ key, name, g: num1, qty, unit: u, opt });
      }
    });
    return out;
  }
  function sheetEditDish(id) {
    const d = dishById(id); if (!d) return;
    const ingTxt = linesOf(d.ing, x => `${x.name} ${Math.round(x.g * 10) / 10}${x.unit && x.unit !== 'g' ? ' ' + (x.qty || '') + x.unit : ''}`);
    const seaTxt = linesOf(d.season, x => `${x.name} ${x.qty ? unitTxt(x.qty) + (x.unit || '') : num(x.g) + 'g'}`);
    const stpTxt = linesOf(d.steps, s => s);
    showSheet(`
      <h2>改菜谱</h2>
      <div class="sheet-sub">${esc(d.name)} · 一行一样，改完点保存</div>
      <div class="muted" style="margin:10px 2px 4px">名称 / 分钟 / 每份热量</div>
      <div class="row" style="gap:8px">
        <input type="text" id="ed-name" value="${esc(d.name)}" style="flex:2">
        <input type="number" id="ed-min" value="${d.min}" style="flex:1">
        <input type="number" id="ed-kcal" value="${d.kcal}" style="flex:1">
      </div>
      <div class="muted" style="margin:12px 2px 4px">食材（名称 + 克数，可加“ 3瓣”这种个数写法）</div>
      <textarea id="ed-ing" rows="6">${esc(ingTxt)}</textarea>
      <div class="muted" style="margin:12px 2px 4px">调料（名称 + 数量/单位）</div>
      <textarea id="ed-sea" rows="4">${esc(seaTxt)}</textarea>
      <div class="muted" style="margin:12px 2px 4px">做法（一行一步）</div>
      <textarea id="ed-stp" rows="7">${esc(stpTxt)}</textarea>
      <div class="row" style="margin-top:14px;gap:8px">
        <button class="btn primary block" data-act="savedish" data-arg="${d.id}">保存</button>
      </div>
      <div class="row" style="margin-top:8px"><button class="btn ghost block" data-act="dish" data-arg="${d.id}">取消</button></div>`);
  }

  let pickQ = '', pickKind = '';
  function sheetPicker(date) {
    const cur = mealForDate(date);
    const list = Object.values(DISH).filter(d => !archIds().has(d.id)).filter(d =>
      (!pickKind || d.kind === pickKind) &&
      (!pickQ || d.name.includes(pickQ) || d.ing.some(i => i.name.includes(pickQ))));
    const rows = list.slice(0, 60).map(d => {
      const b = C.batchesOf(S.weekStart)[C.batchIndexOf(S.weekStart, date)];
      const age = C.dspan(b.deliver, date);
      const risky = C.shelfOf(d) < age + 1;
      return `<div class="pick-item" data-act="pick" data-arg="${date}|${d.id}">
        <div style="flex:1"><div class="nm">${esc(d.name)}</div>
        <div class="mt">${KIND[d.kind]} · ${d.min}分 · ${d.kcal}kcal${risky ? ' · <span style="color:#b7791f">保质期可能不够</span>' : ''}</div></div>
        <span class="muted">${C.yuan(C.dishCost(d))}</span></div>`;
    }).join('');
    showSheet(`
      <h2>换一道菜</h2>
      <div class="sheet-sub">${date} · ${cur && cur.status === 'out' ? '当前是外食' : ''}</div>
      <input type="text" id="pickq" placeholder="搜菜名或食材" value="${esc(pickQ)}">
      <div class="chips" style="margin-top:10px">
        ${['', 'meat', 'half', 'veg', 'onepot'].map(k =>
          `<button class="chip ${pickKind === k ? 'on' : ''}" data-act="pickkind" data-arg="${k}">${k ? KIND[k] : '全部'}</button>`).join('')}
      </div>
      <div style="margin-top:6px">${rows}</div>`);
    const q = $('#pickq');
    q.oninput = e => { pickQ = e.target.value; sheetPicker(date); $('#pickq').focus(); };
  }

  function sheetAddInv() {
    const opts = Object.values(ING).filter(i => i.sku).map(i => `<option value="${i.key}">${esc(i.name)}</option>`).join('');
    const mine = (S.customIng || []).map(i => `<option value="${i.key}">${esc(i.name)}</option>`).join('');
    showSheet(`
      <h2>记一笔库存</h2>
      <div class="sheet-sub">比如：鸡蛋 10 枚、牛肉 2000g 冷冻 60 天</div>
      <label class="fld">食材</label>
      <select id="invkey">${opts}${mine}<option value="__new__">＋ 菜谱里没有的，新建一个…</option></select>
      <div id="newbox" style="display:none">
        <label class="fld">它叫什么</label><input type="text" id="newname" placeholder="比如：藕、秋葵、无糖酸奶">
        <label class="fld">归类</label>
        <select id="newcat">${ING_CATS.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
        <div class="hint" style="margin-top:6px">归到「肉禽蛋／水产／蔬菜」这类会出现在采购清单的排序里；以后菜谱用不到它，只用来记库存也行。</div>
      </div>
      <label class="fld">数量</label>
      <div class="row" style="gap:8px">
        <input type="number" id="invg" value="1" style="flex:1">
        <select id="invunit" style="width:104px"></select>
      </div>
      <label class="fld">还能放几天</label><input type="number" id="invdays" value="7">
      <div class="row" style="margin-top:14px"><button class="btn primary block" data-act="saveinv">保存</button></div>`);
    const sel = $('#invkey'), un = $('#invunit'), gEl = $('#invg'), dEl = $('#invdays');
    const box = $('#newbox');
    const sync = () => {
      const isNew = sel.value === '__new__';
      box.style.display = isNew ? 'block' : 'none';
      const it = isNew ? {} : (ING[sel.value] || {});
      const units = ['g'].concat(it.unit ? [it.unit] : []);
      un.innerHTML = units.map(u => `<option value="${u}">${u === 'g' ? '克' : u}</option>`).join('');
      gEl.value = isNew ? 500 : (it.unit && it.per ? 1 : (it.sku && it.sku.specG ? it.sku.specG : 500));
      dEl.value = isNew ? 7 : (it.freeze > 0 ? Math.min(60, it.freeze) : (it.shelf || 7));
    };
    sel.onchange = sync; sync();
  }

  function sheetEditInv(id) {
    const x = (S.inventory || []).find(v => v.id === id); if (!x) return;
    const it = ING[x.key] || {};
    const byPiece = it.unit && it.per && it.per >= 15;
    const days = x.exp ? Math.max(0, C.dspan(today(), x.exp)) : 7;
    showSheet(`
      <h2>${esc(it.name || x.key)}</h2>
      <div class="sheet-sub">${x.exp ? '现在记的是 ' + x.exp + ' 到期' : '没记保质期'}</div>
      <label class="fld">数量</label>
      <div class="row" style="gap:8px">
        <input type="number" id="edg" value="${byPiece ? Math.round(x.g / it.per * 10) / 10 : x.g}" style="flex:1">
        <select id="edunit" style="width:104px">
          ${(byPiece ? [it.unit, 'g'] : ['g']).map(u => `<option value="${u}">${u === 'g' ? '克' : u}</option>`).join('')}
        </select>
      </div>
      <label class="fld">还能放几天</label><input type="number" id="eddays" value="${days}">
      <div class="row" style="margin-top:14px"><button class="btn primary block" data-act="saveedit" data-arg="${id}">保存</button></div>
      <div class="row" style="margin-top:8px"><button class="btn danger block" data-act="delinv" data-arg="${id}">删除这条</button></div>`);
  }

  /* ---------------- 动作 ---------------- */
  const riceFor = kind => (kind === 'onepot' ? 0 : C.constraints(S).riceDefault);
  function sheetPaid() {
    const sh = C.shopping(S.weekStart, S), b = sh.batches[shopBatch];
    const est = b.total, raw = b.rawTotal || est;
    showSheet(`
      <h2>回填实付</h2>
      <div class="sheet-sub">${b.name} · ${b.deliver} · 预估 ${C.yuan(est)}（标价 ${C.yuan(raw)}）</div>
      <label class="fld">七鲜实际付了多少钱</label>
      <input type="number" id="paidv" value="${est.toFixed(2)}" step="0.01">
      <div class="hint" style="margin-top:8px">填完以后，所有金额都按这个比例缩放（含运费前的标价口径），下次估价就更准。</div>
      <div class="row" style="margin-top:14px"><button class="btn primary block" data-act="setpaid">保存校准</button></div>`);
    const el = $('#paidv'); el.focus(); el.select();
  }

  function setMeal(date, patch) {
    const ws = C.mondayOf(date);                       // 按这一天所在的那一周存，跨周也对
    const p = S.plans[ws] || (S.plans[ws] = { weekStart: ws, days: [] });
    let m = p.days.find(x => x.date === date);
    if (!m) { m = { date, dishes: [], status: 'empty', locked: false, rice: 0 }; p.days.push(m); p.days.sort((a, b) => a.date.localeCompare(b.date)); }
    Object.assign(m, patch);
    if (m.dishes && m.dishes.length) {
      const d = DISH[m.dishes[0]];
      m.kind = d.kind; m.min = d.min; m.protein = C.mainProtein(d);
      m.age = C.dspan(C.batchesOf(ws)[C.batchIndexOf(ws, date)].deliver, date);
    }
    save(); render();
  }

  function regenerate() {
    const weeks = [];
    for (let i = 0; i <= 1; i++) weeks.push(C.mondayOf(C.addD(S.weekStart, i * 7)));
    weeks.forEach(ws => {
      const old = plan(ws);
      const locked = old ? old.days.filter(m => m.locked && m.dishes.length) : [];
      const np = C.generate(ws, S);
      const usedByLocked = new Set(locked.map(m => m.dishes[0]));
      locked.forEach(lm => {
        const slot = np.days.find(x => x.date === lm.date);
        if (slot) { Object.assign(slot, lm); }
      });
      np.days.forEach(m => {
        if (locked.some(l => l.date === m.date)) return;
        if (usedByLocked.has(m.dishes[0])) {
          const alt = Object.values(DISH).filter(d => !usedByLocked.has(d.id) && d.min <= (C.dow(m.date) % 6 === 0 ? S.settings.weekendMax : S.settings.weekdayMax));
          if (alt.length) { m.dishes = [alt[Math.floor(Math.random() * alt.length)].id]; const d = DISH[m.dishes[0]]; m.protein = C.mainProtein(d); m.rice = riceFor(d.kind); }
        }
      });
      S.plans[ws] = np;
    });
    save(); render();
    toast('往后两周都排好了');
  }

  const ACT = {
    meal: d => sheetMeal(d),
    dish: id => sheetDish(id, S.profiles.length),
    close: () => hideSheet(),
    picker: d => sheetPicker(d),
    pickkind: k => { pickKind = k; sheetPicker(CURRENT_PICK); },
    pick: a => { const [date, id] = a.split('|'); const d = DISH[id]; setMeal(date, { dishes: [id], status: 'cook', rice: riceFor(d.kind) }); hideSheet(); toast('已换成 ' + d.name); },
    out: d => { const m = mealForDate(d); setMeal(d, { status: m && m.status === 'out' ? 'cook' : 'out' }); hideSheet(); toast(m && m.status === 'out' ? '改回在家吃' : '这顿外食，食材留到下一顿'); },
    lock: d => { const m = mealForDate(d); setMeal(d, { locked: !(m && m.locked) }); hideSheet(); },
    rice: d => { const m = mealForDate(d); setMeal(d, { rice: ((m && m.rice) || 0) + 1 > 4 ? 0 : ((m && m.rice) || 0) + 1 }); sheetMeal(d); },
    staple: d => {
      const m = mealForDate(d);
      const cur = C.stapleOf(S, m).id;
      setMeal(d, { staple: cur === 'brown' ? 'white' : 'brown' });
      sheetMeal(d);
      toast(cur === 'brown' ? '这顿换成白米饭' : '这顿换成糙米饭');
    },
    clear: d => { setMeal(d, { dishes: [], status: 'empty', rice: 0 }); hideSheet(); },
    regen: () => { if (plan(S.weekStart) && !confirm('重新排会覆盖没锁定的安排，继续？')) return; regenerate(); },
    batch: i => { shopBatch = +i; viewShop(); },
    chk: a => { const [bi, key] = a.split(':'); const k = S.weekStart + ':' + bi; S.checked[k] = S.checked[k] || {}; S.checked[k][key] = !S.checked[k][key]; save(); viewShop(); },
    libkind: k => { libKind = k; viewLib(); },
    libtab: k => { libTab = k; viewLib(); },
    newfresh: () => { newPage += 1; libQ = ''; viewLib(); try { window.scrollTo(0, 0); } catch (e) {} },
    hist: () => { histOpen = !histOpen; viewWeek(); },
    eaters: d => {
      const m = mealForDate(d) || mealAt(C.mondayOf(d), d);
      if (!m) return;
      const ps = S.profiles || [{ id: 'p1' }];
      const cur = (m.eaters && m.eaters.length) || S.settings.eatersDefault || 1;
      const next = cur >= ps.length ? 1 : cur + 1;
      m.eaters = ps.slice(0, next).map(p => p.id);
      save(); sheetMeal(d);
      toast(next === 1 ? '这顿按 1 人份算' : `这顿按 ${next} 人份算`);
    },
    editdish: id => sheetEditDish(id),
    savedish: id => {
      const d = dishById(id); if (!d) return;
      const name = ($('#ed-name').value || '').trim() || d.name;
      const mins = +$('#ed-min').value || d.min;
      const rows = parseRows($('#ed-ing').value, false);
      const bad = rows.filter(x => x.bad);
      const ing = rows.filter(x => !x.bad);
      if (bad.length) return toast('食材这行看不懂：' + bad[0].bad);
      if (!ing.length) return toast('食材不能是空的');
      const sea = parseRows($('#ed-sea').value, true).filter(x => !x.bad);
      const steps = ($('#ed-stp').value || '').split('\n').map(s => s.trim()).filter(Boolean);
      const kcal = Math.round(ing.reduce((a, x) => {
        const it = C.ING[x.key];
        return a + (it && it.kcal ? x.g / 100 * it.kcal : 0);
      }, 0));
      const nd = Object.assign({}, d, {
        name, min: mins, ing, season: sea, steps,
        kcal: kcal > 0 ? kcal : d.kcal,
        src: d.src || 'custom'
      });
      S.custom = (S.custom || []).filter(x => x.id !== id);
      S.custom.push(nd);
      C.hydrateCustom(S);
      save();
      sheetDish(id, 1);
      toast('已保存，采购和热量都跟着更新了');
    },
    addcustom: id => {
      const d = (C.SUGGEST || []).find(x => x.id === id);
      if (!d || customIds().has(id)) return;
      S.custom = S.custom || [];
      S.custom.push(d);
      C.hydrateCustom(S);
      save();
      libTab = 'mine'; libKind = ''; libQ = '';
      viewLib();
      toast(`${d.name} 已加进菜谱`);
    },
    buy: bi => {
      const sh = C.shopping(S.weekStart, S), b = sh.batches[+bi];
      if (!b) return;
      S.ordered = S.ordered || {};
      if (b.ordered) {                       // 点第二次 = 撤销
        const rec = S.ordered[b.deliver];
        if (rec && rec.added) {
          const back = {};
          rec.added.forEach(x => { back[x.key] = (back[x.key] || 0) + x.g; });
          C.consumeInv(S, back);
        }
        delete S.ordered[b.deliver];
        save(); viewShop(); toast('已撤销，库存扣回去了'); return;
      }
      if (!b.items.length) return toast('这单没有要买的东西');
      const added = [];
      b.items.forEach(x => {
        const g = x.packs * x.specG;
        C.addInv(S, x.key, g);
        added.push({ key: x.key, g });
      });
      S.ordered[b.deliver] = { at: today(), total: b.pay, added };
      save(); viewShop();
      toast(`已记进库存：${added.length} 样`);
    },
    done: d => {
      const m = mealForDate(d);
      if (!m || !(m.dishes || []).length) return toast('这顿还没排菜');
      if (m.done) {                          // 撤销：把扣掉的加回去
        const back = m.deducted || {};
        Object.keys(back).forEach(k => C.addInv(S, k, back[k]));
        setMeal(d, { done: false, deducted: null });
        save(); sheetMeal(d); toast('已撤销，库存加回去了'); return;
      }
      const needs = C.mealNeeds(S, m);
      const r = C.consumeInv(S, needs);
      setMeal(d, { done: true, deducted: r.used });
      save(); sheetMeal(d);
      const n = Object.keys(r.used).length, s = Object.keys(r.short).length;
      toast(s ? `已扣库存 ${n} 样，其中 ${s} 样库存不够` : `已扣库存 ${n} 样`);
    },
    paid: i => sheetPaid(+i),
    setpaid: () => {
      const v = +$('#paidv').value;
      if (!(v > 0)) return toast('填一下实付金额');
      const sh = C.shopping(S.weekStart, S), b = sh.batches[shopBatch];
      const f = Math.max(0.5, Math.min(1.3, v / (b.rawTotal || b.total || 1)));
      S.priceFactor = Math.round(f * 1000) / 1000;
      S.paid = S.paid || {};
      S.paid[S.weekStart + ':' + (b.order || shopBatch)] = { est: b.total, paid: Math.round(v * 100) / 100, at: today() };
      save(); hideSheet(); viewShop();
      toast(`已校准：以后按标价的 ${Math.round(S.priceFactor * 100)}% 估`);
    },
    resetprice: () => { S.priceFactor = 1; S.paid = {}; save(); viewShop(); toast('已恢复七鲜标价'); },
    setrice: v => { S.settings.riceGrams = Math.max(30, Math.min(500, +v || 130)); save(); viewSet(); },
    setmeat: n => { S.settings.meatPerWeek = +n; save(); viewSet(); },
    shopmode: m => { S.settings.shopMode = m === 'week' ? 'week' : 'auto'; shopBatch = 0; save(); viewSet(); },
    setstaple: k => { S.settings.staple = k; save(); viewSet(); },
    seteaters: n => { S.settings.eatersDefault = +n; save(); viewSet(); },
    goto: t => { S.tab = t; if (t === 'shop') shopBatch = -1; save(); render(); },
    addprofile: () => { S.profiles.push({ id: 'p' + Date.now(), name: '家人', portion: 1 }); save(); viewSet(); },
    delprofile: i => {
      if (S.profiles.length <= 1) return toast('至少留一个人');
      const gone = S.profiles[+i];
      S.profiles.splice(+i, 1);
      /* 从各天的"谁吃"里去掉，别留孤儿 id */
      Object.values(S.plans || {}).forEach(p => (p.days || []).forEach(m => {
        if (m.eaters) { m.eaters = m.eaters.filter(x => x !== gone.id); if (!m.eaters.length) delete m.eaters; }
      }));
      if ((S.settings.eatersDefault || 1) > S.profiles.length) S.settings.eatersDefault = S.profiles.length;
      save(); viewSet(); renderTop(); toast(`已删除 ${gone.name}`);
    },
    addinv: () => sheetAddInv(),
    saveinv: () => {
      let key = $('#invkey').value;
      const v = +$('#invg').value || 0;
      const u = $('#invunit').value;
      const days = +$('#invdays').value || 7;
      if (key === '__new__') {
        const nm = ($('#newname').value || '').trim();
        if (!nm) return toast('先给它起个名字');
        const cat = $('#newcat').value;
        key = 'x' + Date.now().toString(36);
        const made = { key, name: nm, cat, shelf: days, freeze: 0, unit: null, per: null, sku: null, pantry: false, kcal: 0, custom: true };
        S.customIng = S.customIng || [];
        S.customIng.push(made);
        C.ING[key] = made;
      }
      const it = ING[key] || {};
      const g = u === 'g' || !it.per ? v : Math.round(v * it.per * 10) / 10;
      S.inventory.push({ id: uid(), key, g, exp: C.addD(today(), days) });
      save(); hideSheet(); render();
      toast(it.custom ? '已记录，下次能直接选它' : '已记录');
    },
    archive: id => {
      const d = dishById(id); if (!d) return;
      S.archived = S.archived || [];
      if (S.archived.indexOf(id) < 0) S.archived.push(id);
      save();
      const inPlan = (plan(S.weekStart) || { days: [] }).days.some(m => (m.dishes || []).indexOf(id) >= 0);
      libTab = 'mine'; viewLib();
      toast(inPlan ? `${d.name} 已移出（本周计划里还在，想换掉点那顿）` : `${d.name} 已移到备选库`);
    },
    restore: id => {
      S.archived = (S.archived || []).filter(x => x !== id);
      save(); hideSheet();
      if (S.tab === 'lib') { libTab = 'arch'; viewLib(); } else render();
      toast('已加回菜谱');
    },
    editinv: id => sheetEditInv(id),
    saveedit: id => {
      const x = (S.inventory || []).find(v => v.id === id); if (!x) return;
      const it = ING[x.key] || {};
      const v = +$('#edg').value || 0, u = $('#edunit').value;
      x.g = (u === 'g' || !it.per) ? v : Math.round(v * it.per * 10) / 10;
      x.exp = C.addD(today(), Math.max(0, +$('#eddays').value || 0));
      save(); hideSheet(); render(); toast('已更新');
    },
    ptoggle: key => { if (S.pantry[key] === 'low') delete S.pantry[key]; else S.pantry[key] = 'low'; save(); viewInv(); },
    delinv: id => {
      const x = (S.inventory || []).find(v => v.id === id);
      S.inventory = (S.inventory || []).filter(v => v.id !== id);
      save(); hideSheet(); render();
      toast(x ? `已删除 ${(ING[x.key] || {}).name || x.key}` : '已删除');
    },
    export: () => {
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `晚饭计划-${today()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    },
    import: () => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json';
      inp.onchange = () => {
        const f = inp.files[0]; if (!f) return;
        const r = new FileReader();
        r.onload = () => { try { const o = JSON.parse(r.result); Object.assign(S, o); save(); render(); toast('已导入'); } catch (e) { toast('文件读不出来'); } };
        r.readAsText(f);
      };
      inp.click();
    },
    reset: () => { if (confirm('确定清空所有计划和库存？')) { S = DEF(); save(); render(); } },
    copy: i => {
      const sh = C.shopping(S.weekStart, S), b = sh.batches[+i];
      const txt = C.copyText(b);
      const done = () => toast('已复制，去七鲜粘贴搜');
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, () => fallbackCopy(txt, done));
      else fallbackCopy(txt, done);
    }
  };
  let CURRENT_PICK = null;
  function fallbackCopy(txt, cb) {
    const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); cb(); } catch (e) { toast('复制失败，长按选择'); }
    document.body.removeChild(ta);
  }

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || !ACT[el.dataset.act]) return;
    const a = el.dataset.act;
    if (a === 'picker') CURRENT_PICK = el.dataset.arg;
    if (a === 'pickkind') CURRENT_PICK = CURRENT_PICK || null;
    ACT[a](el.dataset.arg);
  });
  document.querySelectorAll('#tabbar button').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; if (S.tab === 'shop') shopBatch = -1; save(); render(); window.scrollTo(0, 0); });
  $('#btnPrev').onclick = () => { S.weekStart = C.addD(S.weekStart, -7); shopBatch = -1; save(); render(); };
  $('#btnNext').onclick = () => { S.weekStart = C.addD(S.weekStart, 7); shopBatch = -1; save(); render(); };

  const h0 = (() => { try { return (location.hash || '').replace('#', ''); } catch (e) { return ''; } })();
  if (TABS.indexOf(h0) >= 0) { S.tab = h0; if (h0 === 'shop') shopBatch = -1; }
  render();
  if (!S.seen) { S.seen = true; save(); }
  try {
    window.addEventListener('hashchange', () => {
      const h = (location.hash || '').replace('#', '');
      if (TABS.indexOf(h) >= 0 && h !== S.tab) { S.tab = h; render(); }
    });
  } catch (e) {}
  // 调试入口：?ui=dish:d_xxx / meal:2026-11-02 / pick:2026-11-02，?demo=1 自动排一周，方便截图和验收
  try {
    const qs = new URLSearchParams(location.search);
    if (qs.get('demo') && !S.plans[S.weekStart]) regenerate();
    const ui = qs.get('ui');
    if (ui) {
      if (ui.startsWith('dish:')) sheetDish(ui.slice(5), 1);
      else if (ui.startsWith('edit:')) sheetEditDish(ui.slice(5));
      else if (ui.startsWith('lib:')) { S.tab = 'lib'; libTab = ui.slice(4) || 'mine'; render(); }
      else if (ui === 'addp') { S.profiles.push({ id: 'px' + Date.now(), name: '家人', portion: 1 }); S.tab = 'set'; save(); render(); }
      else if (ui.startsWith('meal:')) sheetMeal(ui.slice(5));
      else if (ui.startsWith('pick:')) sheetPicker(ui.slice(5));
    }
  } catch (e) {}

  // 测试钩子（浏览器里无副作用，node 里用来驱动渲染做断言）
  window.__app = {
    ACT, render, sheetDish, sheetMeal, sheetPicker, showSheet, hideSheet,
    get state() { return S; }, set state(v) { S = v; }, save
  };
})();
