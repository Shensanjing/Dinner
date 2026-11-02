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

  /* ---------------- 状态 ---------------- */
  function seedInventory() {
    const d = (n) => C.addD(today(), n);
    return [
      { key: 'brown_rice', g: 5000, exp: d(180) }, { key: 'garlic', g: 250, exp: d(45) },
      { key: 'ginger', g: 200, exp: d(25) }, { key: 'scallion', g: 300, exp: d(12) },
      { key: 'egg', g: 1650, exp: d(21) }, { key: 'wood_ear', g: 80, exp: d(300) },
      { key: 'flour', g: 1000, exp: d(200) }
    ];
  }
  const DEF = () => ({
    v: 3, tab: 'week', weekStart: C.mondayOf(today()),
    plans: {}, inventory: seedInventory(), pantry: {}, custom: [],
    profiles: [{ id: 'p1', name: '我', portion: 1 }],
    settings: {
      weekdayMax: 40, weekendMax: 60, riceGrams: 130, spicyNights: 3,
      meatPerWeek: 3, staple: 'brown'
    },
    skuOverride: {}, checked: {}, batch: 0, seen: false, priceFactor: 1, paid: {}
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
  C.hydrateCustom(S);   // 用户自己收进菜谱的菜要能被排期和采购认出来
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
      const p = plan(ws);
      if (p) {
        const n = p.days.filter(m => m.status === 'cook' && m.dishes.length).length;
        const out = p.days.filter(m => m.status === 'out').length;
        s += ` · 已排 ${n} 顿` + (out ? `，外食 ${out} 顿` : '');
      } else s += ' · 还没有排';
    }
    if (S.tab === 'shop') {
      const sh = C.shopping(ws, S);
      const t = sh.batches.reduce((a, b) => a + b.pay, 0);
      if (sh.batches.length) s += ` · 预计 ${C.yuan(t)}`;
    }
    if (S.tab === 'lib') s = `${Object.keys(DISH).length} 道家常菜`;
    if (S.tab === 'inv') s = S.inventory.length ? `${S.inventory.length} 样在库` : '还没有记录';
    $('#subtitle').textContent = s;
    const nav = S.tab === 'week' || S.tab === 'shop';
    $('#btnPrev').style.display = $('#btnNext').style.display = nav ? '' : 'none';
    document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
  }

  /* ---------------- 本周 ---------------- */
  function freshBadge(m) {
    const age = m.age || 0;
    if (m.status !== 'cook') return '';
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
        <span class="sp"></span>${freshBadge(m)}${m.locked ? '<span class="badge">🔒 锁定</span>' : ''}
      </div>${inner}</div>`;
  }
  function viewWeek() {
    const p = plan(S.weekStart);
    if (!p) {
      $('#view').innerHTML = `
        <div class="card" style="text-align:center;padding:22px 16px">
          <div style="font-size:15px;margin-bottom:6px">这一周还没排菜</div>
          <div class="muted" style="margin-bottom:14px">按保质期和两次到货时间自动排 7 顿晚饭</div>
          <button class="btn primary block" data-act="regen">一键排这周</button>
        </div>
        <div class="sec-title">也可以一顿一顿自己点</div>
        ${[0, 1, 2, 3, 4, 5, 6].map(i => mealCard({ date: C.addD(S.weekStart, i), status: 'empty', dishes: [] })).join('')}`;
      return;
    }
    const cook = p.days.filter(m => m.status === 'cook' && m.dishes.length);
    const kcal = cook.reduce((a, m) => a + C.mealKcal(S, m), 0);
    const cost = cook.reduce((a, m) => { const d = DISH[m.dishes[0]]; return a + (d ? C.dishCost(d) : 0); }, 0);
    $('#view').innerHTML = `
      <div class="card" style="padding:11px 14px">
        <div class="row"><span class="muted">本周 ${cook.length} 顿 · 食材约 ${C.yuan(cost)} · 人均 ${Math.round(kcal / Math.max(1, cook.length))} kcal/顿</span>
        <span class="sp"></span><button class="btn" style="padding:6px 11px;font-size:13px" data-act="regen">重排</button></div>
      </div>
      ${p.days.map(mealCard).join('')}
      <div class="muted center" style="margin:14px 0 4px">点任意一天可换菜 / 外食 / 锁定</div>`;
  }

  /* ---------------- 采购 ---------------- */
  let shopBatch = 0;
  function viewShop() {
    const sh = C.shopping(S.weekStart, S);
    if (!sh.batches.length) {
      $('#view').innerHTML = `<div class="card" style="text-align:center;padding:22px">
        <div style="margin-bottom:6px">还没有排菜，先排一周</div>
        <button class="btn primary" data-act="goto" data-arg="week">去排菜</button></div>`;
      return;
    }
    const bi = Math.min(shopBatch, sh.batches.length - 1);
    const b = sh.batches[bi];
    const checked = S.checked[S.weekStart + ':' + bi] || {};
    const pct = Math.min(100, b.total / 39 * 100);
    const items = b.items.map(x => {
      const on = checked[x.key];
      const pack = x.rest >= x.specG * 0.45
        ? `<span class="badge warn">整包 ${x.specG}g · 剩 ${x.rest}g</span>` : '';
      return `<div class="item ${on ? 'done' : ''}" data-act="chk" data-arg="${bi}:${x.key}">
        <div class="cb ${on ? 'on' : ''}">✓</div>
        <div style="flex:1;min-width:0">
          <div class="nm">${esc(x.name)} ×${x.packs} ${pack}</div>
          <div class="sk">${esc(x.sku)}${x.real ? '' : ' · 估价'} · 这单用 ${x.gross}g${x.carry ? `（上单剩 ${x.carry}g 已抵扣）` : ''}</div>
        </div>
        <div class="pr">${C.yuan(x.unit * x.packs)}</div></div>`;
    }).join('');
    const f = b.gap > 0 && b.items.length ? C.fillers(b).slice(0, 4) : [];
    const fSum = f.reduce((a, x) => a + x.price, 0);
    const fAll = b.total + fSum;
    const fix = f.find(x => x.price >= b.gap);            // 加它就能过 39
    const sumCard = b.items.length ? `
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
      </div>` : `
      <div class="card sum-card">
        <div style="font-size:15px;font-weight:600;margin-bottom:4px">这一单不用下单</div>
        <div class="muted">${b.note}。这几顿要用的食材，家里还有或者上一单的整包够用，不用再花钱。</div>
        <div class="covers">本来要吃 ${b.covers.length} 顿：${b.covers.map(c =>
          `<span class="${c.week === 'adj' ? 'adj' : ''}">${C.WEEK_CN[C.dow(c.date)]} ${C.md(c.date)}</span>`).join(' · ')}</div>
      </div>`;
    $('#view').innerHTML = `
      <div class="batch-tabs">${sh.batches.map((x, i) =>
        `<button class="chip ${i === bi ? 'on' : ''}" data-act="batch" data-arg="${i}">${x.name}</button>`).join('')}</div>
      ${sumCard}
      ${f.length ? `<div class="sec-title">凑单建议（耐放的，凑满 ¥39）</div><div class="card" style="padding:8px 14px">
        ${f.map(x => `<div class="row" style="padding:5px 0"><span>${esc(x.name)}</span>${x === fix ? ' <span class="badge">加它就够</span>' : ''}<span class="sp"></span>
          <span class="muted">${esc(x.spec)}</span><b style="margin-left:8px">¥${x.price}</b></div>`).join('')}
        <div class="muted" style="margin-top:6px;border-top:1px dashed var(--line);padding-top:6px">
          全加 ¥${fSum.toFixed(2)} → 合计 ${C.yuan(fAll)}${fAll >= 39 ? '，免运费' : `，仍差 ${C.yuan(39 - fAll)}`}</div></div>` : ''}
      <div class="sec-title">要买 ${b.items.length} 样</div>
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
      <div class="row" style="margin:14px 0"><button class="btn primary block" data-act="copy" data-arg="${bi}">复制清单</button></div>
      <div class="hint">买完回来点「回填实付」，填一次七鲜的真实扣款，之后所有估价都按你的券后价来（现在是 ${
        b.factor === 1 ? '标价' : '标价的 ' + Math.round(b.factor * 100) + '%'}）。</div>`;
  }

  /* ---------------- 菜库 ---------------- */
  let libQ = '', libKind = '', libTab = 'mine';
  const customIds = () => new Set((S.custom || []).map(d => d.id));
  function viewLib() {
    const mine = Object.values(DISH).filter(d => !d.src || d.src !== 'suggest' || customIds().has(d.id));
    const fresh = (C.SUGGEST || []).filter(d => !customIds().has(d.id));
    const base = libTab === 'new' ? fresh : mine;
    const list = base.filter(d =>
      (!libKind || d.kind === libKind) &&
      (!libQ || d.name.includes(libQ) || d.ing.some(i => i.name.includes(libQ))));
    $('#view').innerHTML = `
      <div class="chips" style="margin-bottom:8px">
        <button class="chip ${libTab === 'mine' ? 'on' : ''}" data-act="libtab" data-arg="mine">我的菜谱 ${mine.length}</button>
        <button class="chip ${libTab === 'new' ? 'on' : ''}" data-act="libtab" data-arg="new">新菜推荐 ${fresh.length}</button>
      </div>
      <input type="text" id="libq" placeholder="搜菜名或食材，比如：茄子" value="${esc(libQ)}">
      <div class="chips" style="margin-top:10px">
        ${['', 'meat', 'half', 'veg', 'onepot'].map(k =>
          `<button class="chip ${libKind === k ? 'on' : ''}" data-act="libkind" data-arg="${k}">${k ? KIND[k] : '全部'}</button>`).join('')}
      </div>
      <div class="muted" style="margin:2px 2px 8px">${list.length} 道${libTab === 'new' ? ' · 没做过的，试过觉得行就收进菜谱' : ''}</div>
      ${list.map(d => `<div class="card" style="padding:11px 14px" data-act="dish" data-arg="${d.id}">
        <div class="row"><span class="dish-name" style="font-size:15.5px">${esc(d.name)}</span>
        ${libTab === 'new' ? '<span class="badge warn">未尝试</span>' : ''}
        ${d.spice >= 2 ? '<span class="badge spicy">辣</span>' : ''}
        <span class="sp"></span><span class="muted">${d.kcal} kcal</span></div>
        <div class="dish-meta">${KIND[d.kind]} · ${d.min} 分钟 · ${d.ing.length} 种食材 · ${C.yuan(C.dishCost(d))}${
          libTab === 'new' ? ` · <span class="link" data-act="addcustom" data-arg="${d.id}">加进我的菜谱</span>` : ''}</div>
      </div>`).join('')}`;
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
      <div class="card">${items.map((x, i) => {
        const it = ING[x.key] || {};
        const left = x.exp ? C.dspan(today(), x.exp) : null;
        const soon2 = left !== null && left <= 2;
        return `<div class="item">
          <div style="flex:1"><div class="nm">${esc(it.name || x.key)}</div>
          <div class="sk">${invText(it, x.g)}${x.exp ? ` · <span style="${soon2 ? 'color:#b7791f' : ''}">${left < 0 ? '已过期' : left + ' 天后到期'}</span>` : ''}</div></div>
          <button class="btn" style="padding:5px 10px;font-size:12px" data-act="delinv" data-arg="${i}">删</button>
        </div>`;
      }).join('') || '<div class="muted">还没有记录。买回来的东西先记一笔，排菜时自动扣。</div>'}</div>
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
          </select></div>`).join('')}
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
        v0.3 · 菜谱 53 道 + 20 道新菜推荐；价格为七鲜标价（¥39 免运费，未满 +¥3），可回填实付校准。<br>
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
  function render() {
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
    const m = mealAt(S.weekStart, date) || { date, status: 'empty', dishes: [], rice: 0 };
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
        <button class="act" data-act="out" data-arg="${date}"><span class="em">🍽</span>${m.status === 'out' ? '改成在家吃' : '今天出去吃'}</button>
        <button class="act" data-act="lock" data-arg="${date}"><span class="em">🔒</span>${m.locked ? '解锁这顿' : '锁定这顿（重排时不动）'}</button>
        <button class="act" data-act="rice" data-arg="${date}"><span class="em">🍚</span>${st.name}：${m.rice || 0} 碗${m.rice ? `（生米 ${num(m.rice * st.rawPerBowl)}g）` : ''}</button>
        <button class="act" data-act="staple" data-arg="${date}"><span class="em">🌾</span>这顿换成${st.id === 'brown' ? '白米饭' : '糙米饭'}</button>
        <button class="act danger" data-act="clear" data-arg="${date}"><span class="em">🗑</span>清空这顿</button>
      </div>`);
  }

  function sheetDish(id, eaters) {
    const d = DISH[id]; if (!d) return;
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
      ${d.src === 'suggest' ? `<div class="row" style="margin-top:14px"><button class="btn primary block" data-act="addcustom" data-arg="${d.id}">加进我的菜谱</button></div>` : ''}
      <div class="row" style="margin-top:14px"><button class="btn block" data-act="close">关闭</button></div>`);
  }

  let pickQ = '', pickKind = '';
  function sheetPicker(date) {
    const cur = mealAt(S.weekStart, date);
    const used = new Set();
    (plan(S.weekStart) || { days: [] }).days.forEach(m => { if (m.date !== date) (m.dishes || []).forEach(x => used.add(x)); });
    const list = Object.values(DISH).filter(d =>
      (!pickKind || d.kind === pickKind) &&
      (!pickQ || d.name.includes(pickQ) || d.ing.some(i => i.name.includes(pickQ))));
    const rows = list.slice(0, 60).map(d => {
      const b = C.batchesOf(S.weekStart)[C.batchIndexOf(S.weekStart, date)];
      const age = C.dspan(b.deliver, date);
      const risky = C.shelfOf(d) < age + 1;
      return `<div class="pick-item" data-act="pick" data-arg="${date}|${d.id}">
        <div style="flex:1"><div class="nm">${esc(d.name)} ${used.has(d.id) ? '<span class="muted">·本周已用</span>' : ''}</div>
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
    showSheet(`
      <h2>记一笔库存</h2>
      <div class="sheet-sub">比如：鸡蛋 10 枚、牛肉 2000g 冷冻 60 天</div>
      <label class="fld">食材</label><select id="invkey">${opts}</select>
      <label class="fld">数量</label>
      <div class="row" style="gap:8px">
        <input type="number" id="invg" value="1" style="flex:1">
        <select id="invunit" style="width:104px"></select>
      </div>
      <label class="fld">还能放几天</label><input type="number" id="invdays" value="7">
      <div class="row" style="margin-top:14px"><button class="btn primary block" data-act="saveinv">保存</button></div>`);
    const sel = $('#invkey'), un = $('#invunit'), gEl = $('#invg'), dEl = $('#invdays');
    const sync = () => {
      const it = ING[sel.value] || {};
      const units = ['g'].concat(it.unit ? [it.unit] : []);
      un.innerHTML = units.map(u => `<option value="${u}">${u === 'g' ? '克' : u}</option>`).join('');
      gEl.value = it.unit && it.per ? 1 : (it.sku && it.sku.specG ? it.sku.specG : 500);
      dEl.value = it.freeze > 0 ? Math.min(60, it.freeze) : 7;
    };
    sel.onchange = sync; sync();
  }

  /* ---------------- 动作 ---------------- */
  const riceFor = kind => (kind === 'onepot' ? 0 : C.constraints(S).riceDefault);
  function sheetPaid() {
    const sh = C.shopping(S.weekStart, S), b = sh.batches[Math.min(shopBatch, sh.batches.length - 1)];
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
    const p = S.plans[S.weekStart] || (S.plans[S.weekStart] = { weekStart: S.weekStart, days: [] });
    let m = p.days.find(x => x.date === date);
    if (!m) { m = { date, dishes: [], status: 'empty', locked: false, rice: 0 }; p.days.push(m); p.days.sort((a, b) => a.date.localeCompare(b.date)); }
    Object.assign(m, patch);
    if (m.dishes && m.dishes.length) {
      const d = DISH[m.dishes[0]];
      m.kind = d.kind; m.min = d.min; m.protein = C.mainProtein(d);
      m.age = C.dspan(C.batchesOf(S.weekStart)[C.batchIndexOf(S.weekStart, date)].deliver, date);
    }
    save(); render();
  }

  function regenerate() {
    const old = plan(S.weekStart);
    const locked = old ? old.days.filter(m => m.locked && m.dishes.length) : [];
    const np = C.generate(S.weekStart, S);
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
    S.plans[S.weekStart] = np; save(); render();
    toast('已排好 7 顿');
  }

  const ACT = {
    meal: d => sheetMeal(d),
    dish: id => sheetDish(id, S.profiles.length),
    close: () => hideSheet(),
    picker: d => sheetPicker(d),
    pickkind: k => { pickKind = k; sheetPicker(CURRENT_PICK); },
    pick: a => { const [date, id] = a.split('|'); const d = DISH[id]; setMeal(date, { dishes: [id], status: 'cook', rice: riceFor(d.kind) }); hideSheet(); toast('已换成 ' + d.name); },
    out: d => { const m = mealAt(S.weekStart, d); setMeal(d, { status: m && m.status === 'out' ? 'cook' : 'out' }); hideSheet(); toast(m && m.status === 'out' ? '改回在家吃' : '这顿外食，食材留到下一顿'); },
    lock: d => { const m = mealAt(S.weekStart, d); setMeal(d, { locked: !(m && m.locked) }); hideSheet(); },
    rice: d => { const m = mealAt(S.weekStart, d); setMeal(d, { rice: ((m && m.rice) || 0) + 1 > 4 ? 0 : ((m && m.rice) || 0) + 1 }); sheetMeal(d); },
    staple: d => {
      const m = mealAt(S.weekStart, d);
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
    setstaple: k => { S.settings.staple = k; save(); viewSet(); },
    goto: t => { S.tab = t; save(); render(); },
    addprofile: () => { S.profiles.push({ id: 'p' + Date.now(), name: '家人', portion: 1 }); save(); viewSet(); },
    addinv: () => sheetAddInv(),
    saveinv: () => {
      const key = $('#invkey').value;
      const v = +$('#invg').value || 0;
      const u = $('#invunit').value;
      const it = ING[key] || {};
      const g = u === 'g' || !it.per ? v : Math.round(v * it.per * 10) / 10;
      const days = +$('#invdays').value || 7;
      S.inventory.push({ key, g, exp: C.addD(today(), days) });
      save(); hideSheet(); render(); toast('已记录');
    },
    ptoggle: key => { if (S.pantry[key] === 'low') delete S.pantry[key]; else S.pantry[key] = 'low'; save(); viewInv(); },
    delinv: i => { S.inventory.splice(+i, 1); save(); viewInv(); },
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
  document.querySelectorAll('#tabbar button').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; save(); render(); window.scrollTo(0, 0); });
  $('#btnPrev').onclick = () => { S.weekStart = C.addD(S.weekStart, -7); shopBatch = 0; save(); render(); };
  $('#btnNext').onclick = () => { S.weekStart = C.addD(S.weekStart, 7); shopBatch = 0; save(); render(); };

  const h0 = (() => { try { return (location.hash || '').replace('#', ''); } catch (e) { return ''; } })();
  if (TABS.indexOf(h0) >= 0) S.tab = h0;
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
      else if (ui.startsWith('lib:')) { S.tab = 'lib'; libTab = ui.slice(4) || 'mine'; render(); }
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
