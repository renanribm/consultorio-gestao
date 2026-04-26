// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS
// ─────────────────────────────────────────────────────────────────────────────
import { firebaseConfig, userRoles, labels } from './firebase-config.js';

import { initializeApp }                              from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
                                                      from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, addDoc, getDocs, updateDoc, deleteDoc,
         doc, query, orderBy, serverTimestamp }        from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE INIT
// ─────────────────────────────────────────────────────────────────────────────
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL STATE
// ─────────────────────────────────────────────────────────────────────────────
const S = {
  user:        null,
  role:        null,
  view:        'dashboard',
  filter:      { preset: 'mes', start: '', end: '' },
  data:        { recebimentos: [], despesas: [], notas: [] },
  charts:      { mensal: null, recTipo: null, despCat: null },
  editingRec:  null,   // id being edited
  editingDesp: null,
  editingNota: null,
  csvData:     null,   // parsed CSV rows
  csvHeaders:  [],
};

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const role = userRoles[user.email];
    if (!role) {
      showToast('E-mail não autorizado. Contate a administradora.', 'error');
      await signOut(auth);
      return;
    }
    S.user = user;
    S.role = role;
    applyRoleUI();
    await loadAll();
    navigateTo('dashboard');
    el('loading-overlay').classList.add('hidden');
  } else {
    S.user = null; S.role = null;
    el('app-shell').classList.add('hidden');
    el('login-screen').classList.remove('hidden');
    el('loading-overlay').classList.add('hidden');
  }
});

el('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email    = el('login-email').value.trim();
  const password = el('login-password').value;
  const errEl    = el('login-error');
  const btn      = el('btn-login');
  errEl.classList.add('hidden');
  btn.textContent = 'Entrando…';
  btn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    errEl.textContent = friendlyAuthError(err.code);
    errEl.classList.remove('hidden');
    btn.textContent = 'Entrar';
    btn.disabled = false;
  }
});

el('btn-logout').addEventListener('click', async () => {
  await signOut(auth);
});

function applyRoleUI() {
  const isMedica = S.role === 'medica';
  document.querySelectorAll('.nav-medica-only').forEach(e => {
    e.classList.toggle('hidden', !isMedica);
  });
  el('sidebar-avatar').textContent   = isMedica ? 'M' : 'S';
  el('sidebar-user-name').textContent = S.user.email.split('@')[0];
  el('sidebar-user-role').textContent = labels.role[S.role];
  el('login-screen').classList.add('hidden');
  el('app-shell').classList.remove('hidden');
}

function friendlyAuthError(code) {
  const map = {
    'auth/invalid-credential':      'E-mail ou senha incorretos.',
    'auth/user-not-found':          'Usuária não encontrada.',
    'auth/wrong-password':          'Senha incorreta.',
    'auth/too-many-requests':       'Muitas tentativas. Tente novamente em alguns minutos.',
    'auth/network-request-failed':  'Erro de rede. Verifique sua conexão.',
    'auth/invalid-email':           'E-mail inválido.',
  };
  return map[code] || `Erro ao fazer login (${code}).`;
}

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────
document.querySelectorAll('[data-view]').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(link.dataset.view);
  });
});

function navigateTo(view) {
  if (S.role === 'secretaria' && (view === 'dre' || view === 'import')) {
    showToast('Acesso restrito à médica.', 'error'); return;
  }
  S.view = view;

  document.querySelectorAll('section.view').forEach(s => s.classList.add('hidden'));
  const target = el('view-' + view);
  if (target) target.classList.remove('hidden');

  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.view === view);
  });

  const filterBar = el('filter-bar');
  filterBar.classList.toggle('hidden', view === 'import');

  renderView(view);
}

function renderView(view) {
  switch (view) {
    case 'dashboard':     renderDashboard();     break;
    case 'recebimentos':  renderRecebimentos();  break;
    case 'despesas':      renderDespesas();       break;
    case 'inadimplencia': renderInadimplencia(); break;
    case 'secretaria':    renderSecretaria();    break;
    case 'dre':           renderDRE();           break;
    case 'import':        /* no auto-render */   break;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PERIOD FILTER
// ─────────────────────────────────────────────────────────────────────────────
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const period = btn.dataset.period;
    if (period === 'custom') {
      el('filter-custom').classList.remove('hidden');
    } else {
      el('filter-custom').classList.add('hidden');
      applyPreset(period);
    }
  });
});

el('btn-apply-filter').addEventListener('click', () => {
  const start = el('filter-start').value;
  const end   = el('filter-end').value;
  if (!start || !end) { showToast('Selecione as duas datas.', 'error'); return; }
  if (start > end) { showToast('Data inicial deve ser antes da final.', 'error'); return; }
  S.filter = { preset: 'custom', start, end };
  el('filter-label').textContent = `${fmtDate(start)} → ${fmtDate(end)}`;
  renderView(S.view);
});

function applyPreset(preset) {
  const now   = new Date();
  let start, end;
  const pad   = n => String(n).padStart(2, '0');
  const ymd   = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

  if (preset === 'mes') {
    start = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
    end   = ymd(new Date(now.getFullYear(), now.getMonth()+1, 0));
  } else if (preset === 'mespassado') {
    start = ymd(new Date(now.getFullYear(), now.getMonth()-1, 1));
    end   = ymd(new Date(now.getFullYear(), now.getMonth(), 0));
  } else if (preset === '3meses') {
    start = ymd(new Date(now.getFullYear(), now.getMonth()-2, 1));
    end   = ymd(new Date(now.getFullYear(), now.getMonth()+1, 0));
  } else if (preset === '6meses') {
    start = ymd(new Date(now.getFullYear(), now.getMonth()-5, 1));
    end   = ymd(new Date(now.getFullYear(), now.getMonth()+1, 0));
  } else if (preset === 'ano') {
    start = `${now.getFullYear()}-01-01`;
    end   = `${now.getFullYear()}-12-31`;
  }
  S.filter = { preset, start, end };
  el('filter-label').textContent = presetLabel(preset, start, end);
  renderView(S.view);
}

function presetLabel(preset, start, end) {
  if (preset === 'mes')       return `${monthName(start)} ${new Date(start+'T12:00').getFullYear()}`;
  if (preset === 'mespassado') return `${monthName(start)} ${new Date(start+'T12:00').getFullYear()}`;
  return `${fmtDate(start)} → ${fmtDate(end)}`;
}

function monthName(dateStr) {
  return new Date(dateStr + 'T12:00').toLocaleDateString('pt-BR', { month: 'long' });
}

function filteredRec()  { return filterByPeriod(S.data.recebimentos); }
function filteredDesp() { return filterByPeriod(S.data.despesas); }

function filterByPeriod(arr) {
  if (!S.filter.start) return arr;
  return arr.filter(r => r.date >= S.filter.start && r.date <= S.filter.end);
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA — Firestore CRUD
// ─────────────────────────────────────────────────────────────────────────────
async function loadAll() {
  showLoading();
  try {
    const [recs, desps, notas] = await Promise.all([
      fetchCollection('recebimentos', [orderBy('date', 'desc')]),
      fetchCollection('despesas',     [orderBy('date', 'desc')]),
      fetchCollection('notas',        [orderBy('createdAt', 'desc')]),
    ]);
    S.data.recebimentos = recs;
    S.data.despesas     = desps;
    S.data.notas        = notas;
    updateBadges();
  } catch (err) {
    console.error(err);
    showToast('Erro ao carregar dados. Verifique as regras do Firestore.', 'error');
  } finally {
    hideLoading();
  }
}

async function fetchCollection(name, constraints = []) {
  const q    = query(collection(db, name), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function saveRecebimento(data, id = null) {
  showLoading();
  try {
    if (id) {
      await updateDoc(doc(db, 'recebimentos', id), { ...data, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, 'recebimentos'), { ...data, createdAt: serverTimestamp(), createdBy: S.user.uid });
    }
    await reloadCollection('recebimentos');
    updateBadges();
    showToast('Recebimento salvo!', 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

async function saveDespesa(data, id = null) {
  showLoading();
  try {
    if (id) {
      await updateDoc(doc(db, 'despesas', id), { ...data, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, 'despesas'), { ...data, createdAt: serverTimestamp(), createdBy: S.user.uid });
    }
    await reloadCollection('despesas');
    showToast('Despesa salva!', 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

async function saveNota(data, id = null) {
  showLoading();
  try {
    if (id) {
      await updateDoc(doc(db, 'notas', id), { ...data, updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, 'notas'), { ...data, createdAt: serverTimestamp(), createdBy: S.user.uid });
    }
    await reloadCollection('notas');
    showToast('Anotação salva!', 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

async function deleteRec(id) {
  if (!confirm('Excluir este recebimento?')) return;
  showLoading();
  try {
    await deleteDoc(doc(db, 'recebimentos', id));
    await reloadCollection('recebimentos');
    updateBadges();
    renderView(S.view);
    showToast('Recebimento excluído.', 'info');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

async function deleteDesp(id) {
  if (!confirm('Excluir esta despesa?')) return;
  showLoading();
  try {
    await deleteDoc(doc(db, 'despesas', id));
    await reloadCollection('despesas');
    renderView(S.view);
    showToast('Despesa excluída.', 'info');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

async function deleteNota(id) {
  if (!confirm('Excluir esta anotação?')) return;
  showLoading();
  try {
    await deleteDoc(doc(db, 'notas', id));
    await reloadCollection('notas');
    renderSecretaria();
    showToast('Anotação excluída.', 'info');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

async function markReceived(id) {
  showLoading();
  try {
    await updateDoc(doc(db, 'recebimentos', id), { status: 'pix', updatedAt: serverTimestamp() });
    await reloadCollection('recebimentos');
    updateBadges();
    renderView(S.view);
    showToast('Marcado como recebido via PIX!', 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

async function markNFEmitida(id) {
  showLoading();
  try {
    await updateDoc(doc(db, 'recebimentos', id), { invoiceStatus: 'emitida', updatedAt: serverTimestamp() });
    await reloadCollection('recebimentos');
    updateBadges();
    renderView(S.view);
    showToast('NF marcada como emitida!', 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

async function reloadCollection(name) {
  const ord = name === 'notas' ? [orderBy('createdAt', 'desc')] : [orderBy('date', 'desc')];
  S.data[name] = await fetchCollection(name, ord);
}

function handleErr(err) {
  console.error(err);
  showToast('Erro: ' + (err.message || 'Tente novamente.'), 'error');
}

function updateBadges() {
  const pendRec = S.data.recebimentos.filter(r => r.status === 'pendente');
  const pendNF  = S.data.recebimentos.filter(r => r.invoiceStatus === 'pendente' && r.status !== 'gratuito');
  setCount('badge-inadimplencia', pendRec.length);
  setCount('badge-nf', pendNF.length);
}

function setCount(id, n) {
  const el2 = el(id);
  el2.textContent = n;
  el2.classList.toggle('hidden', n === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function renderDashboard() {
  const recs  = filteredRec();
  const desps = filteredDesp();

  const recebida  = sumWhere(recs,  r => r.status === 'pix');
  const pendente  = sumWhere(recs,  r => r.status === 'pendente');
  const totalDesp = desps.reduce((s, d) => s + (d.value || 0), 0);
  const resultado = recebida - totalDesp;
  const margem    = recebida > 0 ? (resultado / recebida * 100).toFixed(1) : 0;
  const gratuitos = recs.filter(r => r.status === 'gratuito').length;
  const paid      = recs.filter(r => r.status === 'pix');
  const ticket    = paid.length > 0 ? paid.reduce((s, r) => s + (r.value || 0), 0) / paid.length : 0;

  setText('kpi-receita',      fmtBRL(recebida));
  setText('kpi-receita-meta', `${recs.filter(r => r.status === 'pix').length} atendimentos pagos`);
  setText('kpi-pendente',     fmtBRL(pendente));
  setText('kpi-pendente-meta',`${recs.filter(r => r.status === 'pendente').length} pendentes`);
  setText('kpi-despesas',     fmtBRL(totalDesp));
  setText('kpi-despesas-meta',`${desps.length} lançamentos`);
  setText('kpi-resultado',    fmtBRL(resultado));
  setText('kpi-resultado-meta',`Margem: ${margem}%`);
  el('kpi-resultado').style.color = resultado >= 0 ? '' : 'var(--red)';
  setText('kpi-gratuito',     gratuitos);
  setText('kpi-ticket',       fmtBRL(ticket));

  const pendNF = S.data.recebimentos.filter(r => r.invoiceStatus === 'pendente' && r.status !== 'gratuito');
  const alertEl = el('alert-nf');
  if (pendNF.length > 0) {
    alertEl.classList.remove('hidden');
    setText('alert-nf-count', `${pendNF.length} nota${pendNF.length > 1 ? 's fiscais' : ' fiscal'}`);
  } else {
    alertEl.classList.add('hidden');
  }

  const periodEl = el('dash-period');
  if (S.filter.start) periodEl.textContent = `${fmtDate(S.filter.start)} → ${fmtDate(S.filter.end)}`;

  renderMensalChart();
  renderRecent();
}

function renderMensalChart() {
  const months = getMonthlyData(6);
  const labels6 = months.map(m => m.label);
  const receitas = months.map(m => m.receita);
  const despesas = months.map(m => m.despesa);

  const ctx = el('chart-mensal').getContext('2d');
  if (S.charts.mensal) S.charts.mensal.destroy();
  S.charts.mensal = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels6,
      datasets: [
        { label: 'Receita Recebida', data: receitas, backgroundColor: '#2d7a5f', borderRadius: 6, order: 2 },
        { label: 'Despesas',         data: despesas, backgroundColor: '#ef4444', borderRadius: 6, order: 2 },
        { label: 'Resultado',
          data: months.map(m => m.receita - m.despesa),
          type: 'line', borderColor: '#2563eb', backgroundColor: 'transparent',
          pointBackgroundColor: '#2563eb', borderWidth: 2, tension: 0.3, order: 1
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { family: 'Plus Jakarta Sans', size: 11 }, boxWidth: 12 } } },
      scales: {
        x: { grid: { display: false }, ticks: { font: { family: 'Plus Jakarta Sans', size: 11 } } },
        y: {
          grid: { color: '#e8f3ee' },
          ticks: { font: { family: 'Plus Jakarta Sans', size: 11 }, callback: v => fmtBRLShort(v) }
        },
      },
    },
  });
}

function getMonthlyData(n) {
  const now = new Date();
  const result = [];
  for (let i = n - 1; i >= 0; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const lbl = d.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
    const receita = S.data.recebimentos
      .filter(r => r.status === 'pix' && r.date && r.date.startsWith(key))
      .reduce((s, r) => s + (r.value || 0), 0);
    const despesa = S.data.despesas
      .filter(r => r.date && r.date.startsWith(key))
      .reduce((s, r) => s + (r.value || 0), 0);
    result.push({ label: lbl.replace('.',''), receita, despesa });
  }
  return result;
}

function renderRecent() {
  const all = [
    ...S.data.recebimentos.slice(0, 8).map(r => ({ ...r, kind: 'rec' })),
    ...S.data.despesas.slice(0, 4).map(d => ({ ...d, kind: 'desp' })),
  ].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 10);

  const container = el('recent-list');
  if (!all.length) { container.innerHTML = '<div class="empty-state">Nenhum lançamento.</div>'; return; }
  container.innerHTML = all.map(item => {
    if (item.kind === 'rec') {
      return `<div class="recent-item">
        <div class="recent-item-left">
          <div class="recent-item-name">${esc(item.patient || '—')}</div>
          <div class="recent-item-meta">${fmtDate(item.date)} · ${labels.consultationType[item.consultationType] || item.consultationType}</div>
        </div>
        <div class="recent-item-right">
          <div class="recent-item-value">${fmtBRL(item.value || 0)}</div>
          <div class="recent-item-type">${statusBadge(item.status)}</div>
        </div>
      </div>`;
    } else {
      return `<div class="recent-item">
        <div class="recent-item-left">
          <div class="recent-item-name">${esc(item.description || '—')}</div>
          <div class="recent-item-meta">${fmtDate(item.date)} · ${labels.expenseCategory[item.category] || item.category}</div>
        </div>
        <div class="recent-item-right">
          <div class="recent-item-value" style="color:var(--red)">−${fmtBRL(item.value || 0)}</div>
          <div class="recent-item-type" style="font-size:.72rem;color:var(--text-muted)">Despesa</div>
        </div>
      </div>`;
    }
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// RECEBIMENTOS VIEW
// ─────────────────────────────────────────────────────────────────────────────
el('btn-novo-rec').addEventListener('click', () => openModalRec());

el('form-rec').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    date:            el('rec-data').value,
    patient:         el('rec-paciente').value.trim(),
    consultationType:el('rec-tipo').value,
    value:           parseFloat(el('rec-valor').value) || 0,
    status:          el('rec-status').value,
    invoiceStatus:   el('rec-nf').value,
    notes:           el('rec-obs').value.trim(),
  };
  await saveRecebimento(data, S.editingRec);
  closeModal('modal-rec');
  renderRecebimentos();
});

el('search-rec').addEventListener('input', renderRecebimentos);

function renderRecebimentos() {
  let recs = filteredRec();
  const q = el('search-rec').value.toLowerCase();
  if (q) recs = recs.filter(r => (r.patient || '').toLowerCase().includes(q));

  const total   = recs.reduce((s, r) => s + (r.value || 0), 0);
  const recebido = recs.filter(r => r.status === 'pix').reduce((s, r) => s + (r.value || 0), 0);

  const summary = el('summary-rec');
  summary.innerHTML = `${recs.length} reg. &nbsp;|&nbsp; Total: <strong>${fmtBRL(total)}</strong> &nbsp;|&nbsp; Recebido: <strong>${fmtBRL(recebido)}</strong>`;

  const tbody = el('tbody-rec');
  if (!recs.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Nenhum registro no período.</td></tr>';
    return;
  }
  tbody.innerHTML = recs.map(r => `
    <tr>
      <td>${fmtDate(r.date)}</td>
      <td>${esc(r.patient || '—')}</td>
      <td><span class="type-tag">${labels.consultationType[r.consultationType] || r.consultationType || '—'}</span></td>
      <td class="text-right value-cell">${fmtBRL(r.value || 0)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${nfBadge(r.invoiceStatus)}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);font-size:.78rem">${esc(r.notes || '')}</td>
      <td>
        <div class="action-btns">
          <button class="btn-edit" data-id="${r.id}" data-action="edit-rec">Editar</button>
          ${S.role === 'medica' ? `<button class="btn-del" data-id="${r.id}" data-action="del-rec">Excluir</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function openModalRec(rec = null) {
  S.editingRec = rec ? rec.id : null;
  el('modal-rec-title').textContent = rec ? 'Editar Recebimento' : 'Novo Recebimento';
  el('rec-id').value      = rec ? rec.id : '';
  el('rec-data').value    = rec ? rec.date : today();
  el('rec-paciente').value= rec ? (rec.patient || '') : '';
  el('rec-tipo').value    = rec ? (rec.consultationType || '') : '';
  el('rec-valor').value   = rec ? (rec.value || '') : '';
  el('rec-status').value  = rec ? (rec.status || '') : '';
  el('rec-nf').value      = rec ? (rec.invoiceStatus || 'pendente') : 'pendente';
  el('rec-obs').value     = rec ? (rec.notes || '') : '';
  openModal('modal-rec');
}

// ─────────────────────────────────────────────────────────────────────────────
// DESPESAS VIEW
// ─────────────────────────────────────────────────────────────────────────────
el('btn-nova-desp').addEventListener('click', () => openModalDesp());

el('form-desp').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    date:        el('desp-data').value,
    description: el('desp-desc').value.trim(),
    category:    el('desp-cat').value,
    recurrence:  el('desp-rec').value,
    value:       parseFloat(el('desp-valor').value) || 0,
  };
  await saveDespesa(data, S.editingDesp);
  closeModal('modal-desp');
  renderDespesas();
});

el('search-desp').addEventListener('input', renderDespesas);

function renderDespesas() {
  let desps = filteredDesp();
  const q = el('search-desp').value.toLowerCase();
  if (q) desps = desps.filter(d => (d.description || '').toLowerCase().includes(q));

  const total = desps.reduce((s, d) => s + (d.value || 0), 0);
  el('summary-desp').innerHTML = `${desps.length} reg. &nbsp;|&nbsp; Total: <strong>${fmtBRL(total)}</strong>`;

  const tbody = el('tbody-desp');
  if (!desps.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Nenhuma despesa no período.</td></tr>';
    return;
  }
  tbody.innerHTML = desps.map(d => `
    <tr>
      <td>${fmtDate(d.date)}</td>
      <td>${esc(d.description || '—')}</td>
      <td><span class="cat-tag">${labels.expenseCategory[d.category] || d.category || '—'}</span></td>
      <td><span class="cat-tag">${labels.recurrence[d.recurrence] || d.recurrence || 'Única'}</span></td>
      <td class="text-right value-cell" style="color:var(--red)">${fmtBRL(d.value || 0)}</td>
      <td>
        <div class="action-btns">
          <button class="btn-edit" data-id="${d.id}" data-action="edit-desp">Editar</button>
          ${S.role === 'medica' ? `<button class="btn-del" data-id="${d.id}" data-action="del-desp">Excluir</button>` : ''}
        </div>
      </td>
    </tr>
  `).join('');
}

function openModalDesp(desp = null) {
  S.editingDesp = desp ? desp.id : null;
  el('modal-desp-title').textContent = desp ? 'Editar Despesa' : 'Nova Despesa';
  el('desp-id').value    = desp ? desp.id : '';
  el('desp-data').value  = desp ? desp.date : today();
  el('desp-desc').value  = desp ? (desp.description || '') : '';
  el('desp-cat').value   = desp ? (desp.category || '') : '';
  el('desp-rec').value   = desp ? (desp.recurrence || 'unica') : 'unica';
  el('desp-valor').value = desp ? (desp.value || '') : '';
  openModal('modal-desp');
}

// ─────────────────────────────────────────────────────────────────────────────
// INADIMPLÊNCIA VIEW
// ─────────────────────────────────────────────────────────────────────────────
function renderInadimplencia() {
  const pendentes = S.data.recebimentos
    .filter(r => r.status === 'pendente')
    .sort((a, b) => a.date.localeCompare(b.date));

  const sumEl = el('inadimplencia-summary');
  if (pendentes.length) {
    const total = pendentes.reduce((s, r) => s + (r.value || 0), 0);
    sumEl.classList.remove('hidden');
    sumEl.innerHTML = `<strong>${pendentes.length} pagamento${pendentes.length > 1 ? 's' : ''} pendente${pendentes.length > 1 ? 's' : ''}</strong> &nbsp;·&nbsp; Total em aberto: <strong>${fmtBRL(total)}</strong>`;
  } else {
    sumEl.classList.add('hidden');
  }

  const tbody = el('tbody-inadimplencia');
  if (!pendentes.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Nenhum pagamento pendente. 🎉</td></tr>';
    return;
  }
  const today_ = today();
  tbody.innerHTML = pendentes.map(r => {
    const dias = daysBetween(r.date, today_);
    const daysCls = dias <= 7 ? 'days-ok' : dias <= 30 ? 'days-warning' : 'days-danger';
    return `<tr>
      <td>${fmtDate(r.date)}</td>
      <td>${esc(r.patient || '—')}</td>
      <td><span class="type-tag">${labels.consultationType[r.consultationType] || r.consultationType || '—'}</span></td>
      <td class="text-right value-cell">${fmtBRL(r.value || 0)}</td>
      <td><span class="days-badge ${daysCls}">${dias} dia${dias !== 1 ? 's' : ''}</span></td>
      <td>
        <button class="btn-received" data-id="${r.id}" data-action="mark-received">✓ Marcar Recebido</button>
      </td>
    </tr>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// SECRETARIA VIEW
// ─────────────────────────────────────────────────────────────────────────────
el('form-rapido').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = el('r-status').value;
  const data = {
    date:            el('r-data').value,
    patient:         el('r-paciente').value.trim(),
    consultationType:el('r-tipo').value,
    value:           parseFloat(el('r-valor').value) || 0,
    status,
    invoiceStatus:   status === 'gratuito' ? 'isenta' : el('r-nf').value,
    notes:           '',
  };
  await saveRecebimento(data);
  el('form-rapido').reset();
  el('r-data').value = today();
  renderSecretaria();
  showToast('Lançamento salvo!', 'success');
});

el('btn-nova-nota').addEventListener('click', () => openModalNota());

el('form-nota').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = { content: el('nota-content').value.trim() };
  if (!data.content) return;
  await saveNota(data, S.editingNota);
  closeModal('modal-nota');
  renderSecretaria();
});

function renderSecretaria() {
  renderNFPendentes();
  renderNotas();
  // Pre-fill today in quick form
  if (!el('r-data').value) el('r-data').value = today();
}

function renderNFPendentes() {
  const pendNF = S.data.recebimentos
    .filter(r => r.invoiceStatus === 'pendente' && r.status !== 'gratuito')
    .sort((a, b) => a.date.localeCompare(b.date));

  el('nf-count-pill').textContent = pendNF.length;

  const nfList = el('nf-list');
  if (!pendNF.length) { nfList.innerHTML = '<div class="empty-state">Nenhuma NF pendente de emissão.</div>'; return; }

  nfList.innerHTML = pendNF.map(r => `
    <div class="nf-item">
      <div class="nf-item-left">
        <div class="nf-item-name">${esc(r.patient || '—')}</div>
        <div class="nf-item-meta">${fmtDate(r.date)} · ${labels.consultationType[r.consultationType] || r.consultationType}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="nf-item-value">${fmtBRL(r.value || 0)}</div>
        <button class="btn btn-sm btn-primary" data-id="${r.id}" data-action="mark-nf">Emitida</button>
      </div>
    </div>
  `).join('');
}

function renderNotas() {
  const notasList = el('notas-list');
  if (!S.data.notas.length) { notasList.innerHTML = '<div class="empty-state">Nenhuma anotação.</div>'; return; }
  notasList.innerHTML = S.data.notas.map(n => `
    <div class="nota-item">
      <div class="nota-content">${esc(n.content || '')}</div>
      <div class="nota-meta">
        <span>${n.createdAt ? fmtTimestamp(n.createdAt) : ''}</span>
        <div class="nota-actions">
          <button class="btn btn-sm btn-outline" data-id="${n.id}" data-action="edit-nota">Editar</button>
          <button class="btn btn-sm btn-danger" data-id="${n.id}" data-action="del-nota">Excluir</button>
        </div>
      </div>
    </div>
  `).join('');
}

function openModalNota(nota = null) {
  S.editingNota = nota ? nota.id : null;
  el('nota-id').value      = nota ? nota.id : '';
  el('nota-content').value = nota ? (nota.content || '') : '';
  openModal('modal-nota');
}

// ─────────────────────────────────────────────────────────────────────────────
// DRE VIEW
// ─────────────────────────────────────────────────────────────────────────────
function renderDRE() {
  const recs  = filteredRec();
  const desps = filteredDesp();

  el('dre-period').textContent = S.filter.start ? `${fmtDate(S.filter.start)} → ${fmtDate(S.filter.end)}` : '';

  // Receitas por tipo
  const recByType = {};
  const typeOrder = ['primeira', 'retorno', 'teleconsulta', 'atestado'];
  typeOrder.forEach(t => { recByType[t] = 0; });
  recs.filter(r => r.status !== 'gratuito').forEach(r => {
    recByType[r.consultationType] = (recByType[r.consultationType] || 0) + (r.value || 0);
  });
  const totalRec = Object.values(recByType).reduce((s, v) => s + v, 0);

  // Despesas por categoria
  const despByCat = {};
  const catOrder = ['aluguel','iclinic','secretaria','contador','material','impostos','outros'];
  catOrder.forEach(c => { despByCat[c] = 0; });
  desps.forEach(d => { despByCat[d.category] = (despByCat[d.category] || 0) + (d.value || 0); });
  const totalDesp = Object.values(despByCat).reduce((s, v) => s + v, 0);

  const resultado = totalRec - totalDesp;
  const margem    = totalRec > 0 ? (resultado / totalRec * 100) : 0;

  // Other metrics
  const paidRecs   = recs.filter(r => r.status === 'pix');
  const ticket     = paidRecs.length > 0 ? paidRecs.reduce((s, r) => s + (r.value||0), 0) / paidRecs.length : 0;
  const gratuitos  = recs.filter(r => r.status === 'gratuito').length;
  const pendente   = recs.filter(r => r.status === 'pendente').reduce((s, r) => s + (r.value||0), 0);

  const pct = (v) => totalRec > 0 ? (v/totalRec*100).toFixed(1)+'%' : '—';

  const rows = [
    ['section', 'RECEITAS'],
    ...typeOrder.map(t => ['item', labels.consultationType[t], recByType[t], pct(recByType[t])]),
    ['item', 'A Receber (Pendente)', pendente, pct(pendente)],
    ['subtotal', 'Total Receita Bruta', totalRec, '100%'],
    ['spacer'],
    ['section', 'DESPESAS'],
    ...catOrder.map(c => ['item', labels.expenseCategory[c], despByCat[c], pct(despByCat[c])]),
    ['subtotal', 'Total Despesas', totalDesp, pct(totalDesp)],
    ['spacer'],
    ['section', 'RESULTADO'],
    ['total', 'Resultado Líquido', resultado, `${margem.toFixed(1)}%`],
    ['item', 'Margem Líquida', '', `${margem.toFixed(1)}%`],
    ['item', 'Ticket Médio (consultas pagas)', ticket, ''],
    ['item', 'Total Atendimentos', recs.length + ' consultas', ''],
    ['item', 'Atendimentos Gratuitos', gratuitos + ' consultas', ''],
  ];

  const tbody = el('tbody-dre');
  tbody.innerHTML = rows.map(row => {
    if (row[0] === 'section') return `<tr class="dre-section-header"><td colspan="3">${row[1]}</td></tr>`;
    if (row[0] === 'spacer')  return `<tr><td colspan="3" style="padding:6px"></td></tr>`;
    if (row[0] === 'subtotal') return `<tr class="dre-subtotal"><td>${row[1]}</td><td class="text-right">${typeof row[2] === 'number' ? fmtBRL(row[2]) : row[2]}</td><td class="text-right">${row[3]}</td></tr>`;
    if (row[0] === 'total') {
      const cls = row[2] >= 0 ? 'dre-positive' : 'dre-negative';
      return `<tr class="dre-total"><td>${row[1]}</td><td class="text-right ${cls}">${fmtBRL(row[2])}</td><td class="text-right ${cls}">${row[3]}</td></tr>`;
    }
    const valStr = typeof row[2] === 'number' ? (row[2] > 0 ? fmtBRL(row[2]) : '—') : (row[2] || '—');
    return `<tr><td style="padding-left:32px">${row[1]}</td><td class="text-right">${valStr}</td><td class="text-right" style="color:var(--text-muted)">${row[3] || ''}</td></tr>`;
  }).join('');

  renderDRECharts(recByType, despByCat, typeOrder, catOrder);
}

function renderDRECharts(recByType, despByCat, typeOrder, catOrder) {
  const recColors  = ['#2d7a5f','#45b08c','#71c9a7','#a8ddc8'];
  const despColors = ['#e07b54','#5ba88a','#7b6ec0','#c0aa3d','#3d88c0','#c03d5a','#9a9a9a'];

  const ctxRT = el('chart-rec-tipo').getContext('2d');
  if (S.charts.recTipo) S.charts.recTipo.destroy();
  S.charts.recTipo = new Chart(ctxRT, {
    type: 'doughnut',
    data: {
      labels: typeOrder.map(t => labels.consultationType[t]),
      datasets: [{ data: typeOrder.map(t => recByType[t] || 0), backgroundColor: recColors, borderWidth: 2, borderColor: '#fff' }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { family: 'Plus Jakarta Sans', size: 10 }, boxWidth: 10, padding: 8 } } },
    },
  });

  const ctxDC = el('chart-desp-cat').getContext('2d');
  if (S.charts.despCat) S.charts.despCat.destroy();
  S.charts.despCat = new Chart(ctxDC, {
    type: 'doughnut',
    data: {
      labels: catOrder.map(c => labels.expenseCategory[c]),
      datasets: [{ data: catOrder.map(c => despByCat[c] || 0), backgroundColor: despColors, borderWidth: 2, borderColor: '#fff' }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { family: 'Plus Jakarta Sans', size: 10 }, boxWidth: 10, padding: 8 } } },
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV IMPORT
// ─────────────────────────────────────────────────────────────────────────────
const csvInput  = el('csv-input');
const uploadArea = el('upload-area');

uploadArea.addEventListener('dragover',  e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', e => {
  e.preventDefault(); uploadArea.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) processCSVFile(file);
});

csvInput.addEventListener('change', () => {
  if (csvInput.files[0]) processCSVFile(csvInput.files[0]);
});

el('btn-cancel-import').addEventListener('click', () => {
  el('import-mapping').classList.add('hidden');
  el('import-result').classList.add('hidden');
  csvInput.value = '';
  S.csvData = null;
});

el('btn-confirm-import').addEventListener('click', confirmCSVImport);

function processCSVFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const text = e.target.result;
      const sep  = text.includes(';') ? ';' : ',';
      const lines = text.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) { showToast('Arquivo CSV vazio ou inválido.', 'error'); return; }
      const headers = splitCSV(lines[0], sep).map(h => h.trim().replace(/^"|"$/g,''));
      const rows    = lines.slice(1).map(l => splitCSV(l, sep).map(c => c.trim().replace(/^"|"$/g,'')));
      S.csvHeaders = headers;
      S.csvData    = rows;
      renderCSVMapping(headers, rows.slice(0, 5));
    } catch (err) {
      showToast('Erro ao ler o arquivo CSV.', 'error');
    }
  };
  reader.readAsText(file, 'UTF-8');
}

function splitCSV(line, sep) {
  const res = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === sep && !inQ) { res.push(cur); cur = ''; }
    else { cur += ch; }
  }
  res.push(cur);
  return res;
}

function renderCSVMapping(headers, preview) {
  const fields = [
    { key: 'date',            label: 'Data',              required: true },
    { key: 'patient',         label: 'Paciente',          required: true },
    { key: 'consultationType',label: 'Tipo de Consulta',  required: false },
    { key: 'value',           label: 'Valor (R$)',         required: true },
    { key: 'status',          label: 'Status Pagamento',  required: false },
  ];

  const grid = el('mapping-grid');
  grid.innerHTML = fields.map(f => `
    <div class="mapping-item">
      <label>${f.label}${f.required ? ' *' : ''}</label>
      <select id="map-${f.key}" class="form-control" style="border:1.5px solid var(--border);border-radius:6px;padding:7px 10px;width:100%">
        <option value="">— Ignorar —</option>
        ${headers.map((h, i) => `<option value="${i}"${guessMapping(f.key, h) ? ' selected' : ''}>${h}</option>`).join('')}
      </select>
    </div>
  `).join('');

  // Preview table
  const table = el('import-preview-table');
  table.innerHTML = `
    <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${preview.map(row => `<tr>${row.map(c => `<td style="font-size:.8rem">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
  `;

  el('import-mapping').classList.remove('hidden');
  el('import-result').classList.add('hidden');
}

function guessMapping(field, header) {
  const h = header.toLowerCase();
  const map = {
    date:             ['data','date','dia'],
    patient:          ['paciente','patient','nome','name','cliente'],
    consultationType: ['tipo','type','procedimento','procedure','consulta'],
    value:            ['valor','value','preço','preco','price','total'],
    status:           ['status','situação','situacao','pagamento'],
  };
  return (map[field] || []).some(k => h.includes(k));
}

async function confirmCSVImport() {
  if (!S.csvData) return;
  const getCol = (key) => {
    const sel = document.getElementById('map-' + key);
    return sel ? parseInt(sel.value) : NaN;
  };

  const dateIdx    = getCol('date');
  const patIdx     = getCol('patient');
  const valueIdx   = getCol('value');
  const typeIdx    = getCol('consultationType');
  const statusIdx  = getCol('status');

  if (isNaN(dateIdx) || isNaN(patIdx) || isNaN(valueIdx)) {
    showToast('Mapeie os campos obrigatórios: Data, Paciente e Valor.', 'error'); return;
  }

  showLoading();
  let imported = 0, skipped = 0;
  for (const row of S.csvData) {
    try {
      const rawDate  = row[dateIdx] || '';
      const date     = parseCSVDate(rawDate);
      const patient  = row[patIdx] || '';
      const rawVal   = (row[valueIdx] || '0').replace(/[^\d,.-]/g,'').replace(',','.');
      const value    = parseFloat(rawVal) || 0;
      if (!date || !patient) { skipped++; continue; }

      const rawType  = !isNaN(typeIdx) ? row[typeIdx] : '';
      const rawStat  = !isNaN(statusIdx) ? row[statusIdx] : '';

      await addDoc(collection(db, 'recebimentos'), {
        date,
        patient: patient.trim(),
        consultationType: guessType(rawType),
        value,
        status:       guessStatus(rawStat),
        invoiceStatus:'pendente',
        notes:        `Importado do iClinic`,
        createdAt:    serverTimestamp(),
        createdBy:    S.user.uid,
      });
      imported++;
    } catch { skipped++; }
  }
  await reloadCollection('recebimentos');
  updateBadges();
  hideLoading();

  const res = el('import-result');
  res.classList.remove('hidden');
  res.innerHTML = `<strong>Importação concluída!</strong> ${imported} registro${imported !== 1 ? 's' : ''} importado${imported !== 1 ? 's' : ''}${skipped ? `, ${skipped} ignorado${skipped !== 1 ? 's' : ''}` : ''}.`;
  el('import-mapping').classList.add('hidden');
  showToast(`${imported} registros importados!`, 'success');
}

function parseCSVDate(str) {
  if (!str) return '';
  // DD/MM/YYYY
  let m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  // YYYY-MM-DD
  m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  // DD-MM-YYYY
  m = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return '';
}

function guessType(raw) {
  const r = (raw || '').toLowerCase();
  if (r.includes('telec')) return 'teleconsulta';
  if (r.includes('atestado')) return 'atestado';
  if (r.includes('primeir') || r.includes('inicial') || r.includes('first')) return 'primeira';
  return 'retorno';
}

function guessStatus(raw) {
  const r = (raw || '').toLowerCase();
  if (r.includes('pag') || r.includes('receb') || r.includes('pix') || r.includes('paid')) return 'pix';
  if (r.includes('gratu') || r.includes('free') || r.includes('isenç')) return 'gratuito';
  return 'pendente';
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────
function openModal(id)  { el(id).classList.remove('hidden'); }
function closeModal(id) { el(id).classList.add('hidden'); }

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELEGATED EVENTS (table actions)
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const id     = btn.dataset.id;

  if (action === 'edit-rec') {
    const rec = S.data.recebimentos.find(r => r.id === id);
    if (rec) openModalRec(rec);
  } else if (action === 'del-rec') {
    deleteRec(id);
  } else if (action === 'edit-desp') {
    const desp = S.data.despesas.find(d => d.id === id);
    if (desp) openModalDesp(desp);
  } else if (action === 'del-desp') {
    deleteDesp(id);
  } else if (action === 'mark-received') {
    markReceived(id);
  } else if (action === 'mark-nf') {
    markNFEmitida(id);
  } else if (action === 'edit-nota') {
    const nota = S.data.notas.find(n => n.id === id);
    if (nota) openModalNota(nota);
  } else if (action === 'del-nota') {
    deleteNota(id);
  }
});

// Alert link
document.querySelectorAll('.alert-link[data-view]').forEach(a => {
  a.addEventListener('click', (e) => { e.preventDefault(); navigateTo(a.dataset.view); });
});

// Sidebar toggle
el('sidebar-toggle').addEventListener('click', () => {
  el('sidebar').classList.toggle('collapsed');
});

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
function el(id)              { return document.getElementById(id); }
function setText(id, txt)    { const e = el(id); if (e) e.textContent = txt; }
function esc(str)            { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function today()             { return new Date().toISOString().split('T')[0]; }
function fmtBRL(v)           { return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v||0); }
function fmtBRLShort(v)      { return v >= 1000 ? 'R$'+(v/1000).toFixed(0)+'k' : fmtBRL(v); }
function fmtDate(d)          { if (!d) return '—'; const [y,m,dy] = d.split('-'); return `${dy}/${m}/${y}`; }
function fmtTimestamp(ts)    { try { return ts.toDate().toLocaleDateString('pt-BR', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); } catch { return ''; } }
function daysBetween(d1,d2)  { return Math.max(0, Math.round((new Date(d2) - new Date(d1)) / 86400000)); }
function sumWhere(arr, pred) { return arr.filter(pred).reduce((s, r) => s + (r.value || 0), 0); }

function statusBadge(status) {
  const map = { pix:'badge-pix', pendente:'badge-pendente', gratuito:'badge-gratuito' };
  const lbl = labels.status[status] || status || '—';
  return `<span class="badge ${map[status]||''}">${lbl}</span>`;
}
function nfBadge(status) {
  const map = { pendente:'badge-nf-pendente', emitida:'badge-emitida', isenta:'badge-isenta' };
  const lbl = labels.invoiceStatus[status] || status || '—';
  return `<span class="badge ${map[status]||''}">${lbl}</span>`;
}

let toastTimer = null;
function showToast(msg, type = 'success') {
  const t  = el('toast');
  const ic = el('toast-icon');
  const mg = el('toast-msg');
  const icons = { success: '✓', error: '✕', info: 'ℹ' };
  t.className = `toast toast-${type}`;
  ic.textContent = icons[type] || '✓';
  mg.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
}

function showLoading()  { el('loading-overlay').classList.remove('hidden'); }
function hideLoading()  { el('loading-overlay').classList.add('hidden'); }

// ─────────────────────────────────────────────────────────────────────────────
// BOOTSTRAP — init filter to current month on load
// ─────────────────────────────────────────────────────────────────────────────
applyPreset('mes');
