// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS
// ─────────────────────────────────────────────────────────────────────────────
import { firebaseConfig, userRoles, labels } from './firebase-config.js';

import { initializeApp }                                      from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
                                                              from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, addDoc, getDocs, updateDoc, deleteDoc,
         doc, query, orderBy, serverTimestamp, writeBatch }
                                                              from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ─────────────────────────────────────────────────────────────────────────────
// FIREBASE INIT
// ─────────────────────────────────────────────────────────────────────────────
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
const S = {
  user:            null,
  role:            null,
  view:            'dashboard',
  filter:          { preset: 'mes', start: '', end: '' },
  data:            { recebimentos: [], despesas: [], notas: [], patients: [], consultations: [] },
  charts:          { mensal: null, recTipo: null, despCat: null },
  editingRec:      null,
  editingDesp:     null,
  editingNota:     null,
  editingPaciente: null,
  currentPatient:  null,
  importFiles:     { patient: null, bill: null, event: null },
  nfSelected:      new Set(),
  inadimSelected:  new Set(),
  calendarYear:    new Date().getFullYear(),
  calendarMonth:   new Date().getMonth(),
  calendarSelDay:  null,
};

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
  if (user) {
    const role = userRoles[user.email];
    if (!role) {
      showToast('E-mail não autorizado.', 'error');
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

el('btn-logout').addEventListener('click', () => signOut(auth));

function applyRoleUI() {
  const isMedica = S.role === 'medica';
  document.querySelectorAll('.nav-medica-only').forEach(e => e.classList.toggle('hidden', !isMedica));
  el('sidebar-avatar').textContent    = isMedica ? 'M' : 'S';
  el('sidebar-user-name').textContent = S.user.email.split('@')[0];
  el('sidebar-user-role').textContent = labels.role[S.role];
  el('login-screen').classList.add('hidden');
  el('app-shell').classList.remove('hidden');
}

function friendlyAuthError(code) {
  const map = {
    'auth/invalid-credential':     'E-mail ou senha incorretos.',
    'auth/user-not-found':         'Usuária não encontrada.',
    'auth/wrong-password':         'Senha incorreta.',
    'auth/too-many-requests':      'Muitas tentativas. Aguarde alguns minutos.',
    'auth/network-request-failed': 'Erro de rede. Verifique sua conexão.',
    'auth/invalid-email':          'E-mail inválido.',
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
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  el('filter-bar').classList.toggle('hidden', ['import','paciente-detalhe','agenda'].includes(view));
  renderView(view);
}

function navigateToPatient(patientId) {
  S.currentPatient = patientId;
  S.view = 'paciente-detalhe';
  document.querySelectorAll('section.view').forEach(s => s.classList.add('hidden'));
  el('view-paciente-detalhe').classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  el('filter-bar').classList.add('hidden');
  renderPacienteDetalhe(patientId);
}

function renderView(view) {
  switch (view) {
    case 'dashboard':    renderDashboard();    break;
    case 'pacientes':    renderPacientes();    break;
    case 'recebimentos': renderRecebimentos(); break;
    case 'despesas':     renderDespesas();     break;
    case 'inadimplencia':renderInadimplencia();break;
    case 'secretaria':   renderSecretaria();   break;
    case 'dre':          renderDRE();          break;
    case 'agenda':       renderAgenda();       break;
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
  if (start > end)    { showToast('Data inicial deve ser anterior à final.', 'error'); return; }
  S.filter = { preset: 'custom', start, end };
  el('filter-label').textContent = `${fmtDate(start)} → ${fmtDate(end)}`;
  renderView(S.view);
});

function applyPreset(preset) {
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  let start, end;
  if      (preset === 'mes')       { start = ymd(new Date(now.getFullYear(), now.getMonth(), 1));    end = ymd(new Date(now.getFullYear(), now.getMonth()+1, 0)); }
  else if (preset === 'mespassado'){ start = ymd(new Date(now.getFullYear(), now.getMonth()-1, 1));  end = ymd(new Date(now.getFullYear(), now.getMonth(), 0)); }
  else if (preset === '3meses')    { start = ymd(new Date(now.getFullYear(), now.getMonth()-2, 1));  end = ymd(new Date(now.getFullYear(), now.getMonth()+1, 0)); }
  else if (preset === '6meses')    { start = ymd(new Date(now.getFullYear(), now.getMonth()-5, 1));  end = ymd(new Date(now.getFullYear(), now.getMonth()+1, 0)); }
  else if (preset === 'ano')       { start = `${now.getFullYear()}-01-01`;                            end = `${now.getFullYear()}-12-31`; }
  S.filter = { preset, start, end };
  el('filter-label').textContent = `${fmtDate(start)} → ${fmtDate(end)}`;
  renderView(S.view);
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
    const [recs, desps, notas, patients, consults] = await Promise.all([
      fetchCollection('recebimentos',  [orderBy('date', 'desc')]),
      fetchCollection('despesas',      [orderBy('date', 'desc')]),
      fetchCollection('notas',         [orderBy('createdAt', 'desc')]),
      fetchCollection('patients',      [orderBy('name', 'asc')]),
      fetchCollection('consultations', [orderBy('date', 'desc')]),
    ]);
    S.data.recebimentos  = recs;
    S.data.despesas      = desps;
    S.data.notas         = notas;
    S.data.patients      = patients;
    S.data.consultations = consults;
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

async function reloadCollection(name) {
  const ords = {
    notas:         [orderBy('createdAt','desc')],
    patients:      [orderBy('name','asc')],
    consultations: [orderBy('date','desc')],
  };
  S.data[name] = await fetchCollection(name, ords[name] || [orderBy('date','desc')]);
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
  const e = el(id); e.textContent = n; e.classList.toggle('hidden', n === 0);
}

// ── Recebimentos ──────────────────────────────────────────
async function saveRecebimento(data, id = null) {
  showLoading();
  try {
    if (id) { await updateDoc(doc(db, 'recebimentos', id), { ...data, updatedAt: serverTimestamp() }); }
    else    { await addDoc(collection(db, 'recebimentos'), { ...data, createdAt: serverTimestamp(), createdBy: S.user.uid }); }
    await reloadCollection('recebimentos');
    updateBadges();
    showToast('Recebimento salvo!', 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

async function deleteRec(id) {
  if (!confirm('Excluir este recebimento?')) return;
  showLoading();
  try {
    await deleteDoc(doc(db, 'recebimentos', id));
    await reloadCollection('recebimentos');
    updateBadges(); renderView(S.view);
    showToast('Recebimento excluído.', 'info');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

async function markReceived(id) {
  showLoading();
  try {
    await updateDoc(doc(db, 'recebimentos', id), { status: 'pix', updatedAt: serverTimestamp() });
    await reloadCollection('recebimentos');
    updateBadges(); renderView(S.view);
    showToast('Marcado como recebido via PIX!', 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

// ── Despesas ──────────────────────────────────────────────
async function saveDespesa(data, id = null) {
  showLoading();
  try {
    if (id) { await updateDoc(doc(db, 'despesas', id), { ...data, updatedAt: serverTimestamp() }); }
    else    { await addDoc(collection(db, 'despesas'), { ...data, createdAt: serverTimestamp(), createdBy: S.user.uid }); }
    await reloadCollection('despesas');
    showToast('Despesa salva!', 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

async function deleteDesp(id) {
  if (!confirm('Excluir esta despesa?')) return;
  showLoading();
  try {
    await deleteDoc(doc(db, 'despesas', id));
    await reloadCollection('despesas'); renderView(S.view);
    showToast('Despesa excluída.', 'info');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

// ── Notas ─────────────────────────────────────────────────
async function saveNota(data, id = null) {
  showLoading();
  try {
    if (id) { await updateDoc(doc(db, 'notas', id), { ...data, updatedAt: serverTimestamp() }); }
    else    { await addDoc(collection(db, 'notas'), { ...data, createdAt: serverTimestamp(), createdBy: S.user.uid }); }
    await reloadCollection('notas');
    showToast('Anotação salva!', 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

async function deleteNota(id) {
  if (!confirm('Excluir esta anotação?')) return;
  showLoading();
  try {
    await deleteDoc(doc(db, 'notas', id));
    await reloadCollection('notas'); renderSecretaria();
    showToast('Anotação excluída.', 'info');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

// ── Pacientes ─────────────────────────────────────────────
async function savePatient(data, id = null) {
  showLoading();
  try {
    if (id) { await updateDoc(doc(db, 'patients', id), { ...data, updatedAt: serverTimestamp() }); }
    else    { await addDoc(collection(db, 'patients'), { ...data, createdAt: serverTimestamp(), createdBy: S.user.uid }); }
    await reloadCollection('patients');
    showToast('Paciente salvo!', 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

async function deletePatient(id) {
  if (!confirm('Excluir este paciente? O histórico de consultas será mantido.')) return;
  showLoading();
  try {
    await deleteDoc(doc(db, 'patients', id));
    await reloadCollection('patients'); renderPacientes();
    showToast('Paciente excluído.', 'info');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// MARK ALL NFs EMITTED
// ─────────────────────────────────────────────────────────────────────────────
async function markAllPastNFsEmitted() {
  const todayStr = today();
  const targets  = S.data.recebimentos.filter(r =>
    r.invoiceStatus === 'pendente' && r.status !== 'gratuito' && r.date <= todayStr
  );
  if (!targets.length) { showToast('Nenhuma NF pendente até hoje.', 'info'); return; }
  if (!confirm(`Marcar ${targets.length} nota${targets.length > 1 ? 's fiscais' : ' fiscal'} como emitida${targets.length > 1 ? 's' : ''}?\n\nEsta ação não pode ser desfeita.`)) return;

  showLoading();
  try {
    for (let i = 0; i < targets.length; i += 400) {
      const batch = writeBatch(db);
      targets.slice(i, i + 400).forEach(r => {
        batch.update(doc(db, 'recebimentos', r.id), { invoiceStatus: 'emitida', updatedAt: serverTimestamp() });
      });
      await batch.commit();
    }
    await reloadCollection('recebimentos');
    updateBadges();
    renderView(S.view);
    showToast(`${targets.length} NF${targets.length > 1 ? 's marcadas' : ' marcada'} como emitida${targets.length > 1 ? 's' : ''}!`, 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// DUPLICATE DETECTION & MERGE
// ─────────────────────────────────────────────────────────────────────────────
function normalizePhone(phone) { return (phone || '').replace(/\D/g, ''); }
function normalizeStr(str) {
  return (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function detectDuplicates() {
  const byPhone = {};
  const byName  = {};

  S.data.patients.forEach(p => {
    const phone = normalizePhone(p.phone || '');
    if (phone.length >= 8) {
      if (!byPhone[phone]) byPhone[phone] = [];
      byPhone[phone].push(p);
    }
    const norm = normalizeStr(p.name || '');
    if (norm.length > 3) {
      if (!byName[norm]) byName[norm] = [];
      byName[norm].push(p);
    }
  });

  const seen   = new Set();
  const groups = [];

  [...Object.values(byPhone), ...Object.values(byName)]
    .filter(g => g.length > 1)
    .forEach(g => {
      for (let i = 0; i < g.length - 1; i++) {
        for (let j = i + 1; j < g.length; j++) {
          const key = [g[i].id, g[j].id].sort().join('_');
          if (!seen.has(key)) {
            seen.add(key);
            groups.push([g[i], g[j]]);
          }
        }
      }
    });

  return groups;
}

function renderDuplicatesSection() {
  const groups  = detectDuplicates();
  const section = el('dup-section');
  if (!groups.length) { section.classList.add('hidden'); return; }

  section.classList.remove('hidden');
  setText('dup-title', `${groups.length} possível duplicata${groups.length !== 1 ? 's' : ''} detectada${groups.length !== 1 ? 's' : ''} — verifique e mescle se necessário`);

  el('dup-groups').innerHTML = groups.map(([a, b]) => {
    const sA = getPatientStats(a.id, a.name);
    const sB = getPatientStats(b.id, b.name);
    const pA = normalizePhone(a.phone || '');
    const pB = normalizePhone(b.phone || '');
    const samePhone = pA.length >= 8 && pA === pB;
    const sameName  = normalizeStr(a.name || '') === normalizeStr(b.name || '');
    const reason    = [samePhone && 'mesmo telefone', sameName && 'mesmo nome'].filter(Boolean).join(' + ');

    const rowHtml = (pac, keepId, dropId, stats) => `
      <div class="dup-patient-row">
        <div class="dup-patient-info">
          <strong>${esc(pac.name || '—')}</strong>
          <div class="dup-patient-meta">${esc(pac.phone || '—')} · ${stats.totalConsultas} consulta${stats.totalConsultas !== 1 ? 's' : ''} · ${fmtBRL(stats.totalPago)} pago</div>
        </div>
        <button class="dup-merge-btn" data-action="merge-pac" data-keep="${keepId}" data-drop="${dropId}">Manter este →</button>
      </div>`;

    return `<div class="dup-group">
      <div class="dup-group-header">${reason || 'Cadastros similares'}</div>
      <div class="dup-group-body">
        ${rowHtml(a, a.id, b.id, sA)}
        ${rowHtml(b, b.id, a.id, sB)}
      </div>
    </div>`;
  }).join('');
}

async function mergePacientes(keepId, dropId) {
  const keepPac = S.data.patients.find(p => p.id === keepId);
  const dropPac = S.data.patients.find(p => p.id === dropId);
  if (!keepPac || !dropPac) return;

  if (!confirm(`Manter "${keepPac.name}" e excluir "${dropPac.name}"?\n\nTodos os recebimentos e agendamentos serão transferidos. Esta ação não pode ser desfeita.`)) return;

  showLoading();
  try {
    const recsToMove    = S.data.recebimentos.filter(r => r.patientId === dropId);
    const consultsToMove = S.data.consultations.filter(c => c.patientId === dropId);

    const updates = [
      ...recsToMove.map(r    => ({ col: 'recebimentos',  id: r.id, data: { patientId: keepId, patient:     keepPac.name } })),
      ...consultsToMove.map(c => ({ col: 'consultations', id: c.id, data: { patientId: keepId, patientName: keepPac.name } })),
    ];

    for (let i = 0; i < updates.length; i += 400) {
      const batch = writeBatch(db);
      updates.slice(i, i + 400).forEach(u =>
        batch.update(doc(db, u.col, u.id), { ...u.data, updatedAt: serverTimestamp() })
      );
      await batch.commit();
    }

    // Carry over phone2 from the deleted patient if it adds info
    const extras = {};
    if (dropPac.phone && dropPac.phone !== keepPac.phone && !keepPac.phone2) extras.phone2 = dropPac.phone;

    if (Object.keys(extras).length) {
      await updateDoc(doc(db, 'patients', keepId), { ...extras, updatedAt: serverTimestamp() });
    }

    await deleteDoc(doc(db, 'patients', dropId));

    await Promise.all([
      reloadCollection('patients'),
      reloadCollection('recebimentos'),
      reloadCollection('consultations'),
    ]);

    updateBadges();
    renderPacientes();
    showToast('Pacientes mesclados com sucesso!', 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function renderDashboard() {
  const recs  = filteredRec();
  const desps = filteredDesp();
  const recebida  = sumWhere(recs,  r => r.status === 'pix');
  const pendente  = sumWhere(recs,  r => r.status === 'pendente');
  const totalDesp = desps.reduce((s, d) => s + (d.value||0), 0);
  const resultado = recebida - totalDesp;
  const margem    = recebida > 0 ? (resultado/recebida*100).toFixed(1) : 0;
  const gratuitos = recs.filter(r => r.status === 'gratuito').length;
  const paid      = recs.filter(r => r.status === 'pix');
  const ticket    = paid.length > 0 ? paid.reduce((s,r)=>s+(r.value||0),0)/paid.length : 0;

  setText('kpi-receita',      fmtBRL(recebida));
  setText('kpi-receita-meta', `${paid.length} atendimentos pagos`);
  setText('kpi-pendente',     fmtBRL(pendente));
  setText('kpi-pendente-meta',`${recs.filter(r=>r.status==='pendente').length} pendentes`);
  setText('kpi-despesas',     fmtBRL(totalDesp));
  setText('kpi-despesas-meta',`${desps.length} lançamentos`);
  setText('kpi-resultado',    fmtBRL(resultado));
  setText('kpi-resultado-meta',`Margem: ${margem}%`);
  el('kpi-resultado').style.color = resultado >= 0 ? '' : 'var(--red)';
  setText('kpi-gratuito',     gratuitos);
  setText('kpi-ticket',       fmtBRL(ticket));

  const pendNF = S.data.recebimentos.filter(r => r.invoiceStatus === 'pendente' && r.status !== 'gratuito');
  const alertEl = el('alert-nf');
  alertEl.classList.toggle('hidden', pendNF.length === 0);
  if (pendNF.length) setText('alert-nf-count', `${pendNF.length} nota${pendNF.length>1?'s fiscais':' fiscal'}`);

  if (S.filter.start) setText('dash-period', `${fmtDate(S.filter.start)} → ${fmtDate(S.filter.end)}`);
  renderMensalChart();
  renderRecent();
}

function renderMensalChart() {
  const months = getMonthlyData(6);
  const ctx    = el('chart-mensal').getContext('2d');
  if (S.charts.mensal) S.charts.mensal.destroy();
  S.charts.mensal = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map(m => m.label),
      datasets: [
        { label: 'Receita Recebida', data: months.map(m=>m.receita), backgroundColor: '#2d7a5f', borderRadius: 6, order: 2 },
        { label: 'Despesas',         data: months.map(m=>m.despesa), backgroundColor: '#ef4444', borderRadius: 6, order: 2 },
        { label: 'Resultado', data: months.map(m=>m.receita-m.despesa),
          type: 'line', borderColor: '#2563eb', backgroundColor: 'transparent',
          pointBackgroundColor: '#2563eb', borderWidth: 2, tension: 0.3, order: 1 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { font: { family:'Plus Jakarta Sans', size:11 }, boxWidth:12 } } },
      scales: {
        x: { grid:{display:false}, ticks:{font:{family:'Plus Jakarta Sans',size:11}} },
        y: { grid:{color:'#e8f3ee'}, ticks:{font:{family:'Plus Jakarta Sans',size:11}, callback:v=>fmtBRLShort(v)} },
      },
    },
  });
}

function getMonthlyData(n) {
  const now = new Date();
  return Array.from({length:n}, (_,i) => {
    const d   = new Date(now.getFullYear(), now.getMonth()-(n-1-i), 1);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    const lbl = d.toLocaleDateString('pt-BR',{month:'short',year:'2-digit'}).replace('.','');
    const receita = S.data.recebimentos.filter(r=>r.status==='pix'&&r.date?.startsWith(key)).reduce((s,r)=>s+(r.value||0),0);
    const despesa = S.data.despesas.filter(r=>r.date?.startsWith(key)).reduce((s,r)=>s+(r.value||0),0);
    return { label:lbl, receita, despesa };
  });
}

function renderRecent() {
  const all = [
    ...S.data.recebimentos.slice(0,8).map(r=>({...r,kind:'rec'})),
    ...S.data.despesas.slice(0,4).map(d=>({...d,kind:'desp'})),
  ].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,10);

  const container = el('recent-list');
  if (!all.length) { container.innerHTML='<div class="empty-state">Nenhum lançamento.</div>'; return; }
  container.innerHTML = all.map(item => {
    if (item.kind === 'rec') return `
      <div class="recent-item">
        <div class="recent-item-left">
          <div class="recent-item-name">${esc(item.patient||'—')}</div>
          <div class="recent-item-meta">${fmtDate(item.date)} · ${labels.consultationType[item.consultationType]||item.consultationType||'—'}</div>
        </div>
        <div class="recent-item-right">
          <div class="recent-item-value">${fmtBRL(item.value||0)}</div>
          <div class="recent-item-type">${statusBadge(item.status)}</div>
        </div>
      </div>`;
    return `
      <div class="recent-item">
        <div class="recent-item-left">
          <div class="recent-item-name">${esc(item.description||'—')}</div>
          <div class="recent-item-meta">${fmtDate(item.date)} · ${labels.expenseCategory[item.category]||item.category||'—'}</div>
        </div>
        <div class="recent-item-right">
          <div class="recent-item-value" style="color:var(--red)">−${fmtBRL(item.value||0)}</div>
          <div class="recent-item-type" style="font-size:.72rem;color:var(--text-muted)">Despesa</div>
        </div>
      </div>`;
  }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENDA / CALENDAR
// ─────────────────────────────────────────────────────────────────────────────
el('btn-cal-prev').addEventListener('click', () => {
  S.calendarMonth--;
  if (S.calendarMonth < 0) { S.calendarMonth = 11; S.calendarYear--; }
  renderAgenda();
});
el('btn-cal-next').addEventListener('click', () => {
  S.calendarMonth++;
  if (S.calendarMonth > 11) { S.calendarMonth = 0; S.calendarYear++; }
  renderAgenda();
});
el('btn-cal-close-detail').addEventListener('click', () => {
  S.calendarSelDay = null;
  el('calendar-detail').classList.add('hidden');
  document.querySelectorAll('.cal-day.selected').forEach(d => d.classList.remove('selected'));
});

function renderAgenda() {
  const year  = S.calendarYear;
  const month = S.calendarMonth;
  const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  setText('cal-month-label', `${monthNames[month]} ${year}`);

  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const dayMap   = {};
  S.data.consultations.forEach(c => {
    if (c.date && c.date.startsWith(monthStr)) {
      const day = c.date.split('-')[2];
      if (!dayMap[day]) dayMap[day] = [];
      dayMap[day].push(c);
    }
  });

  const firstDay    = new Date(year, month, 1).getDay();
  const lastDate    = new Date(year, month + 1, 0).getDate();
  const prevLast    = new Date(year, month, 0).getDate();
  const todayStr    = today();
  const statusOrder = ['cp','at','co','sc','re','na'];

  let cells = '';
  let count = 0;

  for (let d = firstDay - 1; d >= 0; d--) {
    cells += `<div class="cal-day other-month"><div class="cal-day-num">${prevLast - d}</div></div>`;
    count++;
  }

  for (let d = 1; d <= lastDate; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isToday = dateStr === todayStr;
    const isSel   = dateStr === S.calendarSelDay;
    const events  = (dayMap[String(d).padStart(2, '0')] || [])
      .sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status));

    const chips = events.slice(0, 3).map(e => {
      const isBlock  = !e.iclinicPatientId && !e.patientId;
      const chipCls  = isBlock ? 'cal-chip-block' : `cal-chip-${e.status || 'sc'}`;
      const chipText = isBlock
        ? (e.notes || 'Bloqueio').split(/\s+/).slice(0, 2).join(' ')
        : ((e.patientName || '').split(' ')[0] || '?');
      const chipTitle = isBlock
        ? (e.notes || 'Bloqueio pessoal')
        : `${e.patientName || '?'} — ${e.status || ''}`;
      return `<div class="cal-chip ${chipCls}" title="${esc(chipTitle)}">${esc(chipText)}</div>`;
    }).join('');
    const more = events.length > 3 ? `<div class="cal-chip cal-chip-more">+${events.length - 3}</div>` : '';

    cells += `<div class="cal-day${isToday?' today':''}${isSel?' selected':''}" data-date="${dateStr}" data-action="cal-select-day">
      <div class="cal-day-num">${d}</div>${chips}${more}
    </div>`;
    count++;
  }

  const remaining = (7 - (count % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    cells += `<div class="cal-day other-month"><div class="cal-day-num">${d}</div></div>`;
  }

  el('calendar-body').innerHTML = cells;

  if (S.calendarSelDay && S.calendarSelDay.startsWith(monthStr)) {
    renderCalendarDetail(S.calendarSelDay);
  } else {
    S.calendarSelDay = null;
    el('calendar-detail').classList.add('hidden');
  }
}

function selectCalendarDay(dateStr) {
  const wasSelected = S.calendarSelDay === dateStr;
  document.querySelectorAll('.cal-day.selected').forEach(d => d.classList.remove('selected'));
  if (wasSelected) {
    S.calendarSelDay = null;
    el('calendar-detail').classList.add('hidden');
  } else {
    S.calendarSelDay = dateStr;
    const dayEl = document.querySelector(`.cal-day[data-date="${dateStr}"]`);
    if (dayEl) dayEl.classList.add('selected');
    renderCalendarDetail(dateStr);
  }
}

function renderCalendarDetail(dateStr) {
  const events = S.data.consultations
    .filter(c => c.date === dateStr)
    .sort((a, b) => (a.patientName || '').localeCompare(b.patientName || ''));

  const [y, m, d] = dateStr.split('-');
  setText('cal-detail-title', `${parseInt(d)}/${parseInt(m)}/${y} — ${events.length} consulta${events.length !== 1 ? 's' : ''}`);

  const statusLabels = { cp:'Compareceu', at:'Atendido', sc:'Agendado', na:'Não compareceu', co:'Confirmado online', re:'Remarcado' };

  el('cal-detail-list').innerHTML = events.length === 0
    ? '<div class="empty-state">Nenhuma consulta registrada neste dia.</div>'
    : events.map(e => {
        const isBlock   = !e.iclinicPatientId && !e.patientId;
        const dotCls    = isBlock ? 'cal-status-block' : `cal-status-${e.status || 'sc'}`;
        const statusTxt = isBlock ? 'Uso pessoal / Bloqueio' : (statusLabels[e.status] || e.status || '—');
        const nameEl    = isBlock
          ? `<span style="color:var(--text-muted);font-style:italic">${esc(e.notes || 'Bloqueio pessoal')}</span>`
          : e.patientId
            ? `<span class="patient-link" data-patient="${e.patientId}">${esc(e.patientName || '—')}</span>`
            : esc(e.patientName || '—');
        const subLine   = isBlock
          ? ''
          : `<div style="font-size:.75rem;color:var(--text-muted)">${statusTxt} · ${labels.consultationType[e.consultationType] || e.consultationType || '—'}</div>`;
        const notesLine = (!isBlock && e.notes)
          ? `<div style="font-size:.75rem;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.notes)}</div>`
          : '';
        return `<div class="cal-detail-item">
          <div class="cal-detail-dot ${dotCls}"></div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;color:var(--text)">${nameEl}</div>
            ${subLine}${notesLine}
          </div>
          <div style="text-align:right;flex-shrink:0;font-weight:700;color:var(--text)">${(!isBlock && e.value) ? fmtBRL(e.value) : ''}</div>
        </div>`;
      }).join('');

  el('calendar-detail').classList.remove('hidden');
}

// ─────────────────────────────────────────────────────────────────────────────
// PACIENTES VIEW
// ─────────────────────────────────────────────────────────────────────────────
el('btn-novo-paciente').addEventListener('click', () => openModalPaciente());

el('form-pac').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nome  = el('pac-nome').value.trim();
  const sobre = el('pac-sobrenome').value.trim();
  const data = {
    name:       capitalizeName(`${nome} ${sobre}`),
    firstName:  capitalizeName(nome),
    lastName:   capitalizeName(sobre),
    phone:      el('pac-telefone').value.trim(),
    phone2:     el('pac-telefone2').value.trim(),
    email:      el('pac-email').value.trim(),
    cpf:        el('pac-cpf').value.trim(),
    gender:     el('pac-sexo').value,
    birthDate:  el('pac-nascimento').value,
    status:     el('pac-status').value,
    indication: el('pac-indicacao').value.trim(),
    notes:      el('pac-obs').value.trim(),
  };
  await savePatient(data, S.editingPaciente);
  closeModal('modal-pac');
  renderPacientes();
});

el('btn-back-pac').addEventListener('click', () => navigateTo('pacientes'));
el('btn-edit-pac-atual').addEventListener('click', () => {
  const p = S.data.patients.find(p => p.id === S.currentPatient);
  if (p) openModalPaciente(p);
});

el('search-pac').addEventListener('input', renderPacientes);

function renderPacientes() {
  renderDuplicatesSection();

  let pats = [...S.data.patients];
  const q  = el('search-pac').value.toLowerCase();
  if (q) pats = pats.filter(p => (p.name||'').toLowerCase().includes(q));

  el('summary-pac').innerHTML = `${pats.length} paciente${pats.length!==1?'s':''}`;

  const tbody = el('tbody-pac');
  if (!pats.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Nenhum paciente encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = pats.map(p => {
    const stats = getPatientStats(p.id, p.name);
    return `<tr>
      <td><span class="patient-link" data-patient="${p.id}">${esc(p.name||'—')}</span></td>
      <td>${esc(p.phone||'—')}</td>
      <td>${stats.totalConsultas}</td>
      <td>${stats.lastVisit ? fmtDate(stats.lastVisit) : '—'}</td>
      <td class="text-right value-cell">${fmtBRL(stats.totalPago)}</td>
      <td class="text-right value-cell" style="color:${stats.totalPendente>0?'var(--amber)':'var(--text-muted)'}">${fmtBRL(stats.totalPendente)}</td>
      <td>${patientStatusBadge(p.status)}</td>
      <td><div class="action-btns">
        <button class="btn-edit" data-id="${p.id}" data-action="edit-pac">Editar</button>
        ${S.role==='medica'?`<button class="btn-del" data-id="${p.id}" data-action="del-pac">Excluir</button>`:''}
      </div></td>
    </tr>`;
  }).join('');
}

function openModalPaciente(pac = null) {
  S.editingPaciente = pac ? pac.id : null;
  setText('modal-pac-title', pac ? 'Editar Paciente' : 'Novo Paciente');
  el('pac-id').value         = pac ? pac.id : '';
  el('pac-nome').value       = pac ? (pac.firstName || pac.name?.split(' ')[0] || '') : '';
  el('pac-sobrenome').value  = pac ? (pac.lastName  || pac.name?.split(' ').slice(1).join(' ') || '') : '';
  el('pac-telefone').value   = pac ? (pac.phone  || '') : '';
  el('pac-telefone2').value  = pac ? (pac.phone2 || '') : '';
  el('pac-email').value      = pac ? (pac.email  || '') : '';
  el('pac-cpf').value        = pac ? (pac.cpf    || '') : '';
  el('pac-sexo').value       = pac ? (pac.gender || '') : '';
  el('pac-nascimento').value = pac ? (pac.birthDate  || '') : '';
  el('pac-status').value     = pac ? (pac.status || 'ativo') : 'ativo';
  el('pac-indicacao').value  = pac ? (pac.indication || '') : '';
  el('pac-obs').value        = pac ? (pac.notes  || '') : '';
  openModal('modal-pac');
}

function getPatientStats(patientId, patientName) {
  const recs = S.data.recebimentos.filter(r =>
    (patientId && r.patientId === patientId) ||
    (!r.patientId && r.patient === patientName)
  ).sort((a,b) => (b.date||'').localeCompare(a.date||''));

  const totalConsultas = recs.length;
  const totalPago      = recs.filter(r=>r.status==='pix').reduce((s,r)=>s+(r.value||0),0);
  const totalPendente  = recs.filter(r=>r.status==='pendente').reduce((s,r)=>s+(r.value||0),0);
  const totalGratuito  = recs.filter(r=>r.status==='gratuito').length;
  const lastVisit      = recs.length ? recs[0].date : null;
  const firstVisit     = recs.length ? recs[recs.length-1].date : null;

  let avgFrequency = null;
  if (recs.length >= 2) {
    const diff = daysBetween(firstVisit, lastVisit);
    avgFrequency = Math.round(diff / (recs.length - 1));
  }

  return { totalConsultas, totalPago, totalPendente, totalGratuito, lastVisit, firstVisit, avgFrequency, recs };
}

function renderPacienteDetalhe(patientId) {
  const pac = S.data.patients.find(p => p.id === patientId);
  if (!pac) { navigateTo('pacientes'); return; }

  setText('det-nome', pac.name || '—');
  el('det-status-badge').innerHTML = patientStatusBadge(pac.status);

  const stats = getPatientStats(patientId, pac.name);
  const freqTxt = stats.avgFrequency ? `a cada ${stats.avgFrequency} dias` : '—';

  el('pac-kpis').innerHTML = `
    <div class="kpi-card kpi-blue">
      <div class="kpi-label">Total de Consultas</div>
      <div class="kpi-value">${stats.totalConsultas}</div>
      <div class="kpi-meta">${stats.totalGratuito} gratuita${stats.totalGratuito!==1?'s':''}</div>
    </div>
    <div class="kpi-card kpi-sage">
      <div class="kpi-label">Última Visita</div>
      <div class="kpi-value" style="font-size:1.2rem">${stats.lastVisit ? fmtDate(stats.lastVisit) : '—'}</div>
      <div class="kpi-meta">${stats.firstVisit ? `Desde ${fmtDate(stats.firstVisit)}` : ''}</div>
    </div>
    <div class="kpi-card kpi-purple">
      <div class="kpi-label">Frequência Média</div>
      <div class="kpi-value" style="font-size:1.2rem">${freqTxt}</div>
      <div class="kpi-meta">entre consultas</div>
    </div>
    <div class="kpi-card kpi-green">
      <div class="kpi-label">Total Pago</div>
      <div class="kpi-value">${fmtBRL(stats.totalPago)}</div>
      <div class="kpi-meta">${stats.recs.filter(r=>r.status==='pix').length} consultas pagas</div>
    </div>
    <div class="kpi-card kpi-amber">
      <div class="kpi-label">Pendente</div>
      <div class="kpi-value">${fmtBRL(stats.totalPendente)}</div>
      <div class="kpi-meta">${stats.recs.filter(r=>r.status==='pendente').length} em aberto</div>
    </div>
    <div class="kpi-card kpi-red">
      <div class="kpi-label">Ticket Médio</div>
      <div class="kpi-value">${stats.recs.filter(r=>r.status==='pix').length > 0 ? fmtBRL(stats.totalPago / stats.recs.filter(r=>r.status==='pix').length) : '—'}</div>
      <div class="kpi-meta">consultas pagas</div>
    </div>`;

  const age = pac.birthDate ? calcAge(pac.birthDate) : null;
  const genderMap = { m:'Masculino', f:'Feminino', o:'Outro' };

  const infoItems = [
    ['Telefone', pac.phone || '—'],
    pac.phone2    ? ['Telefone 2', pac.phone2]                                         : null,
    ['E-mail', pac.email || '—'],
    ['Data de Nascimento', pac.birthDate ? `${fmtDate(pac.birthDate)}${age !== null ? ' (' + age + ' anos)' : ''}` : '—'],
    pac.gender    ? ['Sexo', genderMap[pac.gender] || pac.gender]                      : null,
    pac.cpf       ? ['CPF', pac.cpf]                                                   : null,
    pac.indication? ['Como chegou', pac.indication]                                    : null,
  ].filter(Boolean);

  el('pac-info-grid').innerHTML = infoItems.map(([label, value]) =>
    `<div class="pac-info-item"><div class="pac-info-label">${label}</div><div class="pac-info-value">${esc(value)}</div></div>`
  ).join('') + (pac.notes ? `<div class="pac-info-item pac-info-wide"><div class="pac-info-label">Observações</div><div class="pac-info-value">${esc(pac.notes)}</div></div>` : '');

  const tbody = el('tbody-historico');
  if (!stats.recs.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-row">Nenhuma consulta registrada.</td></tr>';
    return;
  }
  tbody.innerHTML = stats.recs.map(r => `
    <tr>
      <td>${fmtDate(r.date)}</td>
      <td><span class="type-tag">${labels.consultationType[r.consultationType]||r.consultationType||'—'}</span></td>
      <td class="text-right value-cell">${fmtBRL(r.value||0)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${nfBadge(r.invoiceStatus)}${r.invoiceNumber?` <span style="font-size:.75rem;color:var(--text-muted)">NF ${esc(r.invoiceNumber)}</span>`:''}</td>
      <td style="color:var(--text-muted);font-size:.8rem;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.notes||'')}</td>
    </tr>`).join('');
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
    patientId:       el('rec-paciente-id').value || null,
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
  const q  = el('search-rec').value.toLowerCase();
  if (q) recs = recs.filter(r => (r.patient||'').toLowerCase().includes(q));

  const total    = recs.reduce((s,r)=>s+(r.value||0),0);
  const recebido = recs.filter(r=>r.status==='pix').reduce((s,r)=>s+(r.value||0),0);
  el('summary-rec').innerHTML = `${recs.length} reg. &nbsp;|&nbsp; Total: <strong>${fmtBRL(total)}</strong> &nbsp;|&nbsp; Recebido: <strong>${fmtBRL(recebido)}</strong>`;

  const tbody = el('tbody-rec');
  if (!recs.length) { tbody.innerHTML='<tr><td colspan="8" class="empty-row">Nenhum registro no período.</td></tr>'; return; }

  tbody.innerHTML = recs.map(r => {
    const patCell = r.patientId
      ? `<span class="patient-link" data-patient="${r.patientId}">${esc(r.patient||'—')}</span>`
      : esc(r.patient||'—');
    const nfInfo = r.invoiceNumber
      ? `${nfBadge(r.invoiceStatus)} <span style="font-size:.75rem;color:var(--text-muted)">NF ${esc(r.invoiceNumber)}</span>`
      : nfBadge(r.invoiceStatus);
    return `<tr>
      <td>${fmtDate(r.date)}</td>
      <td>${patCell}</td>
      <td><span class="type-tag">${labels.consultationType[r.consultationType]||r.consultationType||'—'}</span></td>
      <td class="text-right value-cell">${fmtBRL(r.value||0)}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${nfInfo}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);font-size:.78rem">${esc(r.notes||'')}</td>
      <td><div class="action-btns">
        <button class="btn-edit" data-id="${r.id}" data-action="edit-rec">Editar</button>
        ${S.role==='medica'?`<button class="btn-del" data-id="${r.id}" data-action="del-rec">Excluir</button>`:''}
      </div></td>
    </tr>`;
  }).join('');
}

function openModalRec(rec = null) {
  S.editingRec = rec ? rec.id : null;
  setText('modal-rec-title', rec ? 'Editar Recebimento' : 'Novo Recebimento');
  el('rec-id').value          = rec ? rec.id : '';
  el('rec-data').value        = rec ? rec.date : today();
  el('rec-paciente').value    = rec ? (rec.patient || '') : '';
  el('rec-paciente-id').value = rec ? (rec.patientId || '') : '';
  el('rec-tipo').value        = rec ? (rec.consultationType || '') : '';
  el('rec-valor').value       = rec ? (rec.value || '') : '';
  el('rec-status').value      = rec ? (rec.status || '') : '';
  el('rec-nf').value          = rec ? (rec.invoiceStatus || 'pendente') : 'pendente';
  el('rec-obs').value         = rec ? (rec.notes || '') : '';
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
  const q   = el('search-desp').value.toLowerCase();
  if (q) desps = desps.filter(d => (d.description||'').toLowerCase().includes(q));
  const total = desps.reduce((s,d)=>s+(d.value||0),0);
  el('summary-desp').innerHTML = `${desps.length} reg. &nbsp;|&nbsp; Total: <strong>${fmtBRL(total)}</strong>`;

  const tbody = el('tbody-desp');
  if (!desps.length) { tbody.innerHTML='<tr><td colspan="6" class="empty-row">Nenhuma despesa no período.</td></tr>'; return; }
  tbody.innerHTML = desps.map(d => `<tr>
    <td>${fmtDate(d.date)}</td>
    <td>${esc(d.description||'—')}</td>
    <td><span class="cat-tag">${labels.expenseCategory[d.category]||d.category||'—'}</span></td>
    <td><span class="cat-tag">${labels.recurrence[d.recurrence]||'Única'}</span></td>
    <td class="text-right value-cell" style="color:var(--red)">${fmtBRL(d.value||0)}</td>
    <td><div class="action-btns">
      <button class="btn-edit" data-id="${d.id}" data-action="edit-desp">Editar</button>
      ${S.role==='medica'?`<button class="btn-del" data-id="${d.id}" data-action="del-desp">Excluir</button>`:''}
    </div></td>
  </tr>`).join('');
}

function openModalDesp(desp = null) {
  S.editingDesp = desp ? desp.id : null;
  setText('modal-desp-title', desp ? 'Editar Despesa' : 'Nova Despesa');
  el('desp-id').value    = desp ? desp.id : '';
  el('desp-data').value  = desp ? desp.date : today();
  el('desp-desc').value  = desp ? (desp.description||'') : '';
  el('desp-cat').value   = desp ? (desp.category||'') : '';
  el('desp-rec').value   = desp ? (desp.recurrence||'unica') : 'unica';
  el('desp-valor').value = desp ? (desp.value||'') : '';
  openModal('modal-desp');
}

// ─────────────────────────────────────────────────────────────────────────────
// INADIMPLÊNCIA
// ─────────────────────────────────────────────────────────────────────────────
function renderInadimplencia() {
  const pendentes = S.data.recebimentos
    .filter(r => r.status === 'pendente')
    .sort((a,b) => a.date.localeCompare(b.date));

  // Clean stale selections
  const pendIds = new Set(pendentes.map(r => r.id));
  S.inadimSelected.forEach(id => { if (!pendIds.has(id)) S.inadimSelected.delete(id); });

  const sumEl = el('inadimplencia-summary');
  if (pendentes.length) {
    const total = pendentes.reduce((s,r)=>s+(r.value||0),0);
    sumEl.classList.remove('hidden');
    sumEl.innerHTML = `<strong>${pendentes.length} pagamento${pendentes.length>1?'s':''} pendente${pendentes.length>1?'s':''}</strong> &nbsp;·&nbsp; Total em aberto: <strong>${fmtBRL(total)}</strong>`;
  } else {
    sumEl.classList.add('hidden');
  }

  const bulkBar = el('inadim-bulk-bar');
  const tbody   = el('tbody-inadimplencia');

  if (!pendentes.length) {
    if (bulkBar) bulkBar.classList.add('hidden');
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Nenhum pagamento pendente. 🎉</td></tr>';
    return;
  }

  if (bulkBar) bulkBar.classList.remove('hidden');
  updateInadimToolbar();

  const today_ = today();
  tbody.innerHTML = pendentes.map(r => {
    const sel     = S.inadimSelected.has(r.id);
    const dias    = daysBetween(r.date, today_);
    const daysCls = dias <= 7 ? 'days-ok' : dias <= 30 ? 'days-warning' : 'days-danger';
    const patCell = r.patientId
      ? `<span class="patient-link" data-patient="${r.patientId}">${esc(r.patient||'—')}</span>`
      : esc(r.patient||'—');
    return `<tr class="${sel ? 'row-selected' : ''}">
      <td style="padding:10px 8px"><input type="checkbox" class="row-check inadim-check" data-id="${r.id}" ${sel ? 'checked' : ''}></td>
      <td>${fmtDate(r.date)}</td>
      <td>${patCell}</td>
      <td><span class="type-tag">${labels.consultationType[r.consultationType]||r.consultationType||'—'}</span></td>
      <td class="text-right value-cell">${fmtBRL(r.value||0)}</td>
      <td><span class="days-badge ${daysCls}">${dias} dia${dias!==1?'s':''}</span></td>
      <td><button class="btn-received" data-id="${r.id}" data-action="mark-received">✓ Marcar Recebido</button></td>
    </tr>`;
  }).join('');
}

function updateInadimToolbar() {
  const pendentes = S.data.recebimentos.filter(r => r.status === 'pendente');
  const total = pendentes.length, selCount = S.inadimSelected.size;
  const allCheck = el('check-inadim-all');
  if (allCheck) {
    allCheck.checked = selCount > 0 && selCount === total;
    allCheck.indeterminate = selCount > 0 && selCount < total;
  }
  setText('inadim-sel-count', selCount > 0 ? `${selCount} selecionado${selCount !== 1 ? 's' : ''}` : '');
  const btn = el('btn-inadim-bulk-received');
  if (btn) btn.disabled = selCount === 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECRETARIA
// ─────────────────────────────────────────────────────────────────────────────
el('form-rapido').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = el('r-status').value;
  const data = {
    date:            el('r-data').value,
    patient:         el('r-paciente').value.trim(),
    patientId:       el('r-paciente-id').value || null,
    consultationType:el('r-tipo').value,
    value:           parseFloat(el('r-valor').value) || 0,
    status,
    invoiceStatus:   status === 'gratuito' ? 'isenta' : el('r-nf').value,
    notes:           '',
  };
  await saveRecebimento(data);
  el('form-rapido').reset();
  el('r-data').value = today();
  el('r-paciente-id').value = '';
  renderSecretaria();
});

el('btn-nova-nota').addEventListener('click', () => openModalNota());

// NF bulk selection
el('check-nf-all').addEventListener('change', (e) => {
  const pendNF = S.data.recebimentos.filter(r => r.invoiceStatus === 'pendente' && r.status !== 'gratuito');
  if (e.target.checked) pendNF.forEach(r => S.nfSelected.add(r.id));
  else S.nfSelected.clear();
  renderNFPendentes();
});

el('btn-nf-bulk-emit').addEventListener('click', async () => {
  if (!S.nfSelected.size) return;
  const ids   = [...S.nfSelected];
  const count = ids.length;
  if (!confirm(`Marcar ${count} nota${count > 1 ? 's fiscais' : ' fiscal'} como emitida${count > 1 ? 's' : ''}?`)) return;
  showLoading();
  try {
    for (let i = 0; i < ids.length; i += 400) {
      const batch = writeBatch(db);
      ids.slice(i, i + 400).forEach(id =>
        batch.update(doc(db, 'recebimentos', id), { invoiceStatus: 'emitida', updatedAt: serverTimestamp() })
      );
      await batch.commit();
    }
    S.nfSelected.clear();
    await reloadCollection('recebimentos');
    updateBadges(); renderView(S.view);
    showToast(`${count} NF${count > 1 ? 's marcadas' : ' marcada'} como emitida${count > 1 ? 's' : ''}!`, 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
});

// Inadimplência bulk selection
el('check-inadim-all').addEventListener('change', (e) => {
  const pendentes = S.data.recebimentos.filter(r => r.status === 'pendente');
  if (e.target.checked) pendentes.forEach(r => S.inadimSelected.add(r.id));
  else S.inadimSelected.clear();
  renderInadimplencia();
});

el('btn-inadim-bulk-received').addEventListener('click', async () => {
  if (!S.inadimSelected.size) return;
  const ids   = [...S.inadimSelected];
  const count = ids.length;
  if (!confirm(`Marcar ${count} pagamento${count > 1 ? 's' : ''} como recebido${count > 1 ? 's' : ''} via PIX?`)) return;
  showLoading();
  try {
    for (let i = 0; i < ids.length; i += 400) {
      const batch = writeBatch(db);
      ids.slice(i, i + 400).forEach(id =>
        batch.update(doc(db, 'recebimentos', id), { status: 'pix', updatedAt: serverTimestamp() })
      );
      await batch.commit();
    }
    S.inadimSelected.clear();
    await reloadCollection('recebimentos');
    updateBadges(); renderView(S.view);
    showToast(`${count} pagamento${count > 1 ? 's marcados' : ' marcado'} como recebido${count > 1 ? 's' : ''}!`, 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
});

el('form-nota').addEventListener('submit', async (e) => {
  e.preventDefault();
  const content = el('nota-content').value.trim();
  if (!content) return;
  await saveNota({ content }, S.editingNota);
  closeModal('modal-nota');
  renderSecretaria();
});

// NF modal
el('form-nf').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id  = el('nf-rec-id').value;
  const num = el('nf-numero').value.trim();
  showLoading();
  try {
    await updateDoc(doc(db, 'recebimentos', id), {
      invoiceStatus: 'emitida',
      invoiceNumber: num,
      updatedAt: serverTimestamp()
    });
    await reloadCollection('recebimentos');
    updateBadges();
    closeModal('modal-nf');
    renderView(S.view);
    showToast(`NF marcada como emitida${num?' — Nº '+num:''}!`, 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
});

function renderSecretaria() {
  renderNFPendentes();
  renderNotas();
  if (!el('r-data').value) el('r-data').value = today();
}

function renderNFPendentes() {
  const pendNF = S.data.recebimentos
    .filter(r => r.invoiceStatus === 'pendente' && r.status !== 'gratuito')
    .sort((a,b) => a.date.localeCompare(b.date));

  el('nf-count-pill').textContent = pendNF.length;

  // Remove stale selections
  const pendIds = new Set(pendNF.map(r => r.id));
  S.nfSelected.forEach(id => { if (!pendIds.has(id)) S.nfSelected.delete(id); });

  const toolbar = el('nf-bulk-toolbar');
  const nfList  = el('nf-list');

  if (!pendNF.length) {
    toolbar.classList.add('hidden');
    nfList.innerHTML = '<div class="empty-state">Nenhuma NF pendente de emissão.</div>';
    return;
  }
  toolbar.classList.remove('hidden');
  updateNFToolbar();

  nfList.innerHTML = pendNF.map(r => {
    const sel = S.nfSelected.has(r.id);
    return `<div class="nf-item${sel ? ' nf-selected' : ''}">
      <label class="nf-item-check" onclick="event.stopPropagation()">
        <input type="checkbox" class="row-check nf-check" data-id="${r.id}" ${sel ? 'checked' : ''}>
      </label>
      <div class="nf-item-left">
        <div class="nf-item-name">${esc(r.patient||'—')}</div>
        <div class="nf-item-meta">${fmtDate(r.date)} · ${labels.consultationType[r.consultationType]||r.consultationType||'—'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <div class="nf-item-value">${fmtBRL(r.value||0)}</div>
        <button class="btn btn-sm btn-primary" data-id="${r.id}" data-action="mark-nf">Emitida</button>
      </div>
    </div>`;
  }).join('');
}

function updateNFToolbar() {
  const pendNF   = S.data.recebimentos.filter(r => r.invoiceStatus === 'pendente' && r.status !== 'gratuito');
  const total    = pendNF.length;
  const selCount = S.nfSelected.size;
  const allCheck = el('check-nf-all');
  if (allCheck) {
    allCheck.checked       = selCount > 0 && selCount === total;
    allCheck.indeterminate = selCount > 0 && selCount < total;
  }
  setText('nf-sel-count', selCount > 0 ? `${selCount} selecionada${selCount !== 1 ? 's' : ''}` : '');
  const btn = el('btn-nf-bulk-emit');
  if (btn) btn.disabled = selCount === 0;
}

function renderNotas() {
  const list = el('notas-list');
  if (!S.data.notas.length) { list.innerHTML='<div class="empty-state">Nenhuma anotação.</div>'; return; }
  list.innerHTML = S.data.notas.map(n => `
    <div class="nota-item">
      <div class="nota-content">${esc(n.content||'')}</div>
      <div class="nota-meta">
        <span>${n.createdAt ? fmtTimestamp(n.createdAt) : ''}</span>
        <div class="nota-actions">
          <button class="btn btn-sm btn-outline" data-id="${n.id}" data-action="edit-nota">Editar</button>
          <button class="btn btn-sm btn-danger"  data-id="${n.id}" data-action="del-nota">Excluir</button>
        </div>
      </div>
    </div>`).join('');
}

function openModalNota(nota = null) {
  S.editingNota = nota ? nota.id : null;
  el('nota-id').value      = nota ? nota.id : '';
  el('nota-content').value = nota ? (nota.content||'') : '';
  openModal('modal-nota');
}

// ─────────────────────────────────────────────────────────────────────────────
// DRE
// ─────────────────────────────────────────────────────────────────────────────
function renderDRE() {
  const recs  = filteredRec();
  const desps = filteredDesp();
  if (S.filter.start) setText('dre-period', `${fmtDate(S.filter.start)} → ${fmtDate(S.filter.end)}`);

  const recByType = { presencial:0, teleconsulta:0 };
  recs.filter(r=>r.status!=='gratuito').forEach(r => {
    const t = r.consultationType || 'presencial';
    recByType[t] = (recByType[t]||0) + (r.value||0);
  });
  const totalRec = Object.values(recByType).reduce((s,v)=>s+v,0);

  const catOrder  = ['aluguel','iclinic','secretaria','contador','material','impostos','outros'];
  const despByCat = Object.fromEntries(catOrder.map(c=>[c,0]));
  desps.forEach(d => { despByCat[d.category] = (despByCat[d.category]||0)+(d.value||0); });
  const totalDesp = Object.values(despByCat).reduce((s,v)=>s+v,0);

  const resultado = totalRec - totalDesp;
  const margem    = totalRec > 0 ? (resultado/totalRec*100) : 0;
  const paid      = recs.filter(r=>r.status==='pix');
  const ticket    = paid.length > 0 ? paid.reduce((s,r)=>s+(r.value||0),0)/paid.length : 0;
  const pendente  = recs.filter(r=>r.status==='pendente').reduce((s,r)=>s+(r.value||0),0);
  const pct       = v => totalRec > 0 ? (v/totalRec*100).toFixed(1)+'%' : '—';

  const rows = [
    ['section','RECEITAS'],
    ['item','Presencial',     recByType.presencial,   pct(recByType.presencial)],
    ['item','Teleconsulta',   recByType.teleconsulta, pct(recByType.teleconsulta)],
    ['item','A Receber (Pendente)', pendente,          pct(pendente)],
    ['subtotal','Total Receita Bruta', totalRec, '100%'],
    ['spacer'],
    ['section','DESPESAS'],
    ...catOrder.map(c=>['item', labels.expenseCategory[c], despByCat[c], pct(despByCat[c])]),
    ['subtotal','Total Despesas', totalDesp, pct(totalDesp)],
    ['spacer'],
    ['section','RESULTADO'],
    ['total','Resultado Líquido', resultado, `${margem.toFixed(1)}%`],
    ['item','Margem Líquida', '', `${margem.toFixed(1)}%`],
    ['item','Ticket Médio (consultas pagas)', ticket, ''],
    ['item','Total Atendimentos', recs.length+' consultas',''],
    ['item','Atendimentos Gratuitos', recs.filter(r=>r.status==='gratuito').length+' consultas',''],
  ];

  el('tbody-dre').innerHTML = rows.map(row => {
    if (row[0]==='section') return `<tr class="dre-section-header"><td colspan="3">${row[1]}</td></tr>`;
    if (row[0]==='spacer')  return `<tr><td colspan="3" style="padding:5px"></td></tr>`;
    if (row[0]==='subtotal') return `<tr class="dre-subtotal"><td>${row[1]}</td><td class="text-right">${typeof row[2]==='number'?fmtBRL(row[2]):row[2]}</td><td class="text-right">${row[3]}</td></tr>`;
    if (row[0]==='total') {
      const cls = row[2]>=0?'dre-positive':'dre-negative';
      return `<tr class="dre-total"><td>${row[1]}</td><td class="text-right ${cls}">${fmtBRL(row[2])}</td><td class="text-right ${cls}">${row[3]}</td></tr>`;
    }
    const v = typeof row[2]==='number' ? (row[2]>0?fmtBRL(row[2]):'—') : (row[2]||'—');
    return `<tr><td style="padding-left:32px">${row[1]}</td><td class="text-right">${v}</td><td class="text-right" style="color:var(--text-muted)">${row[3]||''}</td></tr>`;
  }).join('');

  renderDRECharts(recByType, despByCat, catOrder);
}

function renderDRECharts(recByType, despByCat, catOrder) {
  const ctxRT = el('chart-rec-tipo').getContext('2d');
  if (S.charts.recTipo) S.charts.recTipo.destroy();
  S.charts.recTipo = new Chart(ctxRT, {
    type: 'doughnut',
    data: { labels:['Presencial','Teleconsulta'], datasets:[{data:[recByType.presencial,recByType.teleconsulta],backgroundColor:['#2d7a5f','#71c9a7'],borderWidth:2,borderColor:'#fff'}] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom',labels:{font:{family:'Plus Jakarta Sans',size:10},boxWidth:10,padding:8}}} },
  });

  const ctxDC = el('chart-desp-cat').getContext('2d');
  if (S.charts.despCat) S.charts.despCat.destroy();
  S.charts.despCat = new Chart(ctxDC, {
    type: 'doughnut',
    data: { labels:catOrder.map(c=>labels.expenseCategory[c]), datasets:[{data:catOrder.map(c=>despByCat[c]||0),backgroundColor:['#e07b54','#5ba88a','#7b6ec0','#c0aa3d','#3d88c0','#c03d5a','#9a9a9a'],borderWidth:2,borderColor:'#fff'}] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom',labels:{font:{family:'Plus Jakarta Sans',size:10},boxWidth:10,padding:8}}} },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTAÇÃO iCLINIC — 3 CSVs, upsert inteligente
// ─────────────────────────────────────────────────────────────────────────────
const csvInput   = el('csv-input');
const uploadArea = el('upload-area');

uploadArea.addEventListener('dragover',  e => { e.preventDefault(); uploadArea.classList.add('dragover'); });
uploadArea.addEventListener('dragleave', ()=> uploadArea.classList.remove('dragover'));
uploadArea.addEventListener('drop', e => {
  e.preventDefault(); uploadArea.classList.remove('dragover');
  handleFileSelection([...e.dataTransfer.files]);
});
csvInput.addEventListener('change', () => handleFileSelection([...csvInput.files]));

el('btn-cancel-import').addEventListener('click', resetImport);
el('btn-run-import').addEventListener('click',    runImport);

function handleFileSelection(files) {
  S.importFiles = { patient: null, bill: null, event: null };
  const detected = [];
  for (const file of files) {
    const reader = new FileReader();
    reader.onload = e => {
      const text   = e.target.result;
      const header = text.split('\n')[0] || '';
      const type   = detectCSVType(header);
      if (type && !S.importFiles[type]) {
        S.importFiles[type] = { file, text };
        detected.push({ name: file.name, type });
      } else {
        detected.push({ name: file.name, type: null });
      }
      if (detected.length === files.length) renderFilesPreview(detected);
    };
    reader.readAsText(file, 'UTF-8');
  }
}

function detectCSVType(header) {
  if (header.includes('patient_id') && header.includes('birthdate'))         return 'patient';
  if (header.includes('Paciente')   && header.includes('Pago?'))             return 'bill';
  if (header.includes('procedure_pack') && header.includes('schedule_id'))   return 'event';
  return null;
}

function renderFilesPreview(detected) {
  const preview    = el('import-files-preview');
  const icons      = { patient:'👤', bill:'💰', event:'📅' };
  const typeLabels = { patient:'Pacientes', bill:'Financeiro', event:'Agendamentos' };
  preview.innerHTML = detected.map(f => `
    <div class="import-file-row">
      <span class="import-file-icon">${icons[f.type]||'📄'}</span>
      <span class="import-file-name">${esc(f.name)}</span>
      <span class="import-file-type ${f.type?'detected':'unknown'}">${f.type?typeLabels[f.type]:'Não reconhecido'}</span>
    </div>`).join('');
  preview.classList.remove('hidden');
  el('import-actions-bar').classList.remove('hidden');
  el('import-result').classList.add('hidden');
}

function resetImport() {
  S.importFiles = { patient: null, bill: null, event: null };
  csvInput.value = '';
  el('import-files-preview').classList.add('hidden');
  el('import-actions-bar').classList.add('hidden');
  el('import-progress').classList.add('hidden');
  el('import-result').classList.add('hidden');
}

async function runImport() {
  const { patient: patFile, bill: billFile, event: evtFile } = S.importFiles;
  if (!patFile && !billFile && !evtFile) { showToast('Nenhum arquivo válido selecionado.', 'error'); return; }

  el('import-actions-bar').classList.add('hidden');
  el('import-progress').classList.remove('hidden');
  setProgress(0, 'Iniciando…');

  const results = { patientsAdded:0, patientsUpdated:0, billsAdded:0, billsUpdated:0, eventsAdded:0, eventsUpdated:0, recFromEvents:0, errors:0 };

  try {
    // ── 1. Pre-parse events → build eventMap for teleconsulta detection ────────
    let eventRows = [];
    const eventMap = {};  // icPatId_date → { description, procedurePack, status }
    if (evtFile) {
      eventRows = parseCSV(evtFile.text);
      eventRows.forEach(r => {
        const pid  = r.patient_id || '';
        const date = parseBRDate(r.date || '') || (r.date || '');
        if (pid && date) eventMap[`${pid}_${date}`] = { description: r.description||'', procedurePack: r.procedure_pack||'', status: r.status||'' };
      });
    }
    setProgress(10, 'Eventos mapeados…');

    // ── 2. Upsert patients ─────────────────────────────────────────────────────
    if (patFile) {
      const rows = parseCSV(patFile.text);
      const existing = {};
      S.data.patients.forEach(p => { if (p.iclinicPatientId) existing[p.iclinicPatientId] = p.id; });

      let i = 0;
      for (const r of rows) {
        const icId = r.patient_id;
        if (!icId || !r.name) { i++; continue; }

        const fullName  = capitalizeName((r.name || '').trim());
        const nameParts = fullName.split(' ');
        const phone     = (r.mobile_phone || '').trim();
        const phone2    = (r.home_phone   || '').trim();

        const rawGender = (r.gender || '').toLowerCase();
        const gender    = rawGender.startsWith('f') ? 'f' : rawGender.startsWith('m') ? 'm' : rawGender ? 'o' : '';

        const indication = [r.indication, r.indication_observation].filter(v => v && v.trim()).join(' — ').trim();

        const data = {
          name:             fullName,
          firstName:        nameParts[0] || '',
          lastName:         nameParts.slice(1).join(' ') || '',
          phone,
          phone2,
          email:            (r.email || '').trim(),
          cpf:              (r.cpf   || '').trim(),
          gender,
          birthDate:        r.birthdate || '',
          status:           r.active === 'True' ? 'ativo' : 'inativo',
          notes:            (r.observation || '').trim(),
          indication,
          iclinicPatientId: icId,
          iclinicPk:        r.pk || '',
        };

        if (existing[icId]) {
          await updateDoc(doc(db, 'patients', existing[icId]), { ...data, updatedAt: serverTimestamp() });
          results.patientsUpdated++;
        } else {
          await addDoc(collection(db, 'patients'), { ...data, createdAt: serverTimestamp(), createdBy: S.user.uid });
          results.patientsAdded++;
        }
        i++;
        if (i % 10 === 0) setProgress(10 + Math.round(i/rows.length*25), `Pacientes: ${i}/${rows.length}…`);
      }
    }
    await reloadCollection('patients');
    setProgress(35, 'Pacientes importados…');

    // ── 3. Build patient id maps ───────────────────────────────────────────────
    const pkToPatientId = {};
    const icIdToDocId   = {};
    const icIdToName    = {};
    S.data.patients.forEach(p => {
      if (p.iclinicPk && p.iclinicPatientId) pkToPatientId[p.iclinicPk] = p.iclinicPatientId;
      if (p.iclinicPatientId) {
        icIdToDocId[p.iclinicPatientId] = p.id;
        icIdToName[p.iclinicPatientId]  = p.name;
      }
    });

    // ── 4. Upsert bills + build billCoveredSet ─────────────────────────────────
    const billCoveredSet = new Set();
    if (billFile) {
      const rows = parseCSV(billFile.text);
      const existingBills = {};
      S.data.recebimentos.forEach(r => { if (r.iclinicBillId) existingBills[r.iclinicBillId] = r; });

      let i = 0;
      for (const r of rows) {
        const billId = r.id;
        if (!billId) { i++; continue; }
        if ((r['Tipo']||'').toLowerCase() !== 'receita') { i++; continue; }

        const date = parseBRDate(r['Data'] || '');
        if (!date) { i++; continue; }

        const patName  = (r['Paciente'] || '').trim();
        const pkPac    = r['PK Paciente'] || '';
        const icPatId  = pkToPatientId[pkPac] || '';
        const patDocId = icIdToDocId[icPatId] || null;

        // Detect teleconsulta via eventMap
        const evtKey  = `${icPatId}_${date}`;
        const evtData = eventMap[evtKey] || {};
        const isTele  = (evtData.description||'').toLowerCase().includes('online') ||
                        (evtData.description||'').toLowerCase().includes('tele') ||
                        (evtData.procedurePack||'').toLowerCase().includes('online');
        const consType = isTele ? 'teleconsulta' : 'presencial';

        const value  = parseBRNumber(r['Valor'] || '0');
        const paid   = (r['Pago?']||'').toLowerCase() === 'sim';
        const status = value === 0 ? 'gratuito' : (paid ? 'pix' : 'pendente');

        if (icPatId) billCoveredSet.add(`${icPatId}_${date}`);

        const newData = {
          date,
          patient:          capitalizeName(patName),
          patientId:        patDocId,
          consultationType: consType,
          value,
          status,
          iclinicBillId:    billId,
          iclinicPatientPk: pkPac,
          iclinicPatientId: icPatId,
        };

        if (existingBills[billId]) {
          const ex = existingBills[billId];
          await updateDoc(doc(db, 'recebimentos', ex.id), {
            ...newData,
            invoiceStatus: ex.invoiceStatus || 'pendente',
            invoiceNumber: ex.invoiceNumber || '',
            notes:         ex.notes         || '',
            updatedAt: serverTimestamp(),
          });
          results.billsUpdated++;
        } else {
          await addDoc(collection(db, 'recebimentos'), {
            ...newData,
            invoiceStatus: 'pendente',
            invoiceNumber: '',
            notes:         '',
            createdAt:     serverTimestamp(),
            createdBy:     S.user.uid,
          });
          results.billsAdded++;
        }
        i++;
        if (i % 20 === 0) setProgress(35 + Math.round(i/rows.length*30), `Financeiro: ${i}/${rows.length}…`);
      }
    }
    await reloadCollection('recebimentos');
    setProgress(65, 'Financeiro importado…');

    // ── 5. Upsert consultations + recebimentos from 2024+ events ──────────────
    if (evtFile && eventRows.length) {
      const existingConsult  = {};
      S.data.consultations.forEach(c => { if (c.iclinicEventId) existingConsult[c.iclinicEventId] = c; });

      const existingEventRec = {};
      S.data.recebimentos.forEach(r => { if (r.iclinicEventId) existingEventRec[r.iclinicEventId] = r; });

      const completedStatuses = new Set(['cp', 'at', 'co']);

      let i = 0;
      for (const r of eventRows) {
        const eventId = r.pk;
        if (!eventId) { i++; continue; }

        const icPatId  = r.patient_id || '';
        const patDocId = icIdToDocId[icPatId] || null;
        const patName  = icIdToName[icPatId]  || '';
        const date     = parseBRDate(r.date || '') || '';
        if (!date) { i++; continue; }

        const status = (r.status || '').toLowerCase().trim();
        const { value, payStatus, isTele } = extractEventData(r.description, r.procedure_pack);
        const consType = isTele ? 'teleconsulta' : 'presencial';

        // Upsert consultation (ALL events → calendar)
        const consultData = {
          date,
          patientId:        patDocId,
          patientName:      patName,
          iclinicPatientId: icPatId,
          status,
          value,
          consultationType: consType,
          iclinicEventId:   eventId,
          notes:            r.description || '',
        };

        if (existingConsult[eventId]) {
          await updateDoc(doc(db, 'consultations', existingConsult[eventId].id), { ...consultData, updatedAt: serverTimestamp() });
          results.eventsUpdated++;
        } else {
          await addDoc(collection(db, 'consultations'), { ...consultData, createdAt: serverTimestamp() });
          results.eventsAdded++;
        }

        // For 2024+ completed events not covered by bill: create recebimento (skip personal blocks)
        const year = parseInt(date.split('-')[0]);
        if (icPatId && year >= 2024 && completedStatuses.has(status) && !billCoveredSet.has(`${icPatId}_${date}`) && !existingEventRec[eventId]) {
          const evtPayStatus = value === 0 ? 'gratuito' : payStatus;
          await addDoc(collection(db, 'recebimentos'), {
            date,
            patient:          patName,
            patientId:        patDocId,
            consultationType: consType,
            value,
            status:           evtPayStatus,
            invoiceStatus:    evtPayStatus === 'gratuito' ? 'isenta' : 'pendente',
            invoiceNumber:    '',
            notes:            r.description || '',
            iclinicEventId:   eventId,
            iclinicPatientId: icPatId,
            createdAt:        serverTimestamp(),
            createdBy:        S.user.uid,
          });
          results.recFromEvents++;
          billCoveredSet.add(`${icPatId}_${date}`);
        }

        i++;
        if (i % 20 === 0) setProgress(65 + Math.round(i/eventRows.length*30), `Agendamentos: ${i}/${eventRows.length}…`);
      }
    }

    await reloadCollection('recebimentos');
    await reloadCollection('consultations');
    updateBadges();
    setProgress(100, 'Concluído!');

    const res = el('import-result');
    res.className = 'import-result success';
    res.innerHTML = `
      <strong>✓ Importação concluída!</strong><br><br>
      👤 Pacientes: <strong>${results.patientsAdded} adicionados</strong>, ${results.patientsUpdated} atualizados<br>
      💰 Recebimentos (financeiro): <strong>${results.billsAdded} adicionados</strong>, ${results.billsUpdated} atualizados<br>
      📅 Agendamentos (calendário): <strong>${results.eventsAdded} adicionados</strong>, ${results.eventsUpdated} atualizados<br>
      ${results.recFromEvents ? `<strong>✨ ${results.recFromEvents} recebimento${results.recFromEvents > 1 ? 's' : ''} criado${results.recFromEvents > 1 ? 's' : ''} via agenda 2024+</strong><br>` : ''}
      ${results.errors ? `<br>⚠ ${results.errors} linha${results.errors > 1 ? 's' : ''} ignorada${results.errors > 1 ? 's' : ''}.` : ''}
      <br><br>Dados disponíveis em <strong>Pacientes</strong>, <strong>Recebimentos</strong> e <strong>Agenda</strong>.
    `;
    res.classList.remove('hidden');
    el('import-progress').classList.add('hidden');
    showToast('Importação concluída!', 'success');
  } catch (err) {
    handleErr(err);
    setProgress(0, '');
    el('import-progress').classList.add('hidden');
    el('import-actions-bar').classList.remove('hidden');
  }
}

function setProgress(pct, label) {
  el('import-progress-fill').style.width = pct + '%';
  el('import-progress-label').textContent = label;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const sep  = lines[0].includes(';') ? ';' : ',';
  const hdrs = splitCSVLine(lines[0], sep).map(h => h.replace(/^"|"$/g,'').trim());
  return lines.slice(1).map(line => {
    const vals = splitCSVLine(line, sep).map(v => v.replace(/^"|"$/g,'').trim());
    return Object.fromEntries(hdrs.map((h,i) => [h, vals[i]||'']));
  }).filter(r => Object.values(r).some(v => v));
}

function splitCSVLine(line, sep) {
  const res=[]; let cur=''; let inQ=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){inQ=!inQ;}
    else if(ch===sep&&!inQ){res.push(cur);cur='';}
    else{cur+=ch;}
  }
  res.push(cur);
  return res;
}

function parseBRDate(str) {
  if (!str) return '';
  let m = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return str;
  return '';
}

function parseBRNumber(str) {
  if (!str) return 0;
  const s = String(str).trim();
  const cleaned = s.includes(',')
    ? s.replace(/\./g, '').replace(',', '.')
    : s;
  return parseFloat(cleaned) || 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTOCOMPLETE
// ─────────────────────────────────────────────────────────────────────────────
function setupAutocomplete(inputId, listId, hiddenId) {
  const input  = el(inputId);
  const list   = el(listId);
  const hidden = hiddenId ? el(hiddenId) : null;

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    if (hidden) hidden.value = '';
    if (!q) { list.classList.add('hidden'); return; }

    const matches = S.data.patients
      .filter(p => (p.name||'').toLowerCase().includes(q))
      .slice(0, 8);

    if (!matches.length) {
      list.innerHTML = '<div class="autocomplete-empty">Nenhum paciente encontrado — será salvo como nome livre.</div>';
    } else {
      list.innerHTML = matches.map(p => `
        <div class="autocomplete-item" data-id="${p.id}" data-name="${esc(p.name||'')}">
          <div class="autocomplete-item-name">${esc(p.name||'')}</div>
          <div class="autocomplete-item-meta">${p.phone||p.email||''}</div>
        </div>`).join('');
    }
    list.classList.remove('hidden');
  });

  list.addEventListener('click', (e) => {
    const item = e.target.closest('.autocomplete-item');
    if (!item) return;
    input.value = item.dataset.name;
    if (hidden) hidden.value = item.dataset.id;
    list.classList.add('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!input.contains(e.target) && !list.contains(e.target)) list.classList.add('hidden');
  });
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
  overlay.addEventListener('click', (e) => { if(e.target===overlay) closeModal(overlay.id); });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELEGATED EVENTS
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const plink = e.target.closest('[data-patient]');
  if (plink) { navigateToPatient(plink.dataset.patient); return; }

  const alink = e.target.closest('.alert-link[data-view]');
  if (alink) { e.preventDefault(); navigateTo(alink.dataset.view); return; }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;

  if      (action === 'edit-rec')       { const r = S.data.recebimentos.find(r=>r.id===id); if(r) openModalRec(r); }
  else if (action === 'del-rec')        { deleteRec(id); }
  else if (action === 'edit-desp')      { const d = S.data.despesas.find(d=>d.id===id); if(d) openModalDesp(d); }
  else if (action === 'del-desp')       { deleteDesp(id); }
  else if (action === 'mark-received')  { markReceived(id); }
  else if (action === 'mark-nf')        { el('nf-rec-id').value=''; el('nf-numero').value=''; el('nf-rec-id').value=id; openModal('modal-nf'); }
  else if (action === 'edit-nota')      { const n = S.data.notas.find(n=>n.id===id); if(n) openModalNota(n); }
  else if (action === 'del-nota')       { deleteNota(id); }
  else if (action === 'edit-pac')       { const p = S.data.patients.find(p=>p.id===id); if(p) openModalPaciente(p); }
  else if (action === 'del-pac')        { deletePatient(id); }
  else if (action === 'view-pac')       { navigateToPatient(id); }
  else if (action === 'cal-select-day') { selectCalendarDay(btn.dataset.date); }
  else if (action === 'merge-pac')      { mergePacientes(btn.dataset.keep, btn.dataset.drop); }
});

el('sidebar-toggle').addEventListener('click', () => el('sidebar').classList.toggle('collapsed'));

// Per-row checkbox changes (delegated — rows are dynamically rendered)
document.addEventListener('change', (e) => {
  if (e.target.classList.contains('nf-check')) {
    const id = e.target.dataset.id;
    e.target.checked ? S.nfSelected.add(id) : S.nfSelected.delete(id);
    e.target.closest('.nf-item')?.classList.toggle('nf-selected', e.target.checked);
    updateNFToolbar();
  }
  if (e.target.classList.contains('inadim-check')) {
    const id = e.target.dataset.id;
    e.target.checked ? S.inadimSelected.add(id) : S.inadimSelected.delete(id);
    e.target.closest('tr')?.classList.toggle('row-selected', e.target.checked);
    updateInadimToolbar();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
function el(id)             { return document.getElementById(id); }
function setText(id, txt)   { const e=el(id); if(e) e.textContent=txt; }
function esc(str)           { return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function today()            { return new Date().toISOString().split('T')[0]; }
function fmtBRL(v)          { return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v||0); }
function fmtBRLShort(v)     { return v>=1000?'R$'+(v/1000).toFixed(0)+'k':fmtBRL(v); }
function fmtDate(d)         { if(!d)return'—'; const[y,m,dy]=d.split('-'); return`${dy}/${m}/${y}`; }
function fmtTimestamp(ts)   { try{return ts.toDate().toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}catch{return''} }
function daysBetween(d1,d2) { return Math.max(0,Math.round((new Date(d2)-new Date(d1))/86400000)); }
function sumWhere(arr,pred) { return arr.filter(pred).reduce((s,r)=>s+(r.value||0),0); }
function calcAge(dateStr)   { if(!dateStr)return null; const b=new Date(dateStr+'T12:00'); const t=new Date(); let age=t.getFullYear()-b.getFullYear(); if(t.getMonth()<b.getMonth()||(t.getMonth()===b.getMonth()&&t.getDate()<b.getDate()))age--; return age; }

function capitalizeName(str) {
  if (!str) return '';
  const particles = new Set(['de','da','do','dos','das','di','del','e','em','a','o','os','as','von','van','el','la','los','las','du','des']);
  return str.trim().split(/\s+/).map((word, i) => {
    if (!word) return word;
    const lower = word.toLowerCase();
    if (i > 0 && particles.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');
}

function extractEventData(description, procedurePack) {
  let value     = 0;
  let payStatus = 'pendente';
  let isTele    = false;

  const desc = (description || '').toLowerCase();
  isTele = desc.includes('online') || desc.includes('teleconsult');

  // Extract value from description: "Pago pix (500)" or "Pago pix (450,00)"
  const descValMatch = (description || '').match(/\((\d+(?:[,\.]\d+)?)\)/);
  if (descValMatch) {
    value = parseBRNumber(descValMatch[1]);
  }

  // Detect payment from description
  if (desc.includes('pago') || desc.includes('pix') || desc.includes('receb')) {
    payStatus = 'pix';
  }

  // If no value from description, try procedure_pack: "Consulta 600,00" or "Consulta 600"
  if (!value && procedurePack) {
    const ppMatch = procedurePack.match(/[Cc]onsulta\s*([\d.,]+)/);
    if (ppMatch) value = parseBRNumber(ppMatch[1]);
    if (!isTele && procedurePack.toLowerCase().includes('online')) isTele = true;
  }

  return { value, payStatus, isTele };
}

function statusBadge(status) {
  const cls = {pix:'badge-pix',pendente:'badge-pendente',gratuito:'badge-gratuito'};
  return `<span class="badge ${cls[status]||''}">${labels.status[status]||status||'—'}</span>`;
}
function nfBadge(status) {
  const cls = {pendente:'badge-nf-pendente',emitida:'badge-emitida',isenta:'badge-isenta'};
  return `<span class="badge ${cls[status]||''}">${labels.invoiceStatus[status]||status||'—'}</span>`;
}
function patientStatusBadge(status) {
  const cls = {ativo:'badge-ativo',inativo:'badge-inativo',alta:'badge-alta'};
  return `<span class="badge ${cls[status]||''}">${labels.patientStatus[status]||status||'—'}</span>`;
}

let toastTimer = null;
function showToast(msg, type='success') {
  const t=el('toast'), ic=el('toast-icon'), mg=el('toast-msg');
  const icons={success:'✓',error:'✕',info:'ℹ'};
  t.className=`toast toast-${type}`;
  ic.textContent=icons[type]||'✓';
  mg.textContent=msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>t.classList.add('hidden'),3500);
}
function showLoading()  { el('loading-overlay').classList.remove('hidden'); }
function hideLoading()  { el('loading-overlay').classList.add('hidden'); }

// ─────────────────────────────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────────
applyPreset('mes');
setupAutocomplete('rec-paciente', 'rec-paciente-list', 'rec-paciente-id');
setupAutocomplete('r-paciente',   'r-paciente-list',   'r-paciente-id');
