// ===========================================================================
//  ระบบสมุดบัญชีวัดออนไลน์ — โค้ดหลัก
//  ติดต่อฐานข้อมูล Supabase + จัดการหน้าจอทั้งหมด
//  เจ้านายไม่ต้องแก้ไฟล์นี้ (แก้แค่ config.js)
// ===========================================================================

const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.WAT_CONFIG;
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- หมวดหมู่ตามแบบ พศ. ----------
const INCOME_CATEGORIES = [
  'เงินอุดหนุนจากทางราชการ', 'เงินบริจาค/ทำบุญทั่วไป', 'เงินกฐิน', 'เงินผ้าป่า',
  'รายได้จากการจัดงาน', 'ค่าเช่า/ผลประโยชน์ทรัพย์สิน', 'ดอกเบี้ยเงินฝาก', 'รายรับอื่น ๆ',
];
const EXPENSE_CATEGORIES = [
  'ค่าสาธารณูปโภค', 'ค่าบูรณะปฏิสังขรณ์', 'ค่าใช้จ่ายในกิจการศาสนา', 'ค่าใช้จ่ายในการศึกษา',
  'ค่าใช้จ่ายในการเผยแผ่', 'ค่าใช้จ่ายในการสงเคราะห์ประชาชน', 'ค่าใช้จ่ายในการบริหารวัด', 'รายจ่ายอื่น ๆ',
];
const ASSET_CATEGORIES = [
  'ที่ดิน', 'อาคารเสนาสนะ', 'ครุภัณฑ์/อุปกรณ์', 'ยานพาหนะ', 'พระพุทธรูป/ปูชนียวัตถุ', 'อื่น ๆ',
];
const DEPOSIT_TYPES = [
  { value: 'deposit', label: 'ฝากเงิน' },
  { value: 'withdraw', label: 'ถอนเงิน' },
  { value: 'interest', label: 'ดอกเบี้ยรับ' },
];
const THAI_MONTHS = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];

// ---------- สถานะของแอป ----------
let state = {
  user: null,
  temple: null,
  txns: [],
  assets: [],
  deposits: [],
  tab: 'dashboard',
};

// ---------- ฟังก์ชันช่วยจัดรูปแบบ ----------
const $ = (sel) => document.querySelector(sel);
const fmtMoney = (n) => (Number(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayIso = () => new Date().toISOString().slice(0, 10);
function fmtThaiDate(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return iso;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear() + 543}`;
}
function toThaiNum(n) {
  const map = ['๐','๑','๒','๓','๔','๕','๖','๗','๘','๙'];
  return String(n).split('').map((c) => (map[c] !== undefined ? map[c] : c)).join('');
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ===========================================================================
//  ระบบล็อกอิน
// ===========================================================================
async function initAuth() {
  const { data } = await sb.auth.getSession();
  if (data.session) {
    state.user = data.session.user;
    await loadAll();
    renderApp();
  } else {
    renderAuth();
  }
  sb.auth.onAuthStateChange((_event, session) => {
    if (session) {
      state.user = session.user;
      loadAll().then(renderApp);
    } else {
      state.user = null;
      renderAuth();
    }
  });
}

async function signUp(email, password, templeName) {
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) return alert('สมัครไม่สำเร็จ: ' + error.message);
  // สร้างข้อมูลวัดเริ่มต้น (ถ้าระบบเปิดใช้งานทันที)
  if (data.user) {
    await sb.from('temples').insert({
      owner: data.user.id, name: templeName || 'วัดของฉัน',
      fiscal_year: new Date().getFullYear() + 543,
    });
  }
  alert('สมัครสำเร็จ! หากระบบขอให้ยืนยันอีเมล กรุณาตรวจสอบกล่องจดหมายของท่าน จากนั้นเข้าสู่ระบบ');
}

async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return alert('เข้าสู่ระบบไม่สำเร็จ: ' + error.message);
}

async function signOut() {
  await sb.auth.signOut();
}

// ===========================================================================
//  โหลดข้อมูลจากฐานข้อมูล
// ===========================================================================
async function loadAll() {
  const [t, tx, as, dp] = await Promise.all([
    sb.from('temples').select('*').limit(1).maybeSingle(),
    sb.from('transactions').select('*').order('date', { ascending: false }),
    sb.from('assets').select('*').order('date', { ascending: false }),
    sb.from('deposits').select('*').order('date', { ascending: true }),
  ]);
  state.temple = t.data || null;
  state.txns = tx.data || [];
  state.assets = as.data || [];
  state.deposits = dp.data || [];

  // ถ้ายังไม่มีข้อมูลวัด สร้างให้
  if (!state.temple) {
    const { data } = await sb.from('temples').insert({
      owner: state.user.id, name: 'วัดของฉัน',
      fiscal_year: new Date().getFullYear() + 543,
    }).select().single();
    state.temple = data;
  }
}

// ===========================================================================
//  หน้าจอล็อกอิน / สมัครสมาชิก
// ===========================================================================
function renderAuth() {
  $('#root').innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <div class="auth-logo">☸</div>
        <h1 class="auth-title">ระบบสมุดบัญชีวัด</h1>
        <p class="auth-sub">ตามระเบียบมหาเถรสมาคม พ.ศ. ๒๕๖๑</p>
        <div class="auth-tabs">
          <button id="tab-login" class="auth-tab active" onclick="showAuthTab('login')">เข้าสู่ระบบ</button>
          <button id="tab-signup" class="auth-tab" onclick="showAuthTab('signup')">สมัครวัดใหม่</button>
        </div>
        <div id="login-form">
          <label class="fld"><span>อีเมล</span><input id="login-email" type="email" placeholder="example@email.com"></label>
          <label class="fld"><span>รหัสผ่าน</span><input id="login-pass" type="password" placeholder="••••••••"></label>
          <button class="btn-primary full" onclick="doLogin()">เข้าสู่ระบบ</button>
        </div>
        <div id="signup-form" style="display:none">
          <label class="fld"><span>ชื่อวัด</span><input id="su-temple" type="text" placeholder="เช่น วัดปรกฟ้า"></label>
          <label class="fld"><span>อีเมล</span><input id="su-email" type="email" placeholder="example@email.com"></label>
          <label class="fld"><span>รหัสผ่าน (อย่างน้อย 6 ตัว)</span><input id="su-pass" type="password" placeholder="••••••••"></label>
          <button class="btn-primary full" onclick="doSignup()">สมัครและสร้างบัญชีวัด</button>
        </div>
        <p class="auth-note">แต่ละวัดมีบัญชีของตนเอง ข้อมูลแยกกัน ปลอดภัย ผู้อื่นมองไม่เห็น</p>
      </div>
    </div>`;
}
window.showAuthTab = (which) => {
  $('#login-form').style.display = which === 'login' ? 'block' : 'none';
  $('#signup-form').style.display = which === 'signup' ? 'block' : 'none';
  $('#tab-login').classList.toggle('active', which === 'login');
  $('#tab-signup').classList.toggle('active', which === 'signup');
};
window.doLogin = () => signIn($('#login-email').value.trim(), $('#login-pass').value);
window.doSignup = () => {
  const p = $('#su-pass').value;
  if (p.length < 6) return alert('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
  signUp($('#su-email').value.trim(), p, $('#su-temple').value.trim());
};

// ===========================================================================
//  หน้าจอหลัก
// ===========================================================================
const TABS = [
  { id: 'dashboard', label: 'ภาพรวม' },
  { id: 'daily', label: 'รายรับ-รายจ่ายรายวัน' },
  { id: 'income', label: 'บัญชีแยกรายรับ' },
  { id: 'expense', label: 'บัญชีแยกรายจ่าย' },
  { id: 'deposit', label: 'บัญชีเงินฝาก' },
  { id: 'asset', label: 'ทะเบียนทรัพย์สิน' },
  { id: 'report', label: 'รายงานงบประจำปี' },
  { id: 'settings', label: 'ข้อมูลวัด' },
];

function renderApp() {
  const t = state.temple || {};
  $('#root').innerHTML = `
    <header class="topbar">
      <div class="topbar-inner">
        <div class="brand">
          <div class="brand-logo">☸</div>
          <div>
            <div class="brand-name">สมุดบัญชีวัด — ${esc(t.name || 'วัดของฉัน')}</div>
            <div class="brand-sub">${esc(t.address || 'กรุณากรอกที่อยู่ในเมนูข้อมูลวัด')}</div>
          </div>
        </div>
        <div class="topbar-right">
          <div class="fy-label">ปีงบประมาณ</div>
          <div class="fy-year">พ.ศ. ${esc(t.fiscal_year || (new Date().getFullYear()+543))}</div>
          <button class="btn-ghost-light" onclick="signOut()">ออกจากระบบ</button>
        </div>
      </div>
    </header>
    <nav class="nav"><div class="nav-inner">
      ${TABS.map((tab) => `<button class="nav-tab ${state.tab===tab.id?'active':''}" onclick="setTab('${tab.id}')">${tab.label}</button>`).join('')}
    </div></nav>
    <main class="main" id="page"></main>
    <footer class="foot">ระบบสมุดบัญชีวัดออนไลน์ · ข้อมูลแต่ละวัดถูกแยกเก็บอย่างปลอดภัย</footer>`;
  renderPage();
}

window.setTab = (id) => { state.tab = id; renderPage(); updateNavActive(); };
function updateNavActive() {
  document.querySelectorAll('.nav-tab').forEach((b, i) => b.classList.toggle('active', TABS[i].id === state.tab));
}

function renderPage() {
  const page = $('#page');
  if (!page) return;
  const r = { dashboard: pageDashboard, daily: pageDaily, income: () => pageCategorized('income'),
    expense: () => pageCategorized('expense'), deposit: pageDeposit, asset: pageAsset,
    report: pageReport, settings: pageSettings };
  page.innerHTML = (r[state.tab] || pageDashboard)();
  if (state.tab === 'daily') wireDaily();
  if (state.tab === 'asset') wireAsset();
  if (state.tab === 'deposit') wireDeposit();
  if (state.tab === 'settings') wireSettings();
}

// ---------- คำนวณสรุป ----------
function summary() {
  const income = state.txns.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount || 0), 0);
  const expense = state.txns.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount || 0), 0);
  const assetValue = state.assets.reduce((s, a) => s + Number(a.value || 0) * Number(a.quantity || 1), 0);
  const deposit = state.deposits.reduce((s, d) =>
    (d.type === 'deposit' || d.type === 'interest') ? s + Number(d.amount || 0) : s - Number(d.amount || 0), 0);
  return { income, expense, balance: income - expense, assetValue, deposit };
}

// ---------- หน้าภาพรวม ----------
function pageDashboard() {
  const s = summary();
  const recent = [...state.txns].sort((a, b) => (b.date||'').localeCompare(a.date||'')).slice(0, 8);
  const stat = (label, val, cls) => `
    <div class="stat"><div class="stat-label">${label}</div>
    <div class="stat-val ${cls||''}">${fmtMoney(val)}</div><div class="stat-unit">บาท</div></div>`;
  return `
    ${sectionHead('ภาพรวมการเงินวัด', 'สรุปสถานะการเงินและทรัพย์สิน ณ ปัจจุบัน')}
    <div class="stat-row">
      ${stat('รายรับรวม', s.income, 'income')}
      ${stat('รายจ่ายรวม', s.expense, 'expense')}
      ${stat('คงเหลือ', s.balance, s.balance>=0?'income':'expense')}
      ${stat('เงินฝากธนาคาร', s.deposit, 'asset')}
      ${stat('มูลค่าทรัพย์สิน', s.assetValue, 'teak')}
    </div>
    <div class="card">
      <div class="card-title">รายการล่าสุด</div>
      ${recent.length === 0 ? `<div class="empty">ยังไม่มีรายการ — เริ่มบันทึกที่เมนู "รายรับ-รายจ่ายรายวัน"</div>` : `
      <table class="tbl"><thead><tr><th>วันที่</th><th>ประเภท</th><th>หมวด</th><th>รายการ</th><th class="r">จำนวนเงิน</th></tr></thead>
      <tbody>${recent.map((t) => `<tr>
        <td>${fmtThaiDate(t.date)}</td>
        <td>${t.type==='income'?'<span class="pill income">รายรับ</span>':'<span class="pill expense">รายจ่าย</span>'}</td>
        <td class="muted">${esc(t.category)}</td>
        <td>${esc(t.description)}</td>
        <td class="r ${t.type==='income'?'income':'expense'}">${t.type==='income'?'+':'−'} ${fmtMoney(t.amount)}</td>
      </tr>`).join('')}</tbody></table>`}
    </div>`;
}

// ---------- หน้ารายวัน ----------
function pageDaily() {
  const list = [...state.txns].sort((a, b) => (b.date||'').localeCompare(a.date||''));
  return `
    ${sectionHead('สมุดบัญชีรายรับ-รายจ่ายรายวัน', 'บันทึกรายการทุกครั้งที่มีเงินเข้า-ออก',
      `<button class="btn-primary" onclick="openTxnForm()">+ เพิ่มรายการ</button>`)}
    <div id="txn-form-slot"></div>
    <div class="card"><table class="tbl">
      <thead><tr><th>วันที่</th><th>ประเภท</th><th>หมวด</th><th>รายการ</th><th class="r">จำนวนเงิน</th><th class="c">จัดการ</th></tr></thead>
      <tbody>${list.length===0?`<tr><td colspan="6" class="empty">ยังไม่มีรายการ</td></tr>`:
      list.map((t) => `<tr>
        <td>${fmtThaiDate(t.date)}</td>
        <td>${t.type==='income'?'<span class="pill income">รายรับ</span>':'<span class="pill expense">รายจ่าย</span>'}</td>
        <td class="muted">${esc(t.category)}</td>
        <td>${esc(t.description)}${t.note?`<div class="sub">${esc(t.note)}</div>`:''}</td>
        <td class="r ${t.type==='income'?'income':'expense'}">${fmtMoney(t.amount)}</td>
        <td class="c"><button class="lnk" onclick="openTxnForm('${t.id}')">แก้ไข</button>
          <button class="lnk del" onclick="delTxn('${t.id}')">ลบ</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}
function wireDaily() {}

window.openTxnForm = (id) => {
  const t = id ? state.txns.find((x) => x.id === id) : null;
  const cats = (t?.type === 'expense') ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  $('#txn-form-slot').innerHTML = `
    <div class="card form-card">
      <div class="form-title">${t ? 'แก้ไขรายการ' : 'เพิ่มรายการใหม่'}</div>
      <div class="grid2">
        <label class="fld"><span>ประเภท *</span>
          <select id="f-type" onchange="onTxnTypeChange()">
            <option value="income" ${t?.type==='income'?'selected':''}>รายรับ</option>
            <option value="expense" ${t?.type==='expense'?'selected':''}>รายจ่าย</option>
          </select></label>
        <label class="fld"><span>วันที่ *</span><input id="f-date" type="date" value="${t?.date||todayIso()}"></label>
      </div>
      <div class="grid2">
        <label class="fld"><span>หมวด *</span><select id="f-cat">${cats.map((c) => `<option ${t?.category===c?'selected':''}>${c}</option>`).join('')}</select></label>
        <label class="fld"><span>จำนวนเงิน (บาท) *</span><input id="f-amount" type="number" step="0.01" min="0" value="${t?.amount||''}"></label>
      </div>
      <label class="fld"><span>รายการ *</span><input id="f-desc" type="text" value="${esc(t?.description||'')}" placeholder="เช่น เงินบริจาคจากญาติโยม, ค่าไฟฟ้าเดือนพฤษภาคม"></label>
      <label class="fld"><span>หมายเหตุ</span><textarea id="f-note" placeholder="ผู้บริจาค, เลขที่ใบเสร็จ">${esc(t?.note||'')}</textarea></label>
      <div class="form-actions">
        <button class="btn-primary" onclick="saveTxn(${t?`'${t.id}'`:'null'})">บันทึก</button>
        <button class="btn-subtle" onclick="$('#txn-form-slot').innerHTML=''">ยกเลิก</button>
      </div>
    </div>`;
};
window.onTxnTypeChange = () => {
  const type = $('#f-type').value;
  const cats = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  $('#f-cat').innerHTML = cats.map((c) => `<option>${c}</option>`).join('');
};
window.saveTxn = async (id) => {
  const rec = {
    owner: state.user.id, type: $('#f-type').value, date: $('#f-date').value,
    category: $('#f-cat').value, description: $('#f-desc').value.trim(),
    amount: Number($('#f-amount').value) || 0, note: $('#f-note').value.trim(),
  };
  if (!rec.description || !rec.amount) return alert('กรุณากรอกรายการและจำนวนเงิน');
  if (id) await sb.from('transactions').update(rec).eq('id', id);
  else await sb.from('transactions').insert(rec);
  await loadAll(); renderPage();
};
window.delTxn = async (id) => {
  if (!confirm('ยืนยันการลบรายการนี้?')) return;
  await sb.from('transactions').delete().eq('id', id);
  await loadAll(); renderPage();
};

// ---------- หน้าบัญชีแยกรายรับ/รายจ่าย ----------
function pageCategorized(type) {
  const cats = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const items = state.txns.filter((t) => t.type === type);
  const grand = items.reduce((s, t) => s + Number(t.amount || 0), 0);
  const title = type === 'income' ? 'สมุดบัญชีแยกรายรับ' : 'สมุดบัญชีแยกรายจ่าย';
  const cls = type === 'income' ? 'income' : 'expense';
  return `
    ${sectionHead(title, 'สรุปรายการแยกตามหมวด เพื่อใช้ประกอบรายงานประจำปี')}
    <div class="card sum-banner ${cls}">
      <span>${type==='income'?'รายรับรวมทั้งสิ้น':'รายจ่ายรวมทั้งสิ้น'}</span>
      <span class="sum-amt">${fmtMoney(grand)} บาท</span>
    </div>
    ${cats.map((c) => {
      const rows = items.filter((t) => t.category === c).sort((a, b) => (a.date||'').localeCompare(b.date||''));
      const total = rows.reduce((s, t) => s + Number(t.amount || 0), 0);
      return `<div class="card">
        <div class="grp-head"><span>${c}</span><span class="${cls}">${fmtMoney(total)}</span></div>
        ${rows.length===0?`<div class="empty sm">— ยังไม่มีรายการ —</div>`:
        `<table class="tbl"><tbody>${rows.map((t) => `<tr>
          <td class="muted" style="width:130px">${fmtThaiDate(t.date)}</td>
          <td>${esc(t.description)}${t.note?` <span class="muted sm">— ${esc(t.note)}</span>`:''}</td>
          <td class="r ${cls}" style="width:140px">${fmtMoney(t.amount)}</td></tr>`).join('')}</tbody></table>`}
      </div>`;
    }).join('')}`;
}

// ---------- หน้าเงินฝาก ----------
function pageDeposit() {
  const sorted = [...state.deposits].sort((a, b) => (a.date||'').localeCompare(b.date||''));
  let run = 0;
  const rows = sorted.map((d) => {
    const isIn = d.type === 'deposit' || d.type === 'interest';
    run += isIn ? Number(d.amount||0) : -Number(d.amount||0);
    return { ...d, balance: run, isIn };
  });
  const total = rows.length ? rows[rows.length-1].balance : 0;
  return `
    ${sectionHead('สมุดบัญชีเงินฝากธนาคาร', 'บันทึกการฝาก-ถอน และดอกเบี้ยรับ',
      `<button class="btn-primary" onclick="openDepForm()">+ เพิ่มรายการ</button>`)}
    <div class="card sum-banner asset"><span>ยอดเงินฝากคงเหลือสุทธิ</span><span class="sum-amt">${fmtMoney(total)} บาท</span></div>
    <div id="dep-form-slot"></div>
    <div class="card"><table class="tbl">
      <thead><tr><th>วันที่</th><th>ธนาคาร/เลขบัญชี</th><th>รายการ</th><th class="r">ฝาก/ดอกเบี้ย</th><th class="r">ถอน</th><th class="r">คงเหลือ</th><th class="c">จัดการ</th></tr></thead>
      <tbody>${rows.length===0?`<tr><td colspan="7" class="empty">ยังไม่มีรายการ</td></tr>`:
      rows.map((d) => `<tr>
        <td>${fmtThaiDate(d.date)}</td>
        <td>${esc(d.bank)}<div class="sub">${esc(d.account_number||'')}</div></td>
        <td><span class="pill ${d.isIn?'income':'expense'}">${DEPOSIT_TYPES.find((x)=>x.value===d.type)?.label}</span>${d.note?`<div class="sub">${esc(d.note)}</div>`:''}</td>
        <td class="r income">${d.isIn?fmtMoney(d.amount):'—'}</td>
        <td class="r expense">${!d.isIn?fmtMoney(d.amount):'—'}</td>
        <td class="r bold">${fmtMoney(d.balance)}</td>
        <td class="c"><button class="lnk" onclick="openDepForm('${d.id}')">แก้</button>
          <button class="lnk del" onclick="delDep('${d.id}')">ลบ</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}
function wireDeposit() {}
window.openDepForm = (id) => {
  const d = id ? state.deposits.find((x) => x.id === id) : null;
  $('#dep-form-slot').innerHTML = `
    <div class="card form-card">
      <div class="form-title">${d ? 'แก้ไขรายการ' : 'เพิ่มรายการเงินฝาก'}</div>
      <div class="grid2">
        <label class="fld"><span>วันที่ *</span><input id="d-date" type="date" value="${d?.date||todayIso()}"></label>
        <label class="fld"><span>ประเภท *</span><select id="d-type">${DEPOSIT_TYPES.map((x)=>`<option value="${x.value}" ${d?.type===x.value?'selected':''}>${x.label}</option>`).join('')}</select></label>
      </div>
      <div class="grid2">
        <label class="fld"><span>ธนาคาร *</span><input id="d-bank" type="text" value="${esc(d?.bank||'ธ.กรุงไทย')}"></label>
        <label class="fld"><span>เลขที่บัญชี</span><input id="d-acc" type="text" value="${esc(d?.account_number||'')}" placeholder="xxx-x-xxxxx-x"></label>
      </div>
      <label class="fld"><span>จำนวนเงิน (บาท) *</span><input id="d-amount" type="number" step="0.01" min="0" value="${d?.amount||''}"></label>
      <label class="fld"><span>หมายเหตุ</span><textarea id="d-note">${esc(d?.note||'')}</textarea></label>
      <div class="form-actions">
        <button class="btn-primary" onclick="saveDep(${d?`'${d.id}'`:'null'})">บันทึก</button>
        <button class="btn-subtle" onclick="$('#dep-form-slot').innerHTML=''">ยกเลิก</button>
      </div>
    </div>`;
};
window.saveDep = async (id) => {
  const rec = {
    owner: state.user.id, date: $('#d-date').value, type: $('#d-type').value,
    bank: $('#d-bank').value.trim(), account_number: $('#d-acc').value.trim(),
    amount: Number($('#d-amount').value) || 0, note: $('#d-note').value.trim(),
  };
  if (!rec.amount || !rec.bank) return alert('กรุณากรอกข้อมูลให้ครบ');
  if (id) await sb.from('deposits').update(rec).eq('id', id);
  else await sb.from('deposits').insert(rec);
  await loadAll(); renderPage();
};
window.delDep = async (id) => {
  if (!confirm('ยืนยันการลบ?')) return;
  await sb.from('deposits').delete().eq('id', id);
  await loadAll(); renderPage();
};

// ---------- หน้าทรัพย์สิน ----------
function pageAsset() {
  const total = state.assets.reduce((s, a) => s + Number(a.value||0) * Number(a.quantity||1), 0);
  return `
    ${sectionHead('ทะเบียนทรัพย์สินของวัด', 'บันทึกที่ดิน อาคารเสนาสนะ ครุภัณฑ์ และพระพุทธรูป',
      `<button class="btn-primary" onclick="openAssetForm()">+ เพิ่มทรัพย์สิน</button>`)}
    <div class="card sum-banner asset"><span>มูลค่าทรัพย์สินรวมทั้งสิ้น</span><span class="sum-amt">${fmtMoney(total)} บาท</span></div>
    <div id="asset-form-slot"></div>
    <div class="card"><table class="tbl">
      <thead><tr><th>วันที่ได้มา</th><th>หมวด</th><th>รายการ</th><th class="r">จำนวน</th><th class="r">มูลค่า/หน่วย</th><th class="r">รวม</th><th>ที่มา</th><th class="c">จัดการ</th></tr></thead>
      <tbody>${state.assets.length===0?`<tr><td colspan="8" class="empty">ยังไม่มีรายการทรัพย์สิน</td></tr>`:
      state.assets.map((a) => `<tr>
        <td>${fmtThaiDate(a.date)}</td>
        <td class="muted sm">${esc(a.category)}</td>
        <td>${esc(a.name)}${a.note?`<div class="sub">${esc(a.note)}</div>`:''}</td>
        <td class="r">${a.quantity||1}</td>
        <td class="r">${fmtMoney(a.value)}</td>
        <td class="r bold">${fmtMoney(Number(a.value||0)*Number(a.quantity||1))}</td>
        <td class="muted sm">${esc(a.source||'')}</td>
        <td class="c"><button class="lnk" onclick="openAssetForm('${a.id}')">แก้ไข</button>
          <button class="lnk del" onclick="delAsset('${a.id}')">ลบ</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
}
function wireAsset() {}
window.openAssetForm = (id) => {
  const a = id ? state.assets.find((x) => x.id === id) : null;
  $('#asset-form-slot').innerHTML = `
    <div class="card form-card">
      <div class="form-title">${a ? 'แก้ไขรายการทรัพย์สิน' : 'เพิ่มทรัพย์สินใหม่'}</div>
      <div class="grid2">
        <label class="fld"><span>วันที่ได้มา *</span><input id="a-date" type="date" value="${a?.date||todayIso()}"></label>
        <label class="fld"><span>หมวด *</span><select id="a-cat">${ASSET_CATEGORIES.map((c)=>`<option ${a?.category===c?'selected':''}>${c}</option>`).join('')}</select></label>
      </div>
      <label class="fld"><span>ชื่อทรัพย์สิน *</span><input id="a-name" type="text" value="${esc(a?.name||'')}" placeholder="เช่น พระประธานในอุโบสถ, รถกระบะ, ที่ดินแปลงที่ 1"></label>
      <div class="grid3">
        <label class="fld"><span>จำนวน</span><input id="a-qty" type="number" min="1" value="${a?.quantity||1}"></label>
        <label class="fld"><span>มูลค่า/หน่วย</span><input id="a-val" type="number" step="0.01" min="0" value="${a?.value||''}"></label>
        <label class="fld"><span>ที่มา (ผู้บริจาค)</span><input id="a-src" type="text" value="${esc(a?.source||'')}" placeholder="เช่น คุณสมชาย บริจาค"></label>
      </div>
      <label class="fld"><span>หมายเหตุ</span><textarea id="a-note">${esc(a?.note||'')}</textarea></label>
      <div class="form-actions">
        <button class="btn-primary" onclick="saveAsset(${a?`'${a.id}'`:'null'})">บันทึก</button>
        <button class="btn-subtle" onclick="$('#asset-form-slot').innerHTML=''">ยกเลิก</button>
      </div>
    </div>`;
};
window.saveAsset = async (id) => {
  const rec = {
    owner: state.user.id, date: $('#a-date').value, category: $('#a-cat').value,
    name: $('#a-name').value.trim(), quantity: Number($('#a-qty').value) || 1,
    value: Number($('#a-val').value) || 0, source: $('#a-src').value.trim(), note: $('#a-note').value.trim(),
  };
  if (!rec.name) return alert('กรุณากรอกชื่อทรัพย์สิน');
  if (id) await sb.from('assets').update(rec).eq('id', id);
  else await sb.from('assets').insert(rec);
  await loadAll(); renderPage();
};
window.delAsset = async (id) => {
  if (!confirm('ยืนยันการลบ?')) return;
  await sb.from('assets').delete().eq('id', id);
  await loadAll(); renderPage();
};

// ---------- หน้ารายงานประจำปี ----------
function pageReport() {
  const t = state.temple || {};
  const s = summary();
  const inc = {}; INCOME_CATEGORIES.forEach((c) => inc[c] = 0);
  state.txns.filter((x) => x.type==='income').forEach((x) => inc[x.category] = (inc[x.category]||0) + Number(x.amount||0));
  const exp = {}; EXPENSE_CATEGORIES.forEach((c) => exp[c] = 0);
  state.txns.filter((x) => x.type==='expense').forEach((x) => exp[x.category] = (exp[x.category]||0) + Number(x.amount||0));
  return `
    ${sectionHead('รายงานงบประจำปี', 'สรุปงบสำหรับส่งสำนักงานพระพุทธศาสนาแห่งชาติ',
      `<button class="btn-primary" onclick="window.print()">พิมพ์รายงาน</button>`)}
    <div class="card report">
      <div class="rep-head">
        <div class="rep-title">สรุปบัญชีรายรับ – รายจ่าย ประจำปีงบประมาณ พ.ศ. ${esc(t.fiscal_year||(new Date().getFullYear()+543))}</div>
        <div class="rep-name">${esc(t.name||'วัดของฉัน')}</div>
        <div class="rep-addr">${esc(t.address||'')}</div>
      </div>
      <div class="rep-sec"><div class="rep-sec-t">๑. รายรับประจำปี</div>
        <table class="rep-tbl"><thead><tr><th>ลำดับ</th><th>หมวดรายรับ</th><th class="r">จำนวนเงิน (บาท)</th></tr></thead>
        <tbody>${INCOME_CATEGORIES.map((c, i) => `<tr><td>${toThaiNum(i+1)}</td><td>${c}</td><td class="r">${fmtMoney(inc[c])}</td></tr>`).join('')}
        <tr class="rep-total"><td colspan="2" class="r">รวมรายรับทั้งสิ้น</td><td class="r income">${fmtMoney(s.income)}</td></tr></tbody></table>
      </div>
      <div class="rep-sec"><div class="rep-sec-t">๒. รายจ่ายประจำปี</div>
        <table class="rep-tbl"><thead><tr><th>ลำดับ</th><th>หมวดรายจ่าย</th><th class="r">จำนวนเงิน (บาท)</th></tr></thead>
        <tbody>${EXPENSE_CATEGORIES.map((c, i) => `<tr><td>${toThaiNum(i+1)}</td><td>${c}</td><td class="r">${fmtMoney(exp[c])}</td></tr>`).join('')}
        <tr class="rep-total"><td colspan="2" class="r">รวมรายจ่ายทั้งสิ้น</td><td class="r expense">${fmtMoney(s.expense)}</td></tr></tbody></table>
      </div>
      <div class="rep-sec"><div class="rep-sec-t">๓. สรุปยอด</div>
        <table class="rep-tbl"><tbody>
          <tr><td>รายรับรวม</td><td class="r income">${fmtMoney(s.income)} บาท</td></tr>
          <tr><td>หัก รายจ่ายรวม</td><td class="r expense">${fmtMoney(s.expense)} บาท</td></tr>
          <tr class="rep-total"><td>คงเหลือ ณ สิ้นปีงบประมาณ</td><td class="r ${s.balance>=0?'income':'expense'}">${fmtMoney(s.balance)} บาท</td></tr>
          <tr><td>ยอดเงินฝากธนาคาร</td><td class="r">${fmtMoney(s.deposit)} บาท</td></tr>
          <tr><td>มูลค่าทรัพย์สินรวม</td><td class="r">${fmtMoney(s.assetValue)} บาท</td></tr>
        </tbody></table>
      </div>
      <div class="rep-sign">
        <div><div class="sign-line">ลงชื่อ ............................................</div>
          <div>( ${esc(t.treasurer||'............................................')} )</div>
          <div class="muted">ไวยาวัจกร / ผู้จัดทำบัญชี</div></div>
        <div><div class="sign-line">ลงชื่อ ............................................</div>
          <div>( ${esc(t.abbot||'............................................')} )</div>
          <div class="muted">เจ้าอาวาส</div></div>
      </div>
    </div>`;
}

// ---------- หน้าตั้งค่าข้อมูลวัด ----------
function pageSettings() {
  const t = state.temple || {};
  return `
    ${sectionHead('ข้อมูลวัด', 'ข้อมูลพื้นฐานที่ปรากฏในรายงาน')}
    <div class="card form-card">
      <div class="grid2">
        <label class="fld"><span>ชื่อวัด</span><input id="s-name" type="text" value="${esc(t.name||'')}"></label>
        <label class="fld"><span>ปีงบประมาณ (พ.ศ.)</span><input id="s-fy" type="number" value="${esc(t.fiscal_year||'')}"></label>
      </div>
      <label class="fld"><span>ที่อยู่</span><input id="s-addr" type="text" value="${esc(t.address||'')}"></label>
      <div class="grid2">
        <label class="fld"><span>เจ้าอาวาส</span><input id="s-abbot" type="text" value="${esc(t.abbot||'')}" placeholder="พระ..."></label>
        <label class="fld"><span>ไวยาวัจกร / ผู้จัดทำบัญชี</span><input id="s-treas" type="text" value="${esc(t.treasurer||'')}"></label>
      </div>
      <div class="form-actions">
        <button class="btn-primary" onclick="saveTemple()">บันทึกข้อมูลวัด</button>
        <span id="save-msg" class="save-msg"></span>
      </div>
    </div>
    <div class="card">
      <div class="card-title">บัญชีผู้ใช้</div>
      <div class="muted">อีเมล: ${esc(state.user?.email||'')}</div>
      <div class="muted sm" style="margin-top:8px">รายการในระบบ: รายรับ-รายจ่าย ${state.txns.length} · ทรัพย์สิน ${state.assets.length} · เงินฝาก ${state.deposits.length}</div>
    </div>`;
}
function wireSettings() {}
window.saveTemple = async () => {
  const rec = {
    name: $('#s-name').value.trim(), address: $('#s-addr').value.trim(),
    abbot: $('#s-abbot').value.trim(), treasurer: $('#s-treas').value.trim(),
    fiscal_year: Number($('#s-fy').value) || (new Date().getFullYear()+543),
  };
  await sb.from('temples').update(rec).eq('id', state.temple.id);
  state.temple = { ...state.temple, ...rec };
  $('#save-msg').textContent = '✓ บันทึกแล้ว';
  renderApp();
  setTimeout(() => { const m = $('#save-msg'); if (m) m.textContent = ''; }, 2000);
};

// ---------- ส่วนหัวของแต่ละหน้า ----------
function sectionHead(title, sub, action) {
  return `<div class="sec-head"><div><div class="sec-title">${title}</div>${sub?`<div class="sec-sub">${sub}</div>`:''}</div><div>${action||''}</div></div>`;
}

// ---------- เริ่มต้นแอป ----------
window.signOut = signOut;
initAuth();
