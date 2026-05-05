// ─────────────────────────────────────────────────────────────────────────────
// IMPORTS
// ─────────────────────────────────────────────────────────────────────────────
import { firebaseConfig, userRoles, labels } from './firebase-config.js';

import { initializeApp }                                      from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged }
                                                              from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, collection, addDoc, getDocs, getDoc, updateDoc, deleteDoc,
         doc, query, orderBy, serverTimestamp, writeBatch, setDoc, deleteField, onSnapshot }
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
  importFiles:     { patient: null, event: null },
  listeners:       {},
  importing:       false,
  nfSelected:      new Set(),
  nfTab:           'pendentes',
  modalDirty:      false,
  inadimSelected:  new Set(),
  pacSort:         { col: 'name', dir: 'asc' },
  pacStatusFilter: 'todos',
  recSort:         { col: 'date', dir: 'desc' },
  despSort:        { col: 'date', dir: 'desc' },
  retornoSort:     'urgencia',
  chartMonths:     6,
  calendarYear:    new Date().getFullYear(),
  calendarMonth:   new Date().getMonth(),
  calendarSelDay:  null,
  retornoSort:     'asc',
  inativacaoSort:  'asc',
  paymentImportRows: null,
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
    const fromURL = viewFromURL();
    const defaultView = S.role === 'secretaria' ? 'secretaria' : 'dashboard';
    if (fromURL?.view === 'paciente-detalhe' && fromURL.patientId) {
      navigateToPatient(fromURL.patientId, { replace: true });
    } else {
      navigateTo(fromURL?.view || defaultView, { replace: true });
    }
    el('loading-overlay').classList.add('hidden');
  } else {
    unsubscribeAll();
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
  const dashNav = document.querySelector('.nav-item[data-view="dashboard"]');
  if (dashNav) dashNav.classList.toggle('hidden', !isMedica);
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
    closeMobileDrawer();
  });
});

function openMobileDrawer() {
  el('sidebar').classList.add('mobile-open');
  el('sidebar-backdrop').classList.add('active');
  document.body.style.overflow = 'hidden';
}
function closeMobileDrawer() {
  el('sidebar').classList.remove('mobile-open');
  el('sidebar-backdrop').classList.remove('active');
  document.body.style.overflow = '';
}
el('btn-mobile-menu').addEventListener('click', () => {
  el('sidebar').classList.contains('mobile-open') ? closeMobileDrawer() : openMobileDrawer();
});
el('sidebar-backdrop').addEventListener('click', closeMobileDrawer);
el('btn-mobile-logout').addEventListener('click', () => signOut(auth));

function navigateTo(view, { pushHistory = true, replace = false } = {}) {
  if (S.role === 'secretaria' && (view === 'dashboard' || view === 'dre')) view = 'secretaria';
  if (view !== 'import') S.importResultActive = false;
  S.view = view;
  if (pushHistory) history[replace ? 'replaceState' : 'pushState']({ view }, '', '/' + view);
  document.querySelectorAll('section.view').forEach(s => s.classList.add('hidden'));
  const target = el('view-' + view);
  if (target) target.classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === view));
  el('filter-bar').classList.toggle('hidden', ['import','paciente-detalhe','agenda','pacientes','secretaria'].includes(view));
  renderView(view);
}

function navigateToPatient(patientId, { pushHistory = true, replace = false } = {}) {
  S.currentPatient = patientId;
  S.view = 'paciente-detalhe';
  if (pushHistory) history[replace ? 'replaceState' : 'pushState']({ view: 'paciente-detalhe', patientId }, '', `/pacientes/${patientId}`);
  document.querySelectorAll('section.view').forEach(s => s.classList.add('hidden'));
  el('view-paciente-detalhe').classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  el('filter-bar').classList.add('hidden');
  renderPacienteDetalhe(patientId);
}

function viewFromURL() {
  const path = location.pathname.replace(/^\//, '').replace(/\/$/, '');
  if (path.startsWith('pacientes/')) {
    const patientId = path.slice('pacientes/'.length);
    if (patientId) return { view: 'paciente-detalhe', patientId };
  }
  const valid = ['dashboard','secretaria','pacientes','agenda','recebimentos','despesas','dre','import'];
  if (valid.includes(path)) return { view: path };
  return null;
}

window.addEventListener('popstate', e => {
  if (!S.user) return;
  const state = e.state;
  if (!state) {
    navigateTo(S.role === 'secretaria' ? 'secretaria' : 'dashboard', { pushHistory: false });
    return;
  }
  if (state.view === 'paciente-detalhe' && state.patientId) {
    navigateToPatient(state.patientId, { pushHistory: false });
  } else {
    navigateTo(state.view || (S.role === 'secretaria' ? 'secretaria' : 'dashboard'), { pushHistory: false });
  }
});

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
    case 'import':       renderImportTab();    break;
  }
}

async function renderImportTab() {
  const infoEl = el('import-last-info');
  if (!infoEl) return;
  if (!S.importResultActive) {
    const resultEl = el('import-result');
    if (resultEl) { resultEl.innerHTML = ''; resultEl.classList.add('hidden'); }
  }
  try {
    const snap = await getDoc(doc(db, 'metadata', 'lastImport'));
    if (snap.exists()) {
      const d = snap.data();
      const ts = d.timestamp ? fmtTimestamp(d.timestamp) : '—';
      infoEl.innerHTML = `<div class="import-last-info">
        <span>Última importação: <strong>${ts}</strong> · <strong>${esc(d.userEmail || '—')}</strong></span>
        <span>👤 ${d.patientsAdded||0} adicionados${d.patientsUpdated ? ` · ${d.patientsUpdated} atualizados` : ''} · ${d.patientsNoChange||0} sem novidades${d.patientsProtected ? ` · ${d.patientsProtected} com dados protegidos` : ''}</span>
        <span>📅 ${d.eventsAdded||0} adicionados${d.eventsUpdated ? ` · ${d.eventsUpdated} atualizados` : ''} · ${d.eventsNoChange||0} sem novidades</span>
        ${(d.recAdded||0) || (d.recRescheduled||0) || (d.recSkipped||0) ? `<span>💳 ${d.recAdded||0} criadas${d.recRescheduled ? ` · ${d.recRescheduled} remarcada${d.recRescheduled > 1 ? 's' : ''}` : ''}${d.recSkipped ? ` · ${d.recSkipped} já existentes` : ''}</span>` : ''}
      </div>`;
    } else {
      infoEl.innerHTML = '<div class="import-last-info import-last-info-empty">Nenhuma importação registrada ainda.</div>';
    }
  } catch { infoEl.innerHTML = '<div class="import-last-info import-last-info-empty">Não foi possível carregar o histórico de importações.</div>'; }
}

// ─────────────────────────────────────────────────────────────────────────────
// PERIOD FILTER
// ─────────────────────────────────────────────────────────────────────────────
el('filter-select').addEventListener('change', () => {
  const period = el('filter-select').value;
  if (period === 'custom') {
    el('filter-custom').classList.remove('hidden');
  } else {
    el('filter-custom').classList.add('hidden');
    applyPreset(period);
  }
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
  if      (preset === 'semana')     { const dow = now.getDay(); start = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate()-dow)); end = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate()+(6-dow))); }
  else if (preset === 'mes')        { start = ymd(new Date(now.getFullYear(), now.getMonth(), 1));    end = ymd(new Date(now.getFullYear(), now.getMonth()+1, 0)); }
  else if (preset === 'proximomes') { start = ymd(new Date(now.getFullYear(), now.getMonth()+1, 1)); end = ymd(new Date(now.getFullYear(), now.getMonth()+2, 0)); }
  else if (preset === 'mespassado') { start = ymd(new Date(now.getFullYear(), now.getMonth()-1, 1));  end = ymd(new Date(now.getFullYear(), now.getMonth(), 0)); }
  else if (preset === '3meses')     { start = ymd(new Date(now.getFullYear(), now.getMonth()-2, 1));  end = ymd(new Date(now.getFullYear(), now.getMonth()+1, 0)); }
  else if (preset === '6meses')     { start = ymd(new Date(now.getFullYear(), now.getMonth()-5, 1));  end = ymd(new Date(now.getFullYear(), now.getMonth()+1, 0)); }
  else if (preset === 'ano')        { start = `${now.getFullYear()}-01-01`;                            end = `${now.getFullYear()}-12-31`; }
  S.filter = { preset, start, end };
  el('filter-label').textContent = `${fmtDate(start)} → ${fmtDate(end)}`;
  const sel = el('filter-select');
  if (sel && sel.value !== preset) sel.value = preset;
  renderView(S.view);
}

function filteredRec()  { return filterByPeriod(S.data.recebimentos); }
function filteredDesp() { return filterByPeriod(S.data.despesas); }
function filterByPeriod(arr) {
  if (!S.filter.start) return arr;
  return arr.filter(r => r.date >= S.filter.start && r.date <= S.filter.end);
}

// Faturamento bruto de um mês específico, independente do filtro global
function revenueForMonth(year, month) {
  const pad = n => String(n).padStart(2, '0');
  const start = `${year}-${pad(month)}-01`;
  const end   = `${year}-${pad(month)}-31`;
  return S.data.recebimentos
    .filter(r => r.date >= start && r.date <= end && r.status !== 'gratuito')
    .reduce((s, r) => s + (r.value || 0), 0);
}

// Valor efetivo de uma despesa: impostos são calculados dinamicamente sobre o faturamento do mês
function resolvedValue(d) {
  if (d.category === 'impostos' && d.taxRate && d.date) {
    const [y, m] = d.date.split('-').map(Number);
    return (d.taxRate / 100) * revenueForMonth(y, m);
  }
  return d.value || 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA — Firestore CRUD
// ─────────────────────────────────────────────────────────────────────────────
function subscribeCollection(name, constraints) {
  if (S.listeners[name]) { S.listeners[name](); delete S.listeners[name]; }
  const q = query(collection(db, name), ...constraints);
  return new Promise((resolve, reject) => {
    let initial = true;
    S.listeners[name] = onSnapshot(q, snap => {
      S.data[name] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (initial) { initial = false; resolve(); return; }
      if (!S.importing) {
        updateBadges();
        renderView(S.view);
      }
    }, err => { if (initial) { initial = false; reject(err); } });
  });
}

async function subscribeAll() {
  showLoading();
  try {
    await Promise.all([
      subscribeCollection('recebimentos',  [orderBy('date', 'desc')]),
      subscribeCollection('despesas',      [orderBy('date', 'desc')]),
      subscribeCollection('notas',         [orderBy('createdAt', 'desc')]),
      subscribeCollection('patients',      [orderBy('name', 'asc')]),
      subscribeCollection('consultations', [orderBy('date', 'desc')]),
    ]);
    updateBadges();
  } catch (err) {
    console.error(err);
    showToast('Erro ao carregar dados. Verifique as regras do Firestore.', 'error');
  } finally {
    hideLoading();
  }
}

function unsubscribeAll() {
  Object.values(S.listeners).forEach(unsub => unsub());
  S.listeners = {};
}

async function loadAll() { await subscribeAll(); }

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
  const todayStr = today();
  const pendRec = S.data.recebimentos.filter(r => r.status === 'pendente' && r.date <= todayStr);
  const pendNF  = S.data.recebimentos.filter(r => r.invoiceStatus === 'pendente' && r.status !== 'gratuito' && r.date <= todayStr);
  setCount('badge-inadimplencia', pendRec.length);
  setCount('badge-inadim-card', pendRec.length);
  setCount('badge-nf', pendNF.length);
  setCount('badge-retorno', calcRetornoPatients().filter(p => p.needsContact).length);
  setCount('badge-inativacao', calcInativacaoSugestoes().length);
}

function calcInativacaoSugestoes() {
  const todayStr = today();
  const DIAS = 180;
  const completedStatuses = new Set(['cp', 'at', 'co']);
  const patLastConsult = {};
  S.data.consultations.forEach(c => {
    if (!c.patientId || !c.date || c.date > todayStr) return;
    if (!completedStatuses.has(c.status)) return;
    if (!patLastConsult[c.patientId] || c.date > patLastConsult[c.patientId])
      patLastConsult[c.patientId] = c.date;
  });
  const cutoff = new Date(todayStr);
  cutoff.setDate(cutoff.getDate() - DIAS);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const comConsulta = Object.entries(patLastConsult)
    .filter(([patId, lastDate]) => {
      const pac = S.data.patients.find(p => p.id === patId);
      if (!pac || pac.status !== 'ativo') return false;
      const ref = (pac.manterAtivoDesde && pac.manterAtivoDesde > lastDate)
        ? pac.manterAtivoDesde : lastDate;
      return ref <= cutoffStr;
    })
    .map(([patId, lastDate]) => {
      const pac = S.data.patients.find(p => p.id === patId);
      return { patId, lastDate, name: pac?.name || '—', manterAtivoDesde: pac?.manterAtivoDesde || null, neverAttended: false };
    });

  const semConsulta = S.data.patients
    .filter(p => {
      if (p.status !== 'ativo' || patLastConsult[p.id]) return false;
      if (p.manterAtivoDesde && p.manterAtivoDesde > cutoffStr) return false;
      return true;
    })
    .map(p => ({ patId: p.id, lastDate: null, name: p.name || '—', manterAtivoDesde: p.manterAtivoDesde || null, neverAttended: true }));

  return [...comConsulta, ...semConsulta];
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
    showToast('Consulta salva!', 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

function deleteRec(id) {
  showConfirm('Excluir esta consulta permanentemente?', async () => {
    showLoading();
    try {
      await deleteDoc(doc(db, 'recebimentos', id));
      await reloadCollection('recebimentos');
      updateBadges(); renderView(S.view);
      showToast('Recebimento excluído.', 'info');
    } catch (err) { handleErr(err); } finally { hideLoading(); }
  }, { title: 'Excluir consulta' });
}

async function markReceived(id) {
  const rec = S.data.recebimentos.find(r => r.id === id);
  if (!rec) return;
  const prevStatus = rec.status;
  showLoading();
  try {
    await updateDoc(doc(db, 'recebimentos', id), { status: 'pix', updatedAt: serverTimestamp() });
    await reloadCollection('recebimentos');
    updateBadges(); renderView(S.view);
    showToast('Marcado como recebido via PIX!', 'success', async () => {
      await updateDoc(doc(db, 'recebimentos', id), { status: prevStatus, updatedAt: serverTimestamp() });
      await reloadCollection('recebimentos');
      updateBadges(); renderView(S.view);
    });
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

async function saveInadimContact(id, contactStatus, promisedDate) {
  const update = { contactStatus, updatedAt: serverTimestamp() };
  if (contactStatus === 'promised' && promisedDate) update.promisedDate = promisedDate;
  else update.promisedDate = deleteField();
  showLoading();
  try {
    await updateDoc(doc(db, 'recebimentos', id), update);
    const rec = S.data.recebimentos.find(r => r.id === id);
    if (rec) { rec.contactStatus = contactStatus; rec.promisedDate = promisedDate || null; }
    if (S.view === 'inadimplencia') renderInadimplencia();
    if (S.view === 'secretaria') renderInadimAlerta();
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

function deleteDesp(id) {
  showConfirm('Excluir esta despesa permanentemente?', async () => {
    showLoading();
    try {
      await deleteDoc(doc(db, 'despesas', id));
      await reloadCollection('despesas'); renderView(S.view);
      showToast('Despesa excluída.', 'info');
    } catch (err) { handleErr(err); } finally { hideLoading(); }
  }, { title: 'Excluir despesa' });
}

// ── Notas ─────────────────────────────────────────────────
async function saveNota(data, id = null) {
  showLoading();
  try {
    if (id) { await updateDoc(doc(db, 'notas', id), { ...data, updatedAt: serverTimestamp() }); }
    else    { await addDoc(collection(db, 'notas'), { ...data, createdAt: serverTimestamp(), createdBy: S.user.uid, createdByEmail: S.user.email }); }
    await reloadCollection('notas');
    showToast('Anotação salva!', 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

function deleteNota(id) {
  showConfirm('Excluir esta anotação permanentemente?', async () => {
    showLoading();
    try {
      await deleteDoc(doc(db, 'notas', id));
      await reloadCollection('notas'); renderSecretaria();
      showToast('Anotação excluída.', 'info');
    } catch (err) { handleErr(err); } finally { hideLoading(); }
  }, { title: 'Excluir anotação' });
}

// ── Pacientes ─────────────────────────────────────────────
async function savePatient(data, id = null) {
  showLoading();
  try {
    if (id) { await updateDoc(doc(db, 'patients', id), { ...data, manuallyEdited: true, updatedAt: serverTimestamp() }); }
    else    { await addDoc(collection(db, 'patients'), { ...data, createdAt: serverTimestamp(), createdBy: S.user.uid }); }
    await reloadCollection('patients');
    showToast('Paciente salvo!', 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

function deletePatient(id) {
  showConfirm('Excluir este paciente? O histórico de consultas será mantido.', async () => {
    showLoading();
    try {
      await deleteDoc(doc(db, 'patients', id));
      await reloadCollection('patients'); renderPacientes();
      showToast('Paciente excluído.', 'info');
    } catch (err) { handleErr(err); } finally { hideLoading(); }
  }, { title: 'Excluir paciente' });
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
  showConfirm(`Marcar ${targets.length} nota${targets.length > 1 ? 's fiscais' : ' fiscal'} como emitida${targets.length > 1 ? 's' : ''}? Esta ação não pode ser desfeita.`, async () => {
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
  }, { title: 'Marcar NFs como emitidas', okLabel: 'Marcar emitidas' });
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
          if (seen.has(key)) continue;
          seen.add(key);
          const notDupA = g[i].notDuplicate || [];
          const notDupB = g[j].notDuplicate || [];
          if (notDupA.includes(g[j].id) || notDupB.includes(g[i].id)) continue;
          groups.push([g[i], g[j]]);
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
        <div style="text-align:right;padding:6px 0 2px">
          <button class="btn btn-sm btn-outline" style="font-size:.75rem;color:var(--text-muted)" data-action="not-duplicate" data-id-a="${a.id}" data-id-b="${b.id}">Manter ambos — não são duplicatas</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function mergePacientes(keepId, dropId) {
  const keepPac = S.data.patients.find(p => p.id === keepId);
  const dropPac = S.data.patients.find(p => p.id === dropId);
  if (!keepPac || !dropPac) return;

  showConfirm(`Manter "${keepPac.name}" e excluir "${dropPac.name}"? Todos os recebimentos e agendamentos serão transferidos. Esta ação não pode ser desfeita.`, async () => {
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
  }, { title: 'Mesclar pacientes', okLabel: 'Mesclar' });
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
function renderDashboard() {
  const recs  = filteredRec();
  const desps = filteredDesp();
  const recebida  = sumWhere(recs,  r => r.status === 'pix');
  const pendente  = sumWhere(recs,  r => r.status === 'pendente');
  const totalDesp = desps.reduce((s, d) => s + resolvedValue(d), 0);
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

  const pendNF = S.data.recebimentos.filter(r => r.invoiceStatus === 'pendente' && r.status !== 'gratuito' && r.date <= today());
  const alertEl = el('alert-nf');
  alertEl.classList.toggle('hidden', pendNF.length === 0);
  if (pendNF.length) setText('alert-nf-count', `${pendNF.length} nota${pendNF.length>1?'s fiscais':' fiscal'}`);

  setText('dash-title', `Dashboard — ${drePeriodLabel()}`);
  renderAniversariantes('alert-aniversario', 'alert-aniversario-text');
  renderMensalChart();
  renderRecent();
}

function renderMensalChart() {
  const n      = S.chartMonths;
  const months = getMonthlyData(n);
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
      plugins: {
        legend: { position: 'bottom', labels: { font: { family:'Plus Jakarta Sans', size:11 }, boxWidth:12 } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmtBRL(ctx.parsed.y)}` } },
      },
      scales: {
        x: { grid:{display:false}, ticks:{ font:{family:'Plus Jakarta Sans',size:11}, maxRotation: n > 6 ? 45 : 0, minRotation: n > 6 ? 45 : 0 } },
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
    const despesa = S.data.despesas.filter(r=>r.date?.startsWith(key)).reduce((s,r)=>s+resolvedValue(r),0);
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
el('btn-cal-year-prev').addEventListener('click', () => { S.calendarYear--; renderAgenda(); });
el('btn-cal-year-next').addEventListener('click', () => { S.calendarYear++; renderAgenda(); });
el('btn-cal-today').addEventListener('click', () => {
  const now = new Date();
  S.calendarYear = now.getFullYear();
  S.calendarMonth = now.getMonth();
  renderAgenda();
});
el('btn-cal-close-detail').addEventListener('click', () => {
  S.calendarSelDay = null;
  el('calendar-detail').classList.add('hidden');
  document.querySelectorAll('.cal-day.selected').forEach(d => d.classList.remove('selected'));
});

function getHolidays(year) {
  function easter(y) {
    const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4;
    const f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
    const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4;
    const l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451);
    return new Date(y,Math.floor((h+l-7*m+114)/31)-1,((h+l-7*m+114)%31)+1);
  }
  function add(d,n){const r=new Date(d);r.setDate(r.getDate()+n);return r;}
  function fmt(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  const map={};
  const put=(date,name,type)=>{map[fmt(date)]={name,type};};
  // Nacionais fixos
  put(new Date(year,0,1),  'Confraternização Universal','nacional');
  put(new Date(year,3,21), 'Tiradentes','nacional');
  put(new Date(year,4,1),  'Dia do Trabalho','nacional');
  put(new Date(year,8,7),  'Independência do Brasil','nacional');
  put(new Date(year,9,12), 'N. Sra. Aparecida','nacional');
  put(new Date(year,10,2), 'Finados','nacional');
  put(new Date(year,10,15),'Proclamação da República','nacional');
  put(new Date(year,10,20),'Consciência Negra','nacional');
  put(new Date(year,11,25),'Natal','nacional');
  // Estadual SP
  put(new Date(year,6,9),  'Revolução Constitucionalista','estadual');
  // Municipal SP
  put(new Date(year,0,25), 'Aniversário de SP','municipal');
  // Móveis (Páscoa)
  const e=easter(year);
  put(add(e,-48),'Carnaval (2ª)','facultativo');
  put(add(e,-47),'Carnaval (3ª)','facultativo');
  put(add(e,-2), 'Sexta-feira Santa','nacional');
  put(e,         'Páscoa','nacional');
  put(add(e,60), 'Corpus Christi','nacional');
  return map;
}

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
  const holidays    = getHolidays(year);

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
      const chipTitle = isBlock
        ? (e.notes || 'Bloqueio pessoal')
        : `${e.patientName || '?'} — ${e.status || ''}`;
      const parts = (e.patientName || '?').split(' ');
      const chipFull  = isBlock ? (e.notes || 'Bloqueio').substring(0, 22) : (parts.length > 1 ? `${parts[0]} ${parts[parts.length-1]}` : parts[0]);
      const chipShort = isBlock ? (e.notes || 'Bloqueio').substring(0, 10) : parts[0];
      return `<div class="cal-chip ${chipCls}" title="${esc(chipTitle)}"><span class="chip-desktop">${esc(chipFull)}</span><span class="chip-mobile">${esc(chipShort)}</span></div>`;
    }).join('');
    const more = events.length > 3 ? `<div class="cal-chip cal-chip-more">+${events.length - 3}</div>` : '';
    const hol  = holidays[dateStr];
    const holHtml = hol ? `<div class="cal-holiday cal-holiday-${hol.type}" title="${esc(hol.name)}">${esc(hol.name)}</div>` : '';

    cells += `<div class="cal-day${isToday?' today':''}${isSel?' selected':''}" data-date="${dateStr}" data-action="cal-select-day">
      <div class="cal-day-num">${d}</div>${holHtml}${chips}${more}
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
    .sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99'));

  const [y, m, d] = dateStr.split('-');
  const patientCount = events.filter(e => e.iclinicPatientId || e.patientId).length;
  setText('cal-detail-title', `${parseInt(d)}/${parseInt(m)}/${y} — ${patientCount} consulta${patientCount !== 1 ? 's' : ''}`);

  const hol = getHolidays(parseInt(y))[dateStr];
  const detailList = el('cal-detail-list');
  const holBanner = hol
    ? `<div class="cal-detail-holiday cal-detail-holiday-${hol.type}">
        <span>🗓</span><span>${esc(hol.name)}</span>
       </div>`
    : '';

  const statusLabels = { cp:'Compareceu', at:'Atendido', sc:'Agendado', na:'Não compareceu', co:'Confirmado online', re:'Remarcado', eo:'Encaixe online', po:'Pendente online' };

  if (events.length === 0) {
    detailList.innerHTML = holBanner + '<div class="empty-state">Nenhuma consulta registrada neste dia.</div>';
    el('calendar-detail').classList.remove('hidden');
    return;
  }

  const timeToMins = t => { if (!t) return null; const [h,m] = t.split(':').map(Number); return h*60+m; };
  const fmtTime    = t => t || '—:——';

  const items = [];
  for (let i = 0; i < events.length; i++) {
    const e    = events[i];
    const prev = events[i - 1];

    // Janela entre eventos (gap >= 15 min)
    if (prev && prev.endTime && e.startTime) {
      const gapStart = timeToMins(prev.endTime);
      const gapEnd   = timeToMins(e.startTime);
      if (gapEnd - gapStart >= 15) {
        items.push(`<div class="cal-detail-gap">
          <span class="cal-detail-gap-time">${fmtTime(prev.endTime)} – ${fmtTime(e.startTime)}</span>
          <span class="cal-detail-gap-label">Janela disponível (${gapEnd - gapStart} min)</span>
        </div>`);
      }
    }

    const isBlock   = !e.iclinicPatientId && !e.patientId;
    const dotCls    = isBlock ? 'cal-status-block' : `cal-status-${e.status || 'sc'}`;
    const statusTxt = isBlock ? 'Bloqueio' : (statusLabels[e.status] || e.status || '—');
    const nameEl    = isBlock
      ? `<span style="color:var(--text-muted);font-style:italic">${esc(e.notes || 'Bloqueio pessoal')}</span>`
      : e.patientId
        ? `<span class="patient-link" data-patient="${e.patientId}">${esc(e.patientName || '—')}</span>`
        : esc(e.patientName || '—');
    const timeRange = (e.startTime || e.endTime)
      ? `<span style="font-weight:600;color:var(--text-muted);min-width:90px;flex-shrink:0">${fmtTime(e.startTime)}${e.endTime ? ' – '+fmtTime(e.endTime) : ''}</span>`
      : '';
    const subLine = isBlock ? '' : `<div style="font-size:.75rem;color:var(--text-muted)">${statusTxt} · ${labels.consultationType[e.consultationType] || e.consultationType || '—'}</div>`;
    const notesLine = (!isBlock && e.notes)
      ? `<div style="font-size:.75rem;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(e.notes)}</div>`
      : '';

    const modalCls = isBlock ? '' : e.consultationType === 'teleconsulta' ? ' cal-event-teleconsulta' : ' cal-event-presencial';
    const clickable = !isBlock && e.id;
    items.push(`<div class="cal-detail-item${clickable ? ' cal-detail-item-clickable' : ''}${modalCls}" ${clickable ? `data-action="open-consult-detail" data-id="${e.id}"` : ''}>
      ${timeRange}
      <div class="cal-detail-dot ${dotCls}" style="flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;color:var(--text)">${nameEl}</div>
        ${subLine}${notesLine}
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        ${(!isBlock && e.value) ? `<span style="font-weight:700;color:var(--text)">${fmtBRL(e.value)}</span>` : ''}
        ${clickable ? `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" style="color:var(--text-muted);flex-shrink:0"><path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd"/></svg>` : ''}
      </div>
    </div>`);
  }

  detailList.innerHTML = holBanner + items.join('');
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

document.querySelector('#view-pacientes thead').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  const col = th.dataset.sort;
  if (S.pacSort.col === col) S.pacSort.dir = S.pacSort.dir === 'asc' ? 'desc' : 'asc';
  else { S.pacSort.col = col; S.pacSort.dir = 'asc'; }
  renderPacientes();
});

function renderPacientes() {
  renderDuplicatesSection();

  const rawQ   = el('search-pac').value;
  const q      = rawQ.toLowerCase();
  const qDigits = rawQ.replace(/\D/g, '');
  let rows = S.data.patients
    .filter(p => {
      if (!rawQ) return true;
      if ((p.name||'').toLowerCase().includes(q)) return true;
      if (qDigits && (p.phone||'').replace(/\D/g,'').includes(qDigits)) return true;
      if (qDigits && (p.phone2||'').replace(/\D/g,'').includes(qDigits)) return true;
      return false;
    })
    .filter(p => S.pacStatusFilter === 'todos' || (p.status || 'ativo') === S.pacStatusFilter)
    .map(p => ({ p, stats: getPatientStats(p.id, p.name) }));

  document.querySelectorAll('.pac-status-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.pacStatus === S.pacStatusFilter));

  const { col, dir } = S.pacSort;
  const mult = dir === 'asc' ? 1 : -1;
  rows.sort((a, b) => {
    switch (col) {
      case 'name':      return mult * (a.p.name||'').localeCompare(b.p.name||'', 'pt-BR', { sensitivity: 'base' });
      case 'consultas': return mult * (a.stats.totalConsultas - b.stats.totalConsultas);
      case 'lastVisit': return mult * ((a.stats.lastVisit||'').localeCompare(b.stats.lastVisit||''));
      case 'totalPago': return mult * (a.stats.totalPago - b.stats.totalPago);
      default:          return 0;
    }
  });

  el('summary-pac').innerHTML = `${rows.length} paciente${rows.length!==1?'s':''}`;

  // Update sort arrows
  document.querySelectorAll('#view-pacientes thead th[data-sort]').forEach(th => {
    if (th.dataset.sort === col) th.setAttribute('data-dir', dir);
    else th.removeAttribute('data-dir');
  });

  const tbody = el('tbody-pac');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Nenhum paciente encontrado.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(({ p, stats }) => `<tr>
      <td><span class="patient-link" data-patient="${p.id}">${esc(p.name||'—')}</span></td>
      <td>${esc(p.phone||'—')}</td>
      <td>${stats.totalConsultas}</td>
      <td>${stats.lastVisit ? fmtDate(stats.lastVisit) : '—'}</td>
      <td class="text-right value-cell">${fmtBRL(stats.totalPago)}</td>
      <td class="text-right value-cell" style="color:${stats.totalPendente>0?'var(--amber)':'var(--text-muted)'}">${fmtBRL(stats.totalPendente)}</td>
      <td>${patientStatusBadge(p.status)}</td>
      <td><div class="action-btns">
        <button class="btn-edit" data-id="${p.id}" data-action="edit-pac">Editar</button>
        <button class="btn-del" data-id="${p.id}" data-action="del-pac">Excluir</button>
      </div></td>
    </tr>`).join('');
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
  const todayStr = today();
  const lastPastVisit = stats.recs.find(r => r.date <= todayStr)?.date || null;
  const nextConsult   = S.data.consultations
    .filter(c => c.patientId === patientId && c.date > todayStr)
    .sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  let visitCardHTML;
  if (nextConsult) {
    visitCardHTML = `
    <div class="kpi-card kpi-sage">
      <div class="kpi-label">Próxima consulta</div>
      <div class="kpi-value" style="font-size:1.2rem;color:var(--green,#16a34a)">${fmtDate(nextConsult.date)}</div>
      <div class="kpi-meta">${lastPastVisit ? `Última visita: ${fmtDate(lastPastVisit)}` : 'Sem visitas anteriores'}</div>
    </div>`;
  } else if (lastPastVisit) {
    visitCardHTML = `
    <div class="kpi-card kpi-sage">
      <div class="kpi-label">Última visita</div>
      <div class="kpi-value" style="font-size:1.2rem">${fmtDate(lastPastVisit)}</div>
      <div class="kpi-meta" style="color:var(--amber,#d97706);font-weight:600">Sem retorno agendado</div>
    </div>`;
  } else {
    visitCardHTML = `
    <div class="kpi-card kpi-sage">
      <div class="kpi-label">Consultas</div>
      <div class="kpi-value" style="font-size:1rem;color:var(--text-muted)">Sem registros</div>
    </div>`;
  }

  el('pac-kpis').innerHTML = `
    <div class="kpi-card kpi-blue">
      <div class="kpi-label">Total de Consultas</div>
      <div class="kpi-value">${stats.totalConsultas}</div>
      <div class="kpi-meta">${stats.totalGratuito} gratuita${stats.totalGratuito!==1?'s':''}</div>
    </div>
    ${visitCardHTML}
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
    pac.cpf       ? ['CPF', fmtCPF(pac.cpf)]                                          : null,
    pac.indication? ['Como chegou', pac.indication]                                    : null,
  ].filter(Boolean);

  el('pac-info-grid').innerHTML = infoItems.map(([label, value]) => {
    const isPhone = label === 'Telefone' || label === 'Telefone 2';
    const extra = isPhone && value !== '—' ? waBtn(value) : '';
    return `<div class="pac-info-item"><div class="pac-info-label">${label}</div><div class="pac-info-value" style="${extra ? 'display:flex;align-items:center;gap:6px' : ''}">${esc(value)}${extra}</div></div>`;
  }).join('') + (pac.notes ? `<div class="pac-info-item pac-info-wide"><div class="pac-info-label">Observações</div><div class="pac-info-value">${esc(pac.notes)}</div></div>` : '');

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
    invoiceNumber:   el('rec-invoice-number').value.trim(),
    notes:           el('rec-obs').value.trim(),
  };
  await saveRecebimento(data, S.editingRec);
  closeModal('modal-rec');
  renderRecebimentos();
});

el('search-rec').addEventListener('input', renderRecebimentos);

el('thead-rec').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  const col = th.dataset.sort;
  if (S.recSort.col === col) S.recSort.dir = S.recSort.dir === 'asc' ? 'desc' : 'asc';
  else { S.recSort.col = col; S.recSort.dir = 'asc'; }
  renderRecebimentos();
});

function renderRecebimentos() {
  let recs = filteredRec();
  const q  = el('search-rec').value.toLowerCase();
  if (q) recs = recs.filter(r => (r.patient||'').toLowerCase().includes(q));

  const { col, dir } = S.recSort;
  const mult = dir === 'asc' ? 1 : -1;
  recs.sort((a, b) => {
    switch (col) {
      case 'date':            return mult * (a.date||'').localeCompare(b.date||'');
      case 'patient':         return mult * (a.patient||'').localeCompare(b.patient||'', 'pt-BR', { sensitivity: 'base' });
      case 'consultationType':return mult * (a.consultationType||'').localeCompare(b.consultationType||'');
      case 'value':           return mult * ((a.value||0) - (b.value||0));
      case 'status':          return mult * (a.status||'').localeCompare(b.status||'');
      case 'invoiceStatus':   return mult * (a.invoiceStatus||'').localeCompare(b.invoiceStatus||'');
      default:                return 0;
    }
  });

  document.querySelectorAll('#thead-rec th[data-sort]').forEach(th => {
    if (th.dataset.sort === col) th.setAttribute('data-dir', dir);
    else th.removeAttribute('data-dir');
  });

  const total    = recs.reduce((s,r)=>s+(r.value||0),0);
  const recebido = recs.filter(r=>r.status==='pix').reduce((s,r)=>s+(r.value||0),0);
  el('summary-rec').classList.toggle('hidden', S.role !== 'medica');
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
      <td>${statusBadge(r.status)}${r.consolidated ? ' <span title="Consolidado pela secretária" style="font-size:.7rem;opacity:.6">🔒</span>' : ''}</td>
      <td>${nfInfo}</td>
      <td style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted);font-size:.78rem">${esc(r.notes||'')}</td>
      <td><div class="action-btns">
        <button class="btn-edit" data-id="${r.id}" data-action="edit-rec">Editar</button>
        <button class="btn-del" data-id="${r.id}" data-action="del-rec">Excluir</button>
      </div></td>
    </tr>`;
  }).join('');
}

function openModalRec(rec = null, prefill = null) {
  S.editingRec = rec ? rec.id : null;
  setText('modal-rec-title', rec ? 'Editar Consulta' : 'Nova Consulta');
  el('rec-id').value          = rec ? rec.id : '';
  el('rec-data').value        = rec ? rec.date        : (prefill?.date || today());
  el('rec-paciente').value    = rec ? (rec.patient||'') : (prefill?.patientName || '');
  el('rec-paciente-id').value = rec ? (rec.patientId||'') : (prefill?.patientId || '');
  el('rec-tipo').value        = rec ? (rec.consultationType||'') : (prefill?.consultationType || '');
  el('rec-valor').value       = rec ? (rec.value || '') : '';
  el('rec-status').value      = rec ? (rec.status || '') : '';
  el('rec-nf').value              = rec ? (rec.invoiceStatus || 'pendente') : 'pendente';
  el('rec-invoice-number').value  = rec ? (rec.invoiceNumber || '') : '';
  el('rec-obs').value             = rec ? (rec.notes || '') : '';
  openModal('modal-rec');
}

function openConsultDetail(eventId) {
  const ev = S.data.consultations.find(c => c.id === eventId);
  if (!ev) return;

  const [y, m, d] = ev.date.split('-');
  const statusLabels = { cp:'Compareceu', at:'Atendido', sc:'Agendado', na:'Não compareceu', co:'Confirmado online', re:'Remarcado', eo:'Encaixe online', po:'Pendente online' };
  const fmtTime = t => t || '—';

  setText('cd-patient-name', ev.patientName || '—');
  setText('cd-date', `${parseInt(d)}/${parseInt(m)}/${y}`);

  // Seção 1 — iClinic
  const timeStr = ev.startTime ? `${fmtTime(ev.startTime)}${ev.endTime ? ' – '+fmtTime(ev.endTime) : ''}` : null;
  el('cd-iclinic').innerHTML = `
    <div class="cd-row"><span class="cd-label">Status</span><span>${statusLabels[ev.status] || ev.status || '—'}</span></div>
    ${timeStr ? `<div class="cd-row"><span class="cd-label">Horário</span><span>${esc(timeStr)}</span></div>` : ''}
    ${ev.consultationType ? `<div class="cd-row"><span class="cd-label">Tipo</span><span>${labels.consultationType[ev.consultationType] || ev.consultationType}</span></div>` : ''}
    ${ev.notes ? `<div class="cd-row"><span class="cd-label">Obs.</span><span style="color:var(--text-muted)">${esc(ev.notes)}</span></div>` : ''}
    ${ev.patientId ? `<div class="cd-row"><span class="cd-label"></span><span><span class="patient-link" data-patient="${ev.patientId}" style="font-size:.8rem">Ver cadastro do paciente →</span></span></div>` : ''}
  `;

  // Seção 2 — Financeiro
  const recs = S.data.recebimentos.filter(r => r.patientId === ev.patientId && r.date === ev.date);
  if (recs.length) {
    el('cd-financial').innerHTML = recs.map(r => `
      <div class="cd-rec-block">
        <div class="cd-row"><span class="cd-label">Valor</span><span style="font-weight:700">${fmtBRL(r.value || 0)}</span></div>
        <div class="cd-row"><span class="cd-label">Pagamento</span><span>${statusBadge(r.status)}</span></div>
        <div class="cd-row"><span class="cd-label">Nota Fiscal</span><span>${nfBadge(r.invoiceStatus)}${r.invoiceNumber ? ` <span style="font-size:.75rem;color:var(--text-muted)">NF ${esc(r.invoiceNumber)}</span>` : ''}</span></div>
        ${r.notes ? `<div class="cd-row"><span class="cd-label">Obs.</span><span style="color:var(--text-muted)">${esc(r.notes)}</span></div>` : ''}
        <div class="cd-actions">
          <button class="btn btn-sm btn-outline" data-action="cd-edit-rec" data-id="${r.id}">Editar lançamento</button>
        </div>
      </div>`).join('');
  } else {
    el('cd-financial').innerHTML = `
      <div class="empty-state" style="padding:16px 0">Nenhum lançamento registrado para esta data.</div>
      <div class="cd-actions">
        <button class="btn btn-sm btn-primary" data-action="cd-register-payment" data-event-id="${ev.id}">+ Registrar pagamento</button>
      </div>`;
  }

  openModal('modal-consult-detail');
}

// ─────────────────────────────────────────────────────────────────────────────
// DESPESAS VIEW
// ─────────────────────────────────────────────────────────────────────────────
el('btn-nova-desp').addEventListener('click', () => openModalDesp());

el('desp-cat').addEventListener('change', updateDespModalMode);
el('desp-pct').addEventListener('input', updateDespPctPreview);
el('desp-data').addEventListener('change', updateDespPctPreview);

function updateDespModalMode() {
  const isImposto = el('desp-cat').value === 'impostos';
  el('desp-valor-group').classList.toggle('hidden', isImposto);
  el('desp-pct-group').classList.toggle('hidden', !isImposto);
  el('desp-valor').required = !isImposto;
  el('desp-pct').required   = isImposto;
  if (isImposto) updateDespPctPreview();
}

function updateDespPctPreview() {
  const pct      = parseFloat(el('desp-pct').value) || 0;
  const dateVal  = el('desp-data').value;
  let grossRevenue;
  if (dateVal) {
    const [y, m] = dateVal.split('-').map(Number);
    grossRevenue = revenueForMonth(y, m);
  } else {
    grossRevenue = filteredRec().filter(r => r.status !== 'gratuito').reduce((s, r) => s + (r.value || 0), 0);
  }
  const calculated = (pct / 100) * grossRevenue;
  el('desp-pct-preview').textContent = pct > 0
    ? `Sobre ${fmtBRL(grossRevenue)} de faturamento bruto = ${fmtBRL(calculated)}`
    : '';
}

el('form-desp').addEventListener('submit', async (e) => {
  e.preventDefault();
  const isImposto = el('desp-cat').value === 'impostos';
  const isNew     = !S.editingDesp;
  const isMensal  = el('desp-rec').value === 'mensal';
  let taxRate = null;

  const baseDate = el('desp-data').value;
  const [baseY, baseM] = baseDate.split('-').map(Number);

  // Para imposto com recorrência mensal, cada mês tem seu próprio valor calculado
  if (isImposto && isNew && isMensal) {
    taxRate = parseFloat(el('desp-pct').value) || 0;
    const baseData = {
      date:        baseDate,
      description: el('desp-desc').value.trim(),
      category:    el('desp-cat').value,
      recurrence:  el('desp-rec').value,
      taxRate,
    };
    const monthPreviews = Array.from({ length: 12 }, (_, i) => {
      const dt  = new Date(baseY, baseM - 1 + i, 1);
      const rev = revenueForMonth(dt.getFullYear(), dt.getMonth() + 1);
      return { dt, estimatedValue: (taxRate / 100) * rev };
    });
    const totalVal = monthPreviews.reduce((s, mp) => s + mp.estimatedValue, 0);
    showConfirm(
      `Isso vai criar 12 lançamentos mensais de imposto (${taxRate}%), calculados sobre o faturamento de cada mês individualmente. Total estimado: ${fmtBRL(totalVal)}. Confirmar?`,
      async () => {
        closeModal('modal-desp');
        showLoading();
        try {
          const batch = writeBatch(db);
          for (const { dt } of monthPreviews) {
            const pad = n => String(n).padStart(2, '0');
            const dateStr = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(baseDate.split('-')[2])}`;
            batch.set(doc(collection(db, 'despesas')), {
              ...baseData, date: dateStr, createdAt: serverTimestamp(), createdBy: S.user.uid,
            });
          }
          await batch.commit();
          await reloadCollection('despesas');
          showToast('12 lançamentos de imposto criados!', 'success');
          renderDespesas();
        } catch (err) { handleErr(err); } finally { hideLoading(); }
      },
      { title: 'Criar despesa recorrente', okLabel: 'Criar 12 lançamentos' }
    );
    return;
  }

  let value;
  if (isImposto) {
    taxRate = parseFloat(el('desp-pct').value) || 0;
    value   = null; // calculado dinamicamente via resolvedValue
  } else {
    value = parseFloat(el('desp-valor').value) || 0;
  }

  const data = {
    date:        baseDate,
    description: el('desp-desc').value.trim(),
    category:    el('desp-cat').value,
    recurrence:  el('desp-rec').value,
    ...(isImposto ? {} : { value }),
    taxRate:     taxRate ?? null,
  };

  if (isNew && isMensal) {
    showConfirm(
      `Isso vai criar 12 lançamentos mensais a partir de ${fmtDate(data.date)} com o valor ${fmtBRL(data.value)} cada. Confirmar?`,
      async () => {
        closeModal('modal-desp');
        showLoading();
        try {
          const batch = writeBatch(db);
          for (let i = 0; i < 12; i++) {
            const dt = new Date(baseY, baseM - 1 + i, Number(baseDate.split('-')[2]));
            const pad = n => String(n).padStart(2, '0');
            const dateStr = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
            batch.set(doc(collection(db, 'despesas')), {
              ...data, date: dateStr, createdAt: serverTimestamp(), createdBy: S.user.uid,
            });
          }
          await batch.commit();
          await reloadCollection('despesas');
          showToast('12 lançamentos mensais criados!', 'success');
          renderDespesas();
        } catch (err) { handleErr(err); } finally { hideLoading(); }
      },
      { title: 'Criar despesa recorrente', okLabel: 'Criar 12 lançamentos' }
    );
    return;
  }

  await saveDespesa(data, S.editingDesp);
  closeModal('modal-desp');
  renderDespesas();
});

el('search-desp').addEventListener('input', renderDespesas);

el('thead-desp').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  const col = th.dataset.sort;
  if (S.despSort.col === col) S.despSort.dir = S.despSort.dir === 'asc' ? 'desc' : 'asc';
  else { S.despSort.col = col; S.despSort.dir = 'asc'; }
  renderDespesas();
});

function renderDespesas() {
  let desps = filteredDesp();
  const q   = el('search-desp').value.toLowerCase();
  if (q) desps = desps.filter(d => (d.description||'').toLowerCase().includes(q));

  const { col, dir } = S.despSort;
  const mult = dir === 'asc' ? 1 : -1;
  desps.sort((a, b) => {
    switch (col) {
      case 'date':        return mult * (a.date||'').localeCompare(b.date||'');
      case 'description': return mult * (a.description||'').localeCompare(b.description||'', 'pt-BR', { sensitivity: 'base' });
      case 'category':    return mult * (a.category||'').localeCompare(b.category||'');
      case 'recurrence':  return mult * (a.recurrence||'').localeCompare(b.recurrence||'');
      case 'value':       return mult * (resolvedValue(a) - resolvedValue(b));
      default:            return 0;
    }
  });

  document.querySelectorAll('#thead-desp th[data-sort]').forEach(th => {
    if (th.dataset.sort === col) th.setAttribute('data-dir', dir);
    else th.removeAttribute('data-dir');
  });

  const total = desps.reduce((s,d)=>s+resolvedValue(d),0);
  el('summary-desp').innerHTML = `${desps.length} reg. &nbsp;|&nbsp; Total: <strong>${fmtBRL(total)}</strong>`;

  const tbody = el('tbody-desp');
  if (!desps.length) { tbody.innerHTML='<tr><td colspan="6" class="empty-row">Nenhuma despesa no período.</td></tr>'; return; }
  tbody.innerHTML = desps.map(d => `<tr>
    <td>${fmtDate(d.date)}</td>
    <td>${esc(d.description||'—')}</td>
    <td><span class="cat-tag">${labels.expenseCategory[d.category]||d.category||'—'}</span></td>
    <td><span class="cat-tag">${labels.recurrence[d.recurrence]||'Única'}</span></td>
    <td class="text-right value-cell" style="color:var(--red)">${fmtBRL(resolvedValue(d))}${d.taxRate ? `<span style="font-size:.75rem;color:var(--text-muted);margin-left:4px">(${d.taxRate}%)</span>` : ''}</td>
    <td><div class="action-btns">
      <button class="btn-edit" data-id="${d.id}" data-action="edit-desp">Editar</button>
      <button class="btn-del" data-id="${d.id}" data-action="del-desp">Excluir</button>
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
  el('desp-pct').value   = (desp?.category === 'impostos' && desp?.taxRate) ? desp.taxRate : '';
  el('desp-valor').value = desp ? (desp.value||'') : '';
  el('desp-pct-preview').textContent = '';
  updateDespModalMode();
  openModal('modal-desp');
}

// ─────────────────────────────────────────────────────────────────────────────
// INADIMPLÊNCIA
// ─────────────────────────────────────────────────────────────────────────────
function renderInadimplencia() {
  const todayStr = today();
  const pendentes = S.data.recebimentos
    .filter(r => r.status === 'pendente' && r.date <= todayStr)
    .sort((a,b) => a.date.localeCompare(b.date));

  // Clean stale selections
  const pendIds = new Set(pendentes.map(r => r.id));
  S.inadimSelected.forEach(id => { if (!pendIds.has(id)) S.inadimSelected.delete(id); });

  const sumEl = el('inadimplencia-summary');
  if (pendentes.length) {
    const total = pendentes.reduce((s,r)=>s+(r.value||0),0);
    sumEl.classList.remove('hidden');
    sumEl.innerHTML = `<strong>${pendentes.length} pagamento${pendentes.length>1?'s':''} pendente${pendentes.length>1?'s':''}</strong><span class="inad-sep"> &nbsp;·&nbsp; </span>Total em aberto: <strong>${fmtBRL(total)}</strong>`;
  } else {
    sumEl.classList.add('hidden');
  }

  const bulkBar = el('inadim-bulk-bar');
  const tbody   = el('tbody-inadimplencia');

  if (!pendentes.length) {
    if (bulkBar) bulkBar.classList.add('hidden');
    tbody.innerHTML = '<tr><td colspan="8" class="empty-row">Nenhum pagamento pendente. 🎉</td></tr>';
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
    const contactStatus = r.contactStatus || 'none';
    const isOverduePromise = (contactStatus === 'promised' && r.promisedDate && r.promisedDate < today_) || contactStatus === 'no-response';
    const rowCls = sel ? 'row-selected' : isOverduePromise ? 'inad-overdue-promise' : '';
    const contactOpts = [['none','Sem tentativa'],['promised','Prometeu pagar'],['no-response','Sem resposta']]
      .map(([v,l]) => `<option value="${v}"${contactStatus===v?' selected':''}>${l}</option>`).join('');
    const dateInput = contactStatus === 'promised'
      ? `<input type="date" class="inad-promised-date" data-id="${r.id}" value="${r.promisedDate||''}">`
      : '';
    return `<tr class="${rowCls}">
      <td style="padding:10px 8px"><input type="checkbox" class="row-check inadim-check" data-id="${r.id}" ${sel ? 'checked' : ''}></td>
      <td>${fmtDate(r.date)}</td>
      <td>${patCell}</td>
      <td><span class="type-tag">${labels.consultationType[r.consultationType]||r.consultationType||'—'}</span></td>
      <td class="text-right value-cell">${fmtBRL(r.value||0)}</td>
      <td><span class="days-badge ${daysCls}">${dias} dia${dias!==1?'s':''}</span></td>
      <td><div class="inad-contact-wrap"><select class="inad-contact-sel" data-id="${r.id}">${contactOpts}</select>${dateInput}</div></td>
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

el('btn-nova-nota').addEventListener('click', () => openModalNota());

// auto-fill next contact date based on situation selection
document.addEventListener('change', e => {
  const sel = e.target.closest('.retorno-situacao-sel');
  if (!sel) return;
  const patId = sel.id.replace('retorno-sit-', '');
  const dateInput = el(`retorno-next-${patId}`);
  if (!dateInput) return;
  const t = today();
  if (sel.value === 'nao-quer') dateInput.value = dateAddDays(t, 30);
  else if (sel.value !== 'data-especifica') dateInput.value = dateAddDays(t, 7);
});

document.addEventListener('change', e => {
  const contactSel = e.target.closest('.inad-contact-sel');
  if (contactSel) {
    const wrap = contactSel.closest('.inad-contact-wrap');
    if (contactSel.value === 'promised') {
      if (!wrap.querySelector('.inad-promised-date')) {
        const inp = document.createElement('input');
        inp.type = 'date'; inp.className = 'inad-promised-date'; inp.dataset.id = contactSel.dataset.id;
        wrap.appendChild(inp);
      }
    } else {
      wrap.querySelector('.inad-promised-date')?.remove();
    }
  }
});

el('btn-inativacao-sort').addEventListener('click', () => {
  S.inativacaoSort = S.inativacaoSort === 'asc' ? 'desc' : 'asc';
  el('btn-inativacao-sort').textContent = S.inativacaoSort === 'asc' ? 'Mais antigos primeiro ↑' : 'Mais recentes primeiro ↓';
  renderInativacaoSugestoes();
});

// NF bulk selection
el('check-nf-all').addEventListener('change', (e) => {
  const todayNF2 = today();
  const pendNF = S.data.recebimentos.filter(r => r.invoiceStatus === 'pendente' && r.status !== 'gratuito' && r.date <= todayNF2);
  if (e.target.checked) pendNF.forEach(r => S.nfSelected.add(r.id));
  else S.nfSelected.clear();
  renderNFPendentes();
});

el('btn-nf-bulk-emit').addEventListener('click', async () => {
  if (!S.nfSelected.size) return;
  const ids   = [...S.nfSelected];
  const count = ids.length;
  showConfirm(`Marcar ${count} nota${count > 1 ? 's fiscais' : ' fiscal'} como emitida${count > 1 ? 's' : ''}?`, async () => {
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
  }, { title: 'Marcar NFs como emitidas', okLabel: 'Marcar emitidas' });
});

// Inadimplência bulk selection
el('check-inadim-all').addEventListener('change', (e) => {
  const pendentes = S.data.recebimentos.filter(r => r.status === 'pendente');
  if (e.target.checked) pendentes.forEach(r => S.inadimSelected.add(r.id));
  else S.inadimSelected.clear();
  renderInadimplencia();
});

el('btn-inadim-bulk-received').addEventListener('click', () => {
  if (!S.inadimSelected.size) return;
  const ids   = [...S.inadimSelected];
  const count = ids.length;
  showConfirm(
    `Marcar ${count} pagamento${count > 1 ? 's' : ''} como recebido${count > 1 ? 's' : ''} via PIX?`,
    async () => {
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
    }
  );
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
  const rec = S.data.recebimentos.find(r => r.id === id);
  const prevInvStatus = rec?.invoiceStatus || 'pendente';
  const prevInvNum    = rec?.invoiceNumber || '';
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
    showToast(`NF marcada como emitida${num?' — Nº '+num:''}!`, 'success', async () => {
      await updateDoc(doc(db, 'recebimentos', id), {
        invoiceStatus: prevInvStatus,
        invoiceNumber: prevInvNum,
        updatedAt: serverTimestamp()
      });
      await reloadCollection('recebimentos');
      updateBadges();
      renderView(S.view);
    });
  } catch (err) { handleErr(err); } finally { hideLoading(); }
});

function renderSecretaria() {
  S.nfTab = 'pendentes';
  renderInadimAlerta();
  renderNFPendentes();
  renderRetornoAlert();
  renderInativacaoSugestoes();
  renderNotas();
  renderAniversariantes('aniversario-banner-sec', 'aniversario-sec-text');
  renderAniversariantesMes();
}

function renderInadimAlerta() {
  const list = el('inadim-alerta-list');
  if (!list) return;
  const todayStr = today();
  const pendentes = S.data.recebimentos
    .filter(r => r.status === 'pendente' && r.date <= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date));

  setCount('badge-inadim-card', pendentes.length);

  if (!pendentes.length) {
    list.innerHTML = '<div class="empty-state">Sem inadimplências registradas. 🎉</div>';
    return;
  }

  list.innerHTML = pendentes.map(r => {
    const dias = daysBetween(r.date, todayStr);
    const daysCls = dias <= 7 ? 'days-ok' : dias <= 30 ? 'days-warning' : 'days-danger';
    const pat = r.patientId ? S.data.patients.find(p => p.id === r.patientId) : null;
    const nameHtml = r.patientId
      ? `<span class="patient-link" data-patient="${r.patientId}">${esc(r.patient||'—')}</span>`
      : `<span>${esc(r.patient||'—')}</span>`;
    const contactStatus = r.contactStatus || 'none';
    const isOverdue = (contactStatus === 'promised' && r.promisedDate && r.promisedDate < todayStr) || contactStatus === 'no-response';
    const contactOpts = [['none','Sem tentativa'],['promised','Prometeu pagar'],['no-response','Sem resposta']]
      .map(([v, l]) => `<option value="${v}"${contactStatus === v ? ' selected' : ''}>${l}</option>`).join('');
    const dateInput = contactStatus === 'promised'
      ? `<input type="date" class="inad-promised-date" data-id="${r.id}" value="${r.promisedDate||''}">`
      : '';
    return `<div class="inadim-card-item${isOverdue ? ' inadim-card-overdue' : ''}">
      <div class="inadim-card-row1">
        <div class="inadim-card-name-wrap">${nameHtml}${pat?.phone ? waBtn(pat.phone) : ''}</div>
        <div class="inadim-card-meta-right">
          <span class="days-badge ${daysCls}">${dias} dia${dias !== 1 ? 's' : ''}</span>
          <span class="inadim-card-value">${fmtBRL(r.value||0)}</span>
        </div>
      </div>
      <div class="inadim-card-row2">${fmtDate(r.date)} · ${labels.consultationType[r.consultationType]||r.consultationType||'—'}</div>
      <div class="inadim-card-row3">
        <div class="inad-contact-wrap" style="min-width:unset">
          <select class="inad-contact-sel" style="width:148px" data-id="${r.id}">${contactOpts}</select>
          ${dateInput}
        </div>
        <button class="btn btn-sm btn-outline" data-id="${r.id}" data-action="inadim-save-contact" style="white-space:nowrap">Salvar</button>
        <button class="btn-received" data-id="${r.id}" data-action="mark-received" style="font-size:.75rem;padding:4px 10px;white-space:nowrap">✓ Marcar como recebido</button>
      </div>
    </div>`;
  }).join('');
}

function renderAniversariantesMes() {
  const card = el('card-aniversario-mes');
  if (!card) return;
  const todayStr = today();
  const [year, mm, dd] = todayStr.split('-');
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const nomeMes = meses[parseInt(mm, 10) - 1];

  const lista = S.data.patients
    .filter(p => p.status === 'ativo' && p.birthDate && p.birthDate.slice(5, 7) === mm)
    .sort((a, b) => a.birthDate.slice(8, 10).localeCompare(b.birthDate.slice(8, 10)));

  if (!lista.length) { card.classList.add('hidden'); return; }

  setText('aniversario-mes-titulo', `🎂 Aniversariantes de ${nomeMes}`);

  el('aniversario-mes-list').innerHTML = lista.map(p => {
    const diaPac = p.birthDate.slice(8, 10);
    const isHoje = diaPac === dd;
    const passou = diaPac < dd;
    const diasFaltam = isHoje ? 0 : parseInt(diaPac, 10) - parseInt(dd, 10);
    const tag = isHoje ? 'hoje!' : passou ? 'passou' : `em ${diasFaltam}d`;
    const cls = isHoje ? 'hoje' : passou ? 'passou' : '';
    return `<div class="aniversario-mes-item ${cls}">
      <span class="aniversario-mes-dia">${diaPac}/${mm}</span>
      <span class="patient-link" data-patient="${p.id}" style="cursor:pointer">${esc(p.name)}</span>
      ${p.phone ? waBtn(p.phone) : ''}
      <span style="font-size:.72rem;color:var(--text-muted)">${tag}</span>
    </div>`;
  }).join('');

  card.classList.remove('hidden');
}

function calcAniversariantes() {
  const todayStr = today();
  const [, mm, dd] = todayStr.split('-');
  return S.data.patients.filter(p =>
    p.status === 'ativo' && p.birthDate &&
    p.birthDate.slice(5, 7) === mm &&
    p.birthDate.slice(8, 10) === dd
  );
}

function renderAniversariantes(bannerId, textId) {
  const banner = el(bannerId);
  if (!banner) return;
  const lista = calcAniversariantes();
  if (!lista.length) { banner.classList.add('hidden'); return; }
  const nomes = lista.map(p => `<a href="#" class="alert-link patient-link" data-patient="${p.id}">${esc(p.name)}</a>`).join(', ');
  const txt = lista.length === 1
    ? `Aniversário hoje: ${nomes}`
    : `${lista.length} aniversariantes hoje: ${nomes}`;
  el(textId).innerHTML = txt;
  banner.classList.remove('hidden');
}

function calcRetornoPatients() {
  const todayStr = today();
  const completedStatuses = new Set(['cp', 'at', 'co']);

  const patLastConsult = {};
  S.data.consultations.forEach(c => {
    if (!c.patientId || !c.date || c.date > todayStr) return;
    if (!completedStatuses.has(c.status)) return;
    if (!patLastConsult[c.patientId] || c.date > patLastConsult[c.patientId])
      patLastConsult[c.patientId] = c.date;
  });

  const hasFuture = new Set();
  S.data.consultations.forEach(c => {
    if (c.patientId && c.date >= todayStr) hasFuture.add(c.patientId);
  });

  const cutoff = new Date(todayStr);
  cutoff.setDate(cutoff.getDate() - 20);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const mapPatient = (pac, lastDate) => {
    const days     = lastDate ? daysBetween(lastDate, todayStr) : null;
    const fu       = pac.retornoFollowUp || null;
    const validFu  = fu && (lastDate ? fu.lastContactDate >= lastDate : fu.lastContactDate) ? fu : null;
    const attempts = validFu ? (validFu.attempts || 0) : 0;
    const nextDate = validFu ? validFu.nextContactDate : null;
    const needsContact = !nextDate || nextDate <= todayStr;
    return {
      patId:           pac.id,
      name:            pac.name || '—',
      phone:           pac.phone || pac.phone2 || '',
      lastDate, days, attempts, needsContact,
      nextContact:     nextDate,
      lastNote:        validFu?.lastContactNote || '',
      lastSituation:   validFu?.lastContactSituation || '',
      lastContactDate: validFu?.lastContactDate || null,
      noConsult:       !lastDate,
    };
  };

  const withConsult = Object.entries(patLastConsult)
    .filter(([patId, lastDate]) => {
      if (lastDate > cutoffStr || hasFuture.has(patId)) return false;
      const pac = S.data.patients.find(p => p.id === patId);
      return pac && pac.status === 'ativo';
    })
    .map(([patId, lastDate]) => mapPatient(S.data.patients.find(p => p.id === patId), lastDate));

  const withConsultIds = new Set(Object.keys(patLastConsult));
  const noConsult = S.data.patients
    .filter(p => p.status === 'ativo' && !withConsultIds.has(p.id) && !hasFuture.has(p.id))
    .map(pac => mapPatient(pac, null));

  return [...withConsult, ...noConsult];
}

function renderRetornoAlert() {
  const container = el('retorno-list');
  if (!container) return;
  const todayStr = today();

  const todos = calcRetornoPatients();
  const sortFn = (() => {
    if (S.retornoSort === 'asc')  return (a, b) => (a.lastDate || '').localeCompare(b.lastDate || '');
    if (S.retornoSort === 'desc') return (a, b) => (b.lastDate || '').localeCompare(a.lastDate || '');
    return (a, b) => (b.attempts - a.attempts) || (a.lastDate || '').localeCompare(b.lastDate || '');
  })();
  const urgentes   = todos.filter(p =>  p.needsContact).sort(sortFn);
  const aguardando = todos.filter(p => !p.needsContact).sort(
    S.retornoSort === 'urgencia'
      ? (a, b) => (a.nextContact || '').localeCompare(b.nextContact || '')
      : sortFn
  );

  const pill = el('retorno-count-pill');
  if (pill) pill.textContent = todos.length;
  const badge = el('badge-retorno');
  if (badge) { badge.textContent = urgentes.length || ''; badge.classList.toggle('hidden', urgentes.length === 0); }
  const inadimContactar = S.data.recebimentos.filter(r => {
    if (r.status !== 'pendente' || r.date > todayStr) return false;
    const cs = r.contactStatus || 'none';
    return cs === 'none' || cs === 'no-response' || (cs === 'promised' && r.promisedDate && r.promisedDate <= todayStr);
  }).length;
  const banner = el('retorno-banner');
  if (banner) {
    const total = urgentes.length + inadimContactar;
    if (total) {
      const parts = [];
      if (urgentes.length) parts.push(`${urgentes.length} sem retorno agendado`);
      if (inadimContactar) parts.push(`${inadimContactar} inadimplente${inadimContactar > 1 ? 's' : ''}`);
      el('retorno-banner-text').textContent = `${total} paciente${total > 1 ? 's' : ''} para contatar hoje — ${parts.join(' e ')}.`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  if (!todos.length) {
    container.innerHTML = '<div class="empty-state">Nenhum paciente sem retorno agendado.</div>';
    return;
  }

  const retornoItemHTML = (p, mode) => {
    const exhausted    = p.attempts >= 5;
    const attemptLabel = p.attempts > 0
      ? `<span class="retorno-attempts-badge${exhausted ? ' retorno-attempts-exhausted' : ''}">${p.attempts}ª tentativa</span>`
      : '';
    const contextLine  = mode === 'waiting' && p.lastNote
      ? `<div class="retorno-item-note">"${esc(p.lastNote)}"</div>`
      : '';
    const nextLine     = mode === 'waiting' && p.nextContact
      ? `<div class="retorno-item-meta">Próximo contato: ${fmtDate(p.nextContact)}${p.days ? ` · ${p.days} dias sem retorno` : ''}</div>`
      : p.lastDate
        ? `<div class="retorno-item-meta">Última consulta: ${fmtDate(p.lastDate)} · ${p.days} dias sem retorno</div>`
        : `<div class="retorno-item-meta" style="color:var(--amber,#d97706)">Sem consultas registradas no sistema</div>`;
    const inativBlock  = exhausted ? `
      <div class="retorno-inativ-suggest" id="retorno-inativ-${p.patId}">
        <span class="retorno-inativ-label">⚠️ 5 tentativas sem retorno — considerar inativação</span>
        <div class="retorno-inativ-actions hidden" id="retorno-inativ-actions-${p.patId}">
          <select class="inativacao-status-sel" id="retorno-inativ-sel-${p.patId}">
            <option value="alta">Alta — tratamento concluído</option>
            <option value="inativo">Inativo — abandono/sem retorno</option>
          </select>
          <div style="display:flex;gap:6px;margin-top:6px">
            <button class="btn btn-sm btn-danger" data-action="retorno-inativ-confirm" data-id="${p.patId}">Confirmar</button>
            <button class="btn btn-sm btn-outline" data-action="retorno-inativ-cancel" data-id="${p.patId}">Cancelar</button>
          </div>
        </div>
        <button class="btn btn-sm btn-outline" style="margin-top:6px" data-action="retorno-inativ-open" data-id="${p.patId}">Inativar paciente</button>
      </div>` : '';
    const defaultNext  = dateAddDays(todayStr, 7);
    const formBlock    = `
      <div class="retorno-contact-form hidden" id="retorno-form-${p.patId}">
        <select class="retorno-situacao-sel" id="retorno-sit-${p.patId}">
          <option value="sem-resposta">Não respondeu</option>
          <option value="vai-marcar">Disse que vai marcar</option>
          <option value="data-especifica">Pediu para contatar em data específica</option>
          <option value="nao-quer">Não quer marcar agora</option>
        </select>
        <div class="retorno-form-row">
          <label>Próximo contato</label>
          <input type="date" id="retorno-next-${p.patId}" value="${defaultNext}">
        </div>
        <input type="text" class="retorno-nota-input" id="retorno-nota-${p.patId}" placeholder="Nota rápida (opcional)">
        <div class="retorno-form-btns">
          <button class="btn btn-sm btn-primary" data-action="retorno-save" data-id="${p.patId}" data-attempts="${p.attempts}">Salvar</button>
          <button class="btn btn-sm btn-outline" data-action="retorno-form-cancel" data-id="${p.patId}">Cancelar</button>
        </div>
      </div>`;
    return `
    <div class="retorno-item ${mode === 'urgent' ? 'retorno-item-urgent' : mode === 'waiting' ? 'retorno-item-waiting' : ''}" id="retorno-row-${p.patId}">
      <div class="retorno-item-top">
        ${attemptLabel}
        <span class="patient-link retorno-item-name" data-patient="${p.patId}">${esc(p.name)}</span>
      </div>
      ${nextLine}
      ${p.phone ? `<div class="retorno-item-phone" style="display:flex;align-items:center;gap:6px">${esc(p.phone)}${waBtn(p.phone)}</div>` : ''}
      ${contextLine}
      ${inativBlock}
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
        <button class="btn btn-sm btn-outline" data-action="retorno-form-open" data-id="${p.patId}">Registrar contato</button>
        ${mode === 'waiting' ? `<button class="btn btn-sm btn-outline" style="color:var(--text-muted)" data-action="retorno-undo" data-id="${p.patId}">Desfazer contato</button>` : ''}
      </div>
      ${formBlock}
    </div>`;
  };

  let html = '';
  if (urgentes.length) {
    html += `<div class="retorno-section-hdr retorno-section-urgent">📩 Para contatar hoje (${urgentes.length})</div>`;
    html += urgentes.map(p => retornoItemHTML(p, 'urgent')).join('');
  }
  if (aguardando.length) {
    html += `<div class="retorno-section-hdr retorno-section-waiting">⏳ Aguardando resposta (${aguardando.length})</div>`;
    html += aguardando.map(p => retornoItemHTML(p, 'waiting')).join('');
  }
  container.innerHTML = html;
}

async function saveRetornoContact(patId, situation, nextDate, note, currentAttempts) {
  const pac = S.data.patients.find(p => p.id === patId);
  if (!pac) return;
  showLoading();
  try {
    const fu = {
      nextContactDate:      nextDate || dateAddDays(today(), 7),
      lastContactDate:      today(),
      lastContactNote:      note || '',
      lastContactSituation: situation || 'sem-resposta',
      attempts:             currentAttempts + 1,
    };
    await updateDoc(doc(db, 'patients', patId), { retornoFollowUp: fu, updatedAt: serverTimestamp() });
    pac.retornoFollowUp = fu;
    renderRetornoAlert();
    showToast('Contato registrado.', 'success');
  } catch (err) { handleErr(err); } finally { hideLoading(); }
}

function renderInativacaoSugestoes() {
  const container = el('inativacao-list');
  if (!container) return;
  const todayStr = today();
  const lista = calcInativacaoSugestoes()
    .sort((a, b) => S.inativacaoSort === 'asc'
      ? (a.lastDate || '').localeCompare(b.lastDate || '')
      : (b.lastDate || '').localeCompare(a.lastDate || ''));
  const pill = el('inativacao-count-pill');
  if (pill) pill.textContent = lista.length;
  setCount('badge-inativacao', lista.length);
  if (!lista.length) {
    container.innerHTML = '<div class="empty-state">Nenhum paciente para revisão de longa ausência.</div>';
    return;
  }
  container.innerHTML = lista.map(p => {
    const diasRef = (!p.neverAttended)
      ? (p.manterAtivoDesde && p.manterAtivoDesde > p.lastDate
        ? daysBetween(p.manterAtivoDesde, todayStr)
        : daysBetween(p.lastDate, todayStr))
      : 0;
    const metaText = p.neverAttended
      ? 'Nunca atendido'
      : `Última consulta: ${fmtDate(p.lastDate)} · ${diasRef} dias sem retorno`;
    const mantidoInfo = p.manterAtivoDesde
      ? `<div class="inativacao-item-meta" style="color:var(--text-muted)">Renovado em: ${fmtDate(p.manterAtivoDesde)}</div>`
      : '';
    return `
    <div class="inativacao-item" id="inativ-row-${p.patId}">
      <div class="inativacao-item-info">
        <div class="inativacao-item-name">
          <span class="patient-link" data-patient="${p.patId}">${esc(p.name)}</span>
        </div>
        <div class="inativacao-item-meta">${metaText}</div>
        ${mantidoInfo}
      </div>
      <div class="inativacao-item-actions">
        <button class="btn btn-sm btn-outline" data-action="inativ-suggest" data-id="${p.patId}">Revisar</button>
      </div>
      <div class="inativacao-confirm hidden">
        <select class="inativacao-status-sel" id="inativ-sel-${p.patId}">
          <option value="alta">Alta — tratamento concluído</option>
          <option value="inativo">Inativo — abandono/sem retorno</option>
        </select>
        <div class="inativacao-confirm-actions">
          <button class="btn btn-sm btn-danger" data-action="inativ-confirm" data-id="${p.patId}">Confirmar</button>
          <button class="btn btn-sm btn-outline" data-action="inativ-manter" data-id="${p.patId}">Manter ativo (+180 dias)</button>
          <button class="btn btn-sm btn-outline" data-action="inativ-cancel" data-id="${p.patId}">Cancelar</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function renderNFPendentes() {
  const todayNF = today();
  const pendNF = S.data.recebimentos
    .filter(r => r.invoiceStatus === 'pendente' && r.status !== 'gratuito' && r.date <= todayNF)
    .sort((a,b) => a.date.localeCompare(b.date));

  el('nf-count-pill').textContent = pendNF.length;

  const toolbar = el('nf-bulk-toolbar');
  const nfList  = el('nf-list');

  document.querySelectorAll('.nf-tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.nfTab === S.nfTab));

  if (S.nfTab === 'emitidas') {
    toolbar.classList.add('hidden');
    const emitidas = S.data.recebimentos
      .filter(r => r.invoiceStatus === 'emitida')
      .sort((a,b) => b.date.localeCompare(a.date));

    if (!emitidas.length) {
      nfList.innerHTML = '<div class="empty-state">Nenhuma NF emitida registrada.</div>';
      return;
    }
    nfList.innerHTML = emitidas.map(r => {
      const nameHtml = r.patientId ? `<span class="patient-link" data-patient="${r.patientId}">${esc(r.patient||'—')}</span>` : esc(r.patient||'—');
      return `<div class="nf-item">
        <div class="nf-item-left">
          <div class="nf-item-name">${nameHtml}</div>
          <div class="nf-item-meta">${fmtDate(r.date)} · ${labels.consultationType[r.consultationType]||r.consultationType||'—'}${r.invoiceNumber ? ` · NF ${esc(r.invoiceNumber)}` : ''}</div>
        </div>
        <div class="nf-item-value">${fmtBRL(r.value||0)}</div>
      </div>`;
    }).join('');
    return;
  }

  // Aba pendentes
  const pendIds = new Set(pendNF.map(r => r.id));
  S.nfSelected.forEach(id => { if (!pendIds.has(id)) S.nfSelected.delete(id); });

  if (!pendNF.length) {
    toolbar.classList.add('hidden');
    nfList.innerHTML = '<div class="empty-state">Nenhuma NF pendente de emissão.</div>';
    return;
  }
  toolbar.classList.remove('hidden');
  updateNFToolbar();

  nfList.innerHTML = pendNF.map(r => {
    const sel = S.nfSelected.has(r.id);
    const nameHtml = r.patientId ? `<span class="patient-link" data-patient="${r.patientId}">${esc(r.patient||'—')}</span>` : esc(r.patient||'—');
    return `<div class="nf-item${sel ? ' nf-selected' : ''}">
      <label class="nf-item-check" onclick="event.stopPropagation()">
        <input type="checkbox" class="row-check nf-check" data-id="${r.id}" ${sel ? 'checked' : ''}>
      </label>
      <div class="nf-item-left">
        <div class="nf-item-name">${nameHtml}</div>
        <div class="nf-item-meta">${fmtDate(r.date)} · ${labels.consultationType[r.consultationType]||r.consultationType||'—'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <div class="nf-item-value">${fmtBRL(r.value||0)}</div>
        <button class="btn btn-sm btn-primary" data-id="${r.id}" data-action="mark-nf" style="font-size:.75rem;padding:4px 10px">✓ Marcar emitida</button>
      </div>
    </div>`;
  }).join('');
}

function updateNFToolbar() {
  const pendNF   = S.data.recebimentos.filter(r => r.invoiceStatus === 'pendente' && r.status !== 'gratuito' && r.date <= today());
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
        <span>${n.createdAt ? fmtTimestamp(n.createdAt) : ''}${n.createdByEmail ? ` · ${n.createdByEmail.split('@')[0]}` : ''}</span>
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
function drePeriodLabel() {
  const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const mesesAbr = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const { preset, start, end } = S.filter;
  if (!start) return 'Demonstrativo de Resultado';
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  if (preset === 'mes' || preset === 'mespassado' || preset === 'proximomes') {
    return `${meses[sm-1]} ${sy}`;
  }
  if (preset === 'ano') return String(sy);
  if (preset === '3meses' || preset === '6meses') {
    return sy === ey
      ? `${mesesAbr[sm-1]} → ${mesesAbr[em-1]} ${ey}`
      : `${mesesAbr[sm-1]} ${sy} → ${mesesAbr[em-1]} ${ey}`;
  }
  return `${fmtDate(start)} → ${fmtDate(end)}`;
}

function renderDRE() {
  const recs  = filteredRec();
  const desps = filteredDesp();
  setText('dre-title', `DRE — ${drePeriodLabel()}`);

  const recByType = { presencial:0, teleconsulta:0 };
  recs.filter(r=>r.status!=='gratuito').forEach(r => {
    const t = r.consultationType || 'presencial';
    recByType[t] = (recByType[t]||0) + (r.value||0);
  });
  const totalRec     = Object.values(recByType).reduce((s,v)=>s+v,0);
  const recPix       = recs.filter(r=>r.status==='pix').reduce((s,r)=>s+(r.value||0),0);
  const recPendente  = recs.filter(r=>r.status==='pendente').reduce((s,r)=>s+(r.value||0),0);
  const countGrat    = recs.filter(r=>r.status==='gratuito').length;

  const catOrder  = ['aluguel','iclinic','secretaria','contador','material','consumo','impostos','outros'];
  const despByCat = Object.fromEntries(catOrder.map(c=>[c,0]));
  desps.forEach(d => { despByCat[d.category] = (despByCat[d.category]||0)+resolvedValue(d); });
  const totalDesp = Object.values(despByCat).reduce((s,v)=>s+v,0);

  const resultado = totalRec - totalDesp;
  const margem    = totalRec > 0 ? (resultado/totalRec*100) : 0;
  const paid      = recs.filter(r=>r.status==='pix');
  const ticket    = paid.length > 0 ? paid.reduce((s,r)=>s+(r.value||0),0)/paid.length : 0;
  const pct       = v => totalRec > 0 ? (v/totalRec*100).toFixed(1)+'%' : '—';

  const rows = [
    ['section','RECEITAS'],
    ['subsection','Por Modalidade'],
    ['item','Presencial',     recByType.presencial,   pct(recByType.presencial)],
    ['item','Teleconsulta',   recByType.teleconsulta, pct(recByType.teleconsulta)],
    ['subtotal','Total Receita Bruta', totalRec, '100%'],
    ['spacer'],
    ['subsection','Por Status de Pagamento'],
    ['item','Recebido (PIX)',      recPix,     pct(recPix)],
    ['item','A Receber (Pendente)', recPendente, pct(recPendente)],
    ['item', `Gratuito (${countGrat} consulta${countGrat!==1?'s':''})`, 0, '—'],
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
    ['item','Atendimentos Gratuitos', countGrat+' consultas',''],
  ];

  el('tbody-dre').innerHTML = rows.map(row => {
    if (row[0]==='section')    return `<tr class="dre-section-header"><td colspan="3">${row[1]}</td></tr>`;
    if (row[0]==='subsection') return `<tr><td colspan="3" style="padding:6px 16px 2px;font-size:.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">${row[1]}</td></tr>`;
    if (row[0]==='spacer')     return `<tr><td colspan="3" style="padding:5px"></td></tr>`;
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
    options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom',labels:{font:{family:'Plus Jakarta Sans',size:10},boxWidth:10,padding:8}},tooltip:{callbacks:{label:ctx=>' '+fmtBRL(ctx.parsed)}}} },
  });

  const ctxDC = el('chart-desp-cat').getContext('2d');
  if (S.charts.despCat) S.charts.despCat.destroy();
  S.charts.despCat = new Chart(ctxDC, {
    type: 'doughnut',
    data: { labels:catOrder.map(c=>labels.expenseCategory[c]), datasets:[{data:catOrder.map(c=>despByCat[c]||0),backgroundColor:['#e07b54','#5ba88a','#7b6ec0','#c0aa3d','#3d88c0','#4db8b8','#c03d5a','#9a9a9a'],borderWidth:2,borderColor:'#fff'}] },
    options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom',labels:{font:{family:'Plus Jakarta Sans',size:10},boxWidth:10,padding:8}}} },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ── RESET COMPLETO ────────────────────────────────────────────────────────────
el('btn-reset-all').addEventListener('click', async () => {
  const phrase = 'APAGAR TUDO';
  const typed  = window.prompt(`Esta ação é irreversível.\n\nDigite exatamente: ${phrase}`);
  if (typed !== phrase) { showToast('Cancelado.', 'info'); return; }
  showConfirm('Última confirmação: apagar TODOS os dados permanentemente?', async () => {
  el('btn-reset-all').disabled = true;
  el('btn-reset-all').textContent = 'Apagando…';

  try {
    const cols = ['recebimentos', 'despesas', 'notas', 'patients', 'consultations'];
    let total = 0;

    for (const col of cols) {
      const snap = await getDocs(collection(db, col));
      // Firestore batch limit = 500
      const ids = snap.docs.map(d => d.id);
      for (let i = 0; i < ids.length; i += 490) {
        const b = writeBatch(db);
        ids.slice(i, i + 490).forEach(id => b.delete(doc(db, col, id)));
        await b.commit();
        total += Math.min(490, ids.length - i);
      }
    }

    // Reset local state
    S.data = { recebimentos: [], despesas: [], notas: [], patients: [], consultations: [] };
    renderView(S.view);
    updateBadges();

    const res = el('reset-result');
    res.className = 'import-result success';
    res.innerHTML = `<strong>✓ ${total} registros apagados.</strong> O sistema está limpo — pode importar os dados do zero.`;
    res.classList.remove('hidden');
    showToast('Todos os dados foram apagados.', 'success');
  } catch (err) {
    handleErr(err);
  } finally {
    el('btn-reset-all').disabled = false;
    el('btn-reset-all').textContent = 'Apagar todos os dados';
  }
  });
});

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
  S.importFiles = { patient: null, event: null };
  const detected = [];
  for (const file of files) {
    const reader = new FileReader();
    reader.onload = e => {
      const text   = e.target.result;
      const header = text.split('\n')[0] || '';
      const type   = detectCSVType(header, file.name);
      if ((type === 'patient' || type === 'event') && !S.importFiles[type]) {
        S.importFiles[type] = { file, text };
        detected.push({ name: file.name, type });
      } else {
        detected.push({ name: file.name, type });
      }
      if (detected.length === files.length) renderFilesPreview(detected);
    };
    reader.readAsText(file, 'UTF-8');
  }
}

function detectCSVType(header, filename) {
  const patPat = /^\d{2}-\d{2}-\d{4}-patient\.csv$/i;
  const evtPat = /^\d{2}-\d{2}-\d{4}-event_scheduling\.csv$/i;
  if (!patPat.test(filename) && !evtPat.test(filename)) return 'invalid-name';
  if (patPat.test(filename) && header.includes('patient_id') && header.includes('birthdate')) return 'patient';
  if (evtPat.test(filename) && header.includes('procedure_pack') && header.includes('schedule_id')) return 'event';
  return 'invalid-content';
}

function renderFilesPreview(detected) {
  const preview    = el('import-files-preview');
  const icons      = { patient:'👤', event:'📅', 'invalid-name':'⛔', 'invalid-content':'⚠️' };
  const typeLabels = {
    patient:          'Pacientes',
    event:            'Agendamentos',
    'invalid-name':   'Nome inválido — use DD-MM-YYYY-patient.csv ou DD-MM-YYYY-event_scheduling.csv',
    'invalid-content':'Conteúdo não reconhecido',
  };
  const hasInvalid = detected.some(f => f.type === 'invalid-name' || f.type === 'invalid-content' || !f.type);
  preview.innerHTML = detected.map(f => `
    <div class="import-file-row">
      <span class="import-file-icon">${icons[f.type]||'📄'}</span>
      <span class="import-file-name">${esc(f.name)}</span>
      <span class="import-file-type ${(f.type==='patient'||f.type==='event')?'detected':'unknown'}">${typeLabels[f.type]||'Não reconhecido'}</span>
    </div>`).join('');
  preview.classList.remove('hidden');
  el('import-actions-bar').classList.remove('hidden');
  el('btn-run-import').disabled = hasInvalid;
  el('import-result').classList.add('hidden');
}

function resetImport() {
  S.importFiles = { patient: null, event: null };
  csvInput.value = '';
  el('import-files-preview').classList.add('hidden');
  el('import-actions-bar').classList.add('hidden');
  el('import-progress').classList.add('hidden');
  el('import-result').classList.add('hidden');
}

async function runImport() {
  const { patient: patFile, event: evtFile } = S.importFiles;
  if (!patFile && !evtFile) { showToast('Nenhum arquivo válido selecionado.', 'error'); return; }

  S.importing = true;
  let importSucceeded = false;
  el('import-actions-bar').classList.add('hidden');
  el('import-progress').classList.remove('hidden');
  setProgress(0, 'Iniciando…');

  const results = { patientsAdded:0, patientsUpdated:0, patientsNoChange:0, patientsProtected:0, eventsAdded:0, eventsUpdated:0, eventsNoChange:0, eventsIgnored:0, recAdded:0, recSkipped:0, recRescheduled:0, unmatched:[], errors:0 };

  try {
    // ── 1. Pre-parse files + build iClinic name map ───────────────────────────
    let eventRows = [];
    if (evtFile) {
      eventRows = parseCSV(evtFile.text);
    }
    const icIdToIclinicName = {};
    if (patFile) {
      parseCSV(patFile.text).forEach(r => {
        if (r.patient_id && r.name) icIdToIclinicName[r.patient_id] = capitalizeName((r.name || '').trim());
      });
    }
    setProgress(5, 'Arquivos lidos…');

    // ── 2. Upsert patients — respeita dados curados manualmente ───────────────
    if (patFile) {
      const rows = parseCSV(patFile.text);
      const existingMap = {};
      S.data.patients.forEach(p => { if (p.iclinicPatientId) existingMap[p.iclinicPatientId] = p; });

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

        const existing = existingMap[icId];
        if (existing) {
          if (existing.manuallyEdited) {
            // Curado manualmente: só atualiza IDs de vínculo — preserva todos os dados corrigidos
            await updateDoc(doc(db, 'patients', existing.id), {
              iclinicPatientId: icId,
              iclinicPk:        r.pk || '',
              updatedAt:        serverTimestamp(),
            });
            results.patientsProtected++;
          } else {
            const compareFields = ['name','phone','phone2','email','cpf','gender','birthDate','status','notes','indication','iclinicPk'];
            const changed = compareFields.some(f => (data[f] ?? '') !== (existing[f] ?? ''));
            if (changed) {
              // updateDoc não apaga campos ausentes, então ativoDesde é preservado automaticamente
              await updateDoc(doc(db, 'patients', existing.id), { ...data, updatedAt: serverTimestamp() });
              results.patientsUpdated++;
            } else {
              results.patientsNoChange++;
            }
          }
        } else {
          await addDoc(collection(db, 'patients'), { ...data, createdAt: serverTimestamp(), createdBy: S.user.uid });
          results.patientsAdded++;
        }
        i++;
        if (i % 10 === 0) setProgress(5 + Math.round(i/rows.length*45), `Pacientes: ${i}/${rows.length}…`);
      }
    }
    await reloadCollection('patients');
    setProgress(50, 'Pacientes importados…');

    // ── 3. Build patient id maps ───────────────────────────────────────────────
    const icIdToDocId = {};
    const icIdToName  = {};
    S.data.patients.forEach(p => {
      if (p.iclinicPatientId) {
        icIdToDocId[p.iclinicPatientId] = p.id;
        icIdToName[p.iclinicPatientId]  = p.name;
      }
    });

    // ── 4. Upsert consultations (calendário) ───────────────────────────────────
    if (evtFile && eventRows.length) {
      const existingConsult = {};
      S.data.consultations.forEach(c => { if (c.iclinicEventId) existingConsult[c.iclinicEventId] = c; });

      let i = 0;
      for (const r of eventRows) {
        const eventId = r.pk;
        if (!eventId) { i++; continue; }

        const icPatId  = r.patient_id || '';
        const patDocId = icIdToDocId[icPatId] || null;
        const patName  = icIdToName[icPatId]  || '';
        const date     = parseBRDate(r.date || '') || '';
        if (!date || date < '2025-09-01') { results.eventsIgnored++; i++; continue; }

        const status    = (r.status || '').toLowerCase().trim();
        const startTime = (r.start_time || '').substring(0, 5);
        const endTime   = (r.end_time   || '').substring(0, 5);
        const { value, isTele } = extractEventData(r.description, r.procedure_pack);
        const consType = isTele ? 'teleconsulta' : 'presencial';

        const consultData = {
          date,
          iclinicPatientId: icPatId,
          iclinicEventId:   eventId,
          status,
          startTime,
          endTime,
          value,
          consultationType: consType,
          notes:            r.description || '',
        };

        if (existingConsult[eventId]) {
          const ex = existingConsult[eventId];
          const patUpdate = ex.patientId ? {} : { patientId: patDocId, patientName: patName };
          const compareFields = ['date','status','startTime','endTime','consultationType','notes'];
          const changed = Object.keys(patUpdate).length > 0 || compareFields.some(f => (consultData[f] ?? '') !== (ex[f] ?? ''));
          if (changed) {
            await updateDoc(doc(db, 'consultations', ex.id), { ...consultData, ...patUpdate, updatedAt: serverTimestamp() });
            results.eventsUpdated++;
          } else {
            results.eventsNoChange++;
          }
        } else {
          await addDoc(collection(db, 'consultations'), { ...consultData, patientId: patDocId, patientName: patName, createdAt: serverTimestamp() });
          results.eventsAdded++;
        }

        i++;
        if (i % 20 === 0) setProgress(50 + Math.round(i/eventRows.length*48), `Agendamentos: ${i}/${eventRows.length}…`);
      }
    }

    await reloadCollection('consultations');

    // ── 5. Create pending recebimentos for future events ──────────────────────
    if (evtFile && eventRows.length) {
      const todayStr = today();
      const existingByEventId = {};
      const existingByPatDate = {};
      S.data.recebimentos.forEach(r => {
        if (r.iclinicEventId) existingByEventId[r.iclinicEventId] = r;
        if (r.patientId && r.date) existingByPatDate[`${r.patientId}_${r.date}`] = true;
      });

      for (const r of eventRows) {
        const eventId = r.pk;
        if (!eventId) continue;
        const date = parseBRDate(r.date || '') || '';
        if (!date || date < todayStr) continue;

        const icPatId  = r.patient_id || '';
        const patDocId = icIdToDocId[icPatId] || null;
        if (!patDocId) {
          // Sem patient_id = bloqueio de agenda (slot vazio, aula, etc.) — ignorar silenciosamente
          // Com patient_id mas sem match = divergência real — reportar para revisão
          if (icPatId) {
            const icName = icIdToIclinicName[icPatId] || icPatId;
            results.unmatched.push({ date, name: icName, desc: (r.description || '').substring(0, 70) });
          }
          continue;
        }

        const existingRec = existingByEventId[eventId];
        if (existingRec) {
          if (existingRec.date !== date && existingRec.status === 'pendente') {
            await updateDoc(doc(db, 'recebimentos', existingRec.id), { date, updatedAt: serverTimestamp() });
            existingByPatDate[`${patDocId}_${date}`] = true;
            results.recRescheduled++;
          } else {
            results.recSkipped++;
          }
          continue;
        }

        if (existingByPatDate[`${patDocId}_${date}`]) {
          results.recSkipped++; continue;
        }

        const desc = r.description || '';
        const valMatch = desc.match(/R\$\s*([\d.,]+)/i);
        const value = valMatch ? parseBRNumber(valMatch[1]) : 0;
        const isPago = /\bPAGO\b/i.test(desc);
        const isTele = /online|teleconsult/i.test(desc.toLowerCase());

        await addDoc(collection(db, 'recebimentos'), {
          patientId:        patDocId,
          patient:          icIdToName[icPatId] || '',
          date,
          value,
          status:           isPago ? 'pix' : 'pendente',
          invoiceStatus:    'pendente',
          consultationType: isTele ? 'teleconsulta' : 'presencial',
          iclinicEventId:   eventId,
          createdAt:        serverTimestamp(),
          createdBy:        'iclinic-import',
        });

        existingByEventId[eventId] = true;
        existingByPatDate[`${patDocId}_${date}`] = true;
        results.recAdded++;
      }
      await reloadCollection('recebimentos');
    }

    updateBadges();
    setProgress(100, 'Concluído!');

    // Gravar registro da última importação (falha silenciosamente se sem permissão)
    try {
      await setDoc(doc(db, 'metadata', 'lastImport'), {
        timestamp:           serverTimestamp(),
        userEmail:           S.user.email,
        patientsAdded:       results.patientsAdded,
        patientsUpdated:     results.patientsUpdated,
        patientsNoChange:    results.patientsNoChange,
        patientsProtected:   results.patientsProtected,
        eventsAdded:         results.eventsAdded,
        eventsUpdated:       results.eventsUpdated,
        eventsNoChange:      results.eventsNoChange,
        recAdded:            results.recAdded,
        recRescheduled:      results.recRescheduled,
        recSkipped:          results.recSkipped,
      });
    } catch (_) { /* permissão negada para metadata — não interrompe */ }

    const res = el('import-result');
    res.className = 'import-result success';
    res.innerHTML = `
      <strong>✓ Importação concluída!</strong><br><br>
      👤 Pacientes: <strong>${results.patientsAdded} adicionados</strong>${results.patientsUpdated ? ` · ${results.patientsUpdated} atualizados` : ''} · ${results.patientsNoChange} sem novidades${results.patientsProtected ? ` · ${results.patientsProtected} com dados protegidos` : ''}<br>
      📅 Agendamentos (calendário): <strong>${results.eventsAdded} adicionados</strong>${results.eventsUpdated ? ` · ${results.eventsUpdated} atualizados` : ''} · ${results.eventsNoChange} sem novidades${results.eventsIgnored ? ` · ${results.eventsIgnored} ignorados (anteriores a set/2025)` : ''}<br>
      ${results.recAdded || results.recSkipped || results.recRescheduled ? `💳 Consultas: <strong>${results.recAdded} criadas</strong>${results.recRescheduled ? ` · <strong>${results.recRescheduled} remarcada${results.recRescheduled > 1 ? 's' : ''}</strong>` : ''}${results.recSkipped ? ` · ${results.recSkipped} já existentes` : ''}<br>` : ''}
      ${results.unmatched.length ? `<br>⚠ ${results.unmatched.length} consulta${results.unmatched.length > 1 ? 's futuras' : ' futura'} sem paciente vinculado — revisão manual:<br><span style="font-size:.78rem;color:var(--text-muted)">${results.unmatched.map(e => `&nbsp;&nbsp;· ${fmtDate(e.date)} — ${esc(e.name)}: ${esc(e.desc)}`).join('<br>')}</span><br>` : ''}
      ${results.errors ? `<br>⚠ ${results.errors} linha${results.errors > 1 ? 's' : ''} ignorada${results.errors > 1 ? 's' : ''}.` : ''}
      <br><br>Dados disponíveis em <strong>Pacientes</strong>, <strong>Agenda</strong> e <strong>Consultas</strong>.
    `;
    res.classList.remove('hidden');
    el('import-progress').classList.add('hidden');
    importSucceeded = true;
    S.importResultActive = true;
    showToast('Importação concluída!', 'success');
    renderImportTab();
  } catch (err) {
    handleErr(err);
    setProgress(0, '');
    el('import-progress').classList.add('hidden');
    el('import-actions-bar').classList.remove('hidden');
  } finally {
    S.importing = false;
    updateBadges();
    if (!importSucceeded) renderView(S.view);
  }
}

function setProgress(pct, label) {
  el('import-progress-fill').style.width = pct + '%';
  el('import-progress-label').textContent = label;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTAÇÃO ÚNICA — PLANILHA DE PAGAMENTOS
// ─────────────────────────────────────────────────────────────────────────────
el('payment-csv-input').addEventListener('change', () => {
  const f = el('payment-csv-input').files[0];
  if (!f) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      S.paymentImportRows = parsePaymentCSV(e.target.result);
      renderPaymentImportReview();
    } catch (err) {
      showToast('Erro ao processar arquivo: ' + (err.message || 'verifique o formato.'), 'error');
    }
  };
  reader.readAsText(f, 'UTF-8');
});

el('btn-cancel-payment-import').addEventListener('click', resetPaymentImport);
el('btn-confirm-payment-import').addEventListener('click', confirmPaymentImport);

function resetPaymentImport() {
  S.paymentImportRows = null;
  el('payment-csv-input').value = '';
  const reviewEl = el('payment-import-review');
  reviewEl.classList.add('hidden');
  reviewEl.innerHTML = '';
  el('payment-import-actions').classList.add('hidden');
  el('payment-import-result').classList.add('hidden');
}

function parsePaymentCSV(text) {
  // Strip UTF-8 BOM if present (Excel exports often include it)
  const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  const lines = clean.split(/\r?\n/).map(l => l.trim()).filter(l => l);
  if (lines.length < 2) throw new Error('Arquivo vazio ou sem dados.');
  const headers = lines[0].split(';').map(h => h.replace(/^"|"$/g, '').trim());
  const rows = [];
  for (let li = 1; li < lines.length; li++) {
    const parts = lines[li].split(';').map(v => v.replace(/^"|"$/g, '').trim());
    const obj = Object.fromEntries(headers.map((h, i) => [h, parts[i] || '']));
    const rawDate = (obj['DATA CONSULTA'] || '').trim();
    // Auto-correct known date typo: 12/12/2026 → 12/02/2026
    const consultationDate = rawDate === '12/12/2026' ? '2026-02-12' : parseBRDate(rawDate);
    if (!consultationDate) continue;
    const meioBruto = (obj['MEIO'] || '').toLowerCase().trim();
    const consultationType = meioBruto === 'online' ? 'teleconsulta' : 'presencial';
    const pagLower = (obj['PAGAMENTO'] || '').trim().toLowerCase();
    const nfLower  = (obj['NF ENVIADA'] || '').trim().toLowerCase();
    let status, invoiceStatus;
    if (pagLower === '-' || pagLower === '—') {
      status = 'gratuito'; invoiceStatus = 'isenta';
    } else if (pagLower === 'sim') {
      status = 'pix'; invoiceStatus = nfLower === 'sim' ? 'emitida' : 'pendente';
    } else {
      status = 'pendente'; invoiceStatus = 'pendente';
    }
    const value = parseBRNumber(obj['VALOR'] || '0');
    const rawPayDate = (obj['DATA PAGAMENTO'] || '').trim();
    const paymentDate = rawPayDate ? parseBRDate(rawPayDate) : null;
    const patientCsvName = (obj['PACIENTE'] || '').trim();
    const matchedPatient = patientCsvName ? fuzzyMatchPatient(patientCsvName) : null;
    rows.push({ idx: li, csvLine: li + 1, consultationDate, patientCsvName, consultationType, value, status, invoiceStatus, paymentDate: paymentDate || null, matchedPatient, manualPatientId: null });
  }
  return rows;
}

function fuzzyMatchPatient(csvName) {
  const norm     = normalizeStr(csvName);
  const csvWords = norm.split(/\s+/).filter(w => w.length > 1);
  if (!csvWords.length) return null;
  const csvFirst = csvWords[0];
  const csvLast  = csvWords[csvWords.length - 1];
  let best = null;
  for (const p of S.data.patients) {
    const pNorm  = normalizeStr(p.name || '');
    if (pNorm === norm) return { id: p.id, name: p.name, score: 'exact' };
    const pWords = pNorm.split(/\s+/).filter(w => w.length > 1);
    if (!best && pWords[0] === csvFirst && (csvWords.length < 2 || pWords.includes(csvLast))) {
      best = { id: p.id, name: p.name, score: 'fuzzy' };
    }
  }
  return best;
}

function renderPaymentImportReview() {
  const rows = S.paymentImportRows;
  if (!rows || !rows.length) return;
  const matched   = rows.filter(r => r.matchedPatient);
  const unmatched = rows.filter(r => !r.matchedPatient);
  const patientOptions = [...S.data.patients]
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }))
    .map(p => `<option value="${p.id}">${esc(p.name || '')}</option>`)
    .join('');
  let html = `<div class="payment-review-summary">
    <div class="payment-summary-matched">✅ <strong>${matched.length}</strong> registro${matched.length !== 1 ? 's' : ''} identificado${matched.length !== 1 ? 's' : ''} automaticamente</div>
    ${unmatched.length ? `<div class="payment-summary-unmatched">⚠️ <strong>${unmatched.length}</strong> registro${unmatched.length !== 1 ? 's' : ''} sem paciente identificado — selecione abaixo ou ignore</div>` : ''}
  </div>`;
  if (unmatched.length) {
    html += `<div class="payment-unmatched-section">
      <div class="payment-unmatched-title">Registros não identificados (${unmatched.length})</div>
      <div class="payment-unmatched-list">`;
    for (const row of unmatched) {
      html += `<div class="payment-unmatched-row" data-row-idx="${row.idx}">
        <div class="payment-row-meta">
          <span class="payment-row-date">${fmtDate(row.consultationDate)}</span>
          <span class="payment-row-csvname">${esc(row.patientCsvName)}</span>
          <span class="payment-row-value">${fmtBRL(row.value)}</span>
          ${statusBadge(row.status)}
        </div>
        <div class="payment-row-select-wrap">
          <select class="payment-patient-select" data-row-idx="${row.idx}">
            <option value="">— Ignorar esta linha —</option>
            ${patientOptions}
          </select>
        </div>
      </div>`;
    }
    html += `</div></div>`;
  }
  html += `<details class="payment-matched-details">
    <summary>Ver ${matched.length} registro${matched.length !== 1 ? 's' : ''} identificado${matched.length !== 1 ? 's' : ''} ▸</summary>
    <div class="payment-matched-list">
      <table class="data-table">
        <thead><tr>
          <th style="width:46px;color:var(--text-muted);font-size:.75rem">#</th>
          <th>Data</th><th>Nome (CSV)</th><th>Paciente</th>
          <th class="text-right">Valor</th><th>Status</th>
        </tr></thead>
        <tbody>${matched.map(r => `<tr>
          <td style="color:var(--text-muted);font-size:.75rem">${r.csvLine}</td>
          <td>${fmtDate(r.consultationDate)}</td>
          <td style="color:var(--text-muted);font-size:.8rem">${esc(r.patientCsvName)}</td>
          <td style="font-weight:600">${esc(r.matchedPatient.name)}</td>
          <td class="text-right">${fmtBRL(r.value)}</td>
          <td>${statusBadge(r.status)}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>
  </details>`;
  const reviewEl = el('payment-import-review');
  reviewEl.innerHTML = html;
  reviewEl.classList.remove('hidden');
  reviewEl.querySelectorAll('.payment-patient-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const row = S.paymentImportRows.find(r => r.idx === parseInt(sel.dataset.rowIdx));
      if (row) row.manualPatientId = sel.value || null;
      updatePaymentImportSummary();
    });
  });
  updatePaymentImportSummary();
  el('payment-import-actions').classList.remove('hidden');
}

function updatePaymentImportSummary() {
  const rows = S.paymentImportRows;
  if (!rows) return;
  const ready   = rows.filter(r => r.matchedPatient || r.manualPatientId).length;
  const ignored = rows.length - ready;
  el('payment-import-summary').textContent =
    `${ready} de ${rows.length} prontos · ${ignored} ${ignored === 1 ? 'será ignorado' : 'serão ignorados'}`;
}

async function confirmPaymentImport() {
  const rows = S.paymentImportRows;
  if (!rows) return;
  const toImport = rows.filter(r => r.matchedPatient || r.manualPatientId);
  if (!toImport.length) { showToast('Nenhum registro pronto para importar.', 'error'); return; }
  const dups = toImport.filter(row => {
    const patId = row.manualPatientId || row.matchedPatient?.id;
    return S.data.recebimentos.some(r => r.patientId === patId && r.date === row.consultationDate);
  });
  const doImport = async () => {
    showLoading();
    try {
      for (let i = 0; i < toImport.length; i += 490) {
        const batch = writeBatch(db);
        toImport.slice(i, i + 490).forEach(row => {
          const patId   = row.manualPatientId || row.matchedPatient?.id || null;
          const patName = patId ? (S.data.patients.find(p => p.id === patId)?.name || row.patientCsvName) : row.patientCsvName;
          const data = {
            date:             row.consultationDate,
            patient:          patName,
            patientId:        patId,
            consultationType: row.consultationType,
            value:            row.value,
            status:           row.status,
            invoiceStatus:    row.invoiceStatus,
            notes:            '',
            importedFromCsv:  true,
            createdAt:        serverTimestamp(),
            createdBy:        S.user.uid,
          };
          if (row.paymentDate) data.paymentDate = row.paymentDate;
          batch.set(doc(collection(db, 'recebimentos')), data);
        });
        await batch.commit();
      }
      await reloadCollection('recebimentos');
      updateBadges();
      const resultEl = el('payment-import-result');
      resultEl.className = 'import-result success';
      resultEl.innerHTML = `<strong>✓ ${toImport.length} consulta${toImport.length > 1 ? 's importadas' : ' importada'} com sucesso!</strong><br>Os dados estão disponíveis na aba <strong>Consultas</strong>.`;
      resultEl.classList.remove('hidden');
      el('payment-import-review').classList.add('hidden');
      el('payment-import-actions').classList.add('hidden');
      S.paymentImportRows = null;
      showToast(`${toImport.length} consulta${toImport.length > 1 ? 's' : ''} importada${toImport.length > 1 ? 's' : ''}!`, 'success');
    } catch (err) { handleErr(err); } finally { hideLoading(); }
  };
  const confirmImport = () => showConfirm(
    `Importar ${toImport.length} registro${toImport.length > 1 ? 's' : ''} de consulta?`,
    doImport, { danger: false, okLabel: 'Importar' }
  );
  if (dups.length) {
    showConfirm(
      `${dups.length} registro${dups.length > 1 ? 's' : ''} já exist${dups.length > 1 ? 'em' : 'e'} no sistema (mesmo paciente e data). Continuar mesmo assim?`,
      confirmImport
    );
  } else {
    confirmImport();
  }
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
const FORM_MODALS = new Set(['modal-rec','modal-desp','modal-pac','modal-nota']);

function openModal(id)  { S.modalDirty = false; el(id).classList.remove('hidden'); }
function closeModal(id) { el(id).classList.add('hidden'); S.modalDirty = false; }

function tryCloseModal(id) {
  if (FORM_MODALS.has(id) && S.modalDirty) {
    showConfirm('Há alterações não salvas. Deseja descartar?', () => closeModal(id), { title: 'Descartar alterações', okLabel: 'Descartar', danger: true });
  } else {
    closeModal(id);
  }
}

document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => tryCloseModal(btn.dataset.close));
});
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => { if (e.target === overlay) tryCloseModal(overlay.id); });
});

document.addEventListener('input',  e => { if (e.target.closest('.modal-overlay:not(.hidden)')) S.modalDirty = true; });
document.addEventListener('change', e => { if (e.target.closest('.modal-overlay:not(.hidden)')) S.modalDirty = true; });

// ─────────────────────────────────────────────────────────────────────────────
// DELEGATED EVENTS
// ─────────────────────────────────────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const plink = e.target.closest('[data-patient]');
  if (plink) { e.preventDefault(); navigateToPatient(plink.dataset.patient); return; }

  const alink = e.target.closest('.alert-link[data-view]');
  if (alink) { e.preventDefault(); navigateTo(alink.dataset.view); return; }

  const periodBtn = e.target.closest('.chart-period-btn[data-months]');
  if (periodBtn) {
    S.chartMonths = parseInt(periodBtn.dataset.months, 10);
    document.querySelectorAll('.chart-period-btn[data-months]').forEach(b => b.classList.toggle('active', b === periodBtn));
    renderMensalChart();
    return;
  }

  const retornoSortBtn = e.target.closest('.chart-period-btn[data-retorno-sort]');
  if (retornoSortBtn) {
    S.retornoSort = retornoSortBtn.dataset.retornoSort;
    document.querySelectorAll('.chart-period-btn[data-retorno-sort]').forEach(b => b.classList.toggle('active', b === retornoSortBtn));
    renderRetornoAlert();
    return;
  }

  const pacStatusBtn = e.target.closest('.pac-status-btn[data-pac-status]');
  if (pacStatusBtn) {
    S.pacStatusFilter = pacStatusBtn.dataset.pacStatus;
    renderPacientes();
    return;
  }

  const nfTabBtn = e.target.closest('.nf-tab-btn[data-nf-tab]');
  if (nfTabBtn) {
    S.nfTab = nfTabBtn.dataset.nfTab;
    document.querySelectorAll('.nf-tab-btn').forEach(b => b.classList.toggle('active', b === nfTabBtn));
    renderNFPendentes();
    return;
  }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;

  if      (action === 'edit-rec')       { const r = S.data.recebimentos.find(r=>r.id===id); if(r) openModalRec(r); }
  else if (action === 'del-rec')        { deleteRec(id); }
  else if (action === 'edit-desp')      { const d = S.data.despesas.find(d=>d.id===id); if(d) openModalDesp(d); }
  else if (action === 'del-desp')       { deleteDesp(id); }
  else if (action === 'mark-received')  { markReceived(id); }
  else if (action === 'inadim-save-contact') {
    const item = btn.closest('.inadim-card-item');
    const sel  = item?.querySelector('.inad-contact-sel');
    const dateInp = item?.querySelector('.inad-promised-date');
    if (sel) saveInadimContact(id, sel.value, dateInp?.value || null);
  }
  else if (action === 'mark-nf')        { el('nf-rec-id').value=''; el('nf-numero').value=''; el('nf-rec-id').value=id; openModal('modal-nf'); }
  else if (action === 'edit-nota')      { const n = S.data.notas.find(n=>n.id===id); if(n) openModalNota(n); }
  else if (action === 'del-nota')       { deleteNota(id); }
  else if (action === 'edit-pac')       { const p = S.data.patients.find(p=>p.id===id); if(p) openModalPaciente(p); }
  else if (action === 'del-pac')        { deletePatient(id); }
  else if (action === 'view-pac')       { navigateToPatient(id); }
  else if (action === 'cal-select-day')      { selectCalendarDay(btn.dataset.date); }
  else if (action === 'merge-pac')           { mergePacientes(btn.dataset.keep, btn.dataset.drop); }
  else if (action === 'not-duplicate') {
    const idA = btn.dataset.idA, idB = btn.dataset.idB;
    showConfirm('Confirmar que esses dois cadastros são pessoas diferentes e não devem ser marcados como duplicatas?', async () => {
      showLoading();
      try {
        const pacA = S.data.patients.find(p => p.id === idA);
        const pacB = S.data.patients.find(p => p.id === idB);
        const notDupA = [...new Set([...(pacA?.notDuplicate || []), idB])];
        const notDupB = [...new Set([...(pacB?.notDuplicate || []), idA])];
        await Promise.all([
          updateDoc(doc(db, 'patients', idA), { notDuplicate: notDupA, updatedAt: serverTimestamp() }),
          updateDoc(doc(db, 'patients', idB), { notDuplicate: notDupB, updatedAt: serverTimestamp() }),
        ]);
        await reloadCollection('patients');
        renderPacientes();
        showToast('Par marcado como não-duplicata.', 'success');
      } catch (err) { handleErr(err); } finally { hideLoading(); }
    }, { title: 'Confirmar cadastros distintos', okLabel: 'Confirmar' });
  }
  else if (action === 'open-consult-detail') { openConsultDetail(id); }
  else if (action === 'cd-edit-rec') {
    const r = S.data.recebimentos.find(r => r.id === id);
    if (r) { closeModal('modal-consult-detail'); openModalRec(r); }
  }
  else if (action === 'cd-register-payment') {
    const ev = S.data.consultations.find(c => c.id === btn.dataset.eventId);
    if (ev) { closeModal('modal-consult-detail'); openModalRec(null, { date: ev.date, patientName: ev.patientName, patientId: ev.patientId, consultationType: ev.consultationType }); }
  }
  else if (action === 'retorno-undo') {
    (async () => {
      const pac = S.data.patients.find(p => p.id === id);
      if (!pac) return;
      showLoading();
      try {
        await updateDoc(doc(db, 'patients', id), { retornoFollowUp: deleteField(), updatedAt: serverTimestamp() });
        pac.retornoFollowUp = null;
        renderRetornoAlert();
        showToast('Contato desfeito.', 'success');
      } catch (err) { handleErr(err); } finally { hideLoading(); }
    })();
  }
  else if (action === 'retorno-form-open') {
    const form = el(`retorno-form-${id}`);
    if (form) form.classList.toggle('hidden');
  }
  else if (action === 'retorno-form-cancel') {
    const form = el(`retorno-form-${id}`);
    if (form) form.classList.add('hidden');
  }
  else if (action === 'retorno-save') {
    const sit  = el(`retorno-sit-${id}`)?.value;
    const next = el(`retorno-next-${id}`)?.value;
    const nota = el(`retorno-nota-${id}`)?.value.trim();
    saveRetornoContact(id, sit, next, nota, parseInt(btn.dataset.attempts || '0'));
  }
  else if (action === 'retorno-inativ-open') {
    el(`retorno-inativ-actions-${id}`)?.classList.remove('hidden');
    btn.classList.add('hidden');
  }
  else if (action === 'retorno-inativ-cancel') {
    el(`retorno-inativ-actions-${id}`)?.classList.add('hidden');
    el(`retorno-inativ-${id}`)?.querySelector('[data-action="retorno-inativ-open"]')?.classList.remove('hidden');
  }
  else if (action === 'retorno-inativ-confirm') {
    (async () => {
      const pac = S.data.patients.find(p => p.id === id);
      if (!pac) return;
      const novoStatus = el(`retorno-inativ-sel-${id}`)?.value || 'inativo';
      showLoading();
      try {
        await updateDoc(doc(db, 'patients', id), { status: novoStatus, manuallyEdited: true, updatedAt: serverTimestamp() });
        await reloadCollection('patients');
        updateBadges(); renderRetornoAlert(); renderInativacaoSugestoes();
        if (S.view === 'pacientes') renderPacientes();
        showToast(`${pac.name} marcado(a) como ${novoStatus === 'alta' ? 'Alta' : 'Inativo'}.`, 'success');
      } catch (err) { handleErr(err); } finally { hideLoading(); }
    })();
  }
  else if (action === 'inativ-suggest') {
    const row = el(`inativ-row-${id}`);
    if (row) { row.querySelector('.inativacao-item-actions').classList.add('hidden'); row.querySelector('.inativacao-confirm').classList.remove('hidden'); }
  }
  else if (action === 'inativ-cancel') {
    const row = el(`inativ-row-${id}`);
    if (row) { row.querySelector('.inativacao-item-actions').classList.remove('hidden'); row.querySelector('.inativacao-confirm').classList.add('hidden'); }
  }
  else if (action === 'inativ-confirm') {
    (async () => {
      const pac = S.data.patients.find(p => p.id === id);
      if (!pac) return;
      const sel = el(`inativ-sel-${id}`);
      const novoStatus = sel ? sel.value : 'inativo';
      const label = novoStatus === 'alta' ? 'Alta' : 'Inativo';
      const prevStatus = pac.status;
      showLoading();
      try {
        await updateDoc(doc(db, 'patients', id), { status: novoStatus, manuallyEdited: true, updatedAt: serverTimestamp() });
        await reloadCollection('patients');
        updateBadges();
        renderInativacaoSugestoes();
        if (S.view === 'pacientes') renderPacientes();
        showToast(`${pac.name} marcado(a) como ${label}.`, 'success', async () => {
          await updateDoc(doc(db, 'patients', id), { status: prevStatus, updatedAt: serverTimestamp() });
          await reloadCollection('patients');
          updateBadges();
          renderInativacaoSugestoes();
          if (S.view === 'pacientes') renderPacientes();
        });
      } catch (err) { handleErr(err); } finally { hideLoading(); }
    })();
  }
  else if (action === 'inativ-manter') {
    (async () => {
      const pac = S.data.patients.find(p => p.id === id);
      if (!pac) return;
      const prevManterAtivo = pac.manterAtivoDesde || null;
      showLoading();
      try {
        await updateDoc(doc(db, 'patients', id), { manterAtivoDesde: today(), updatedAt: serverTimestamp() });
        await reloadCollection('patients');
        updateBadges();
        renderInativacaoSugestoes();
        showToast(`${pac.name} mantido(a) ativo(a) por mais 180 dias.`, 'success', async () => {
          await updateDoc(doc(db, 'patients', id), {
            manterAtivoDesde: prevManterAtivo !== null ? prevManterAtivo : deleteField(),
            updatedAt: serverTimestamp()
          });
          await reloadCollection('patients');
          updateBadges();
          renderInativacaoSugestoes();
        });
      } catch (err) { handleErr(err); } finally { hideLoading(); }
    })();
  }
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
function today() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
function fmtBRL(v)          { return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(v||0); }
function fmtBRLShort(v)     { return v>=1000?'R$'+(v/1000).toFixed(0)+'k':fmtBRL(v); }
function fmtDate(d)         { if(!d)return'—'; const[y,m,dy]=d.split('-'); return`${dy}/${m}/${y}`; }
function fmtCPF(v)          { const d=(v||'').replace(/\D/g,''); return d.length===11?`${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`:v; }
function fmtTimestamp(ts)   { try{return ts.toDate().toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}catch{return''} }
function waBtn(phone) {
  const digits = (phone || '').replace(/\D/g, '');
  if (!digits) return '';
  const num = digits.startsWith('55') ? digits : '55' + digits;
  return `<a href="https://wa.me/${num}" target="_blank" rel="noopener" class="wa-btn" title="Abrir no WhatsApp"><svg viewBox="0 0 24 24" width="16" height="16" fill="#25d366" style="display:block"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.117.554 4.104 1.523 5.827L.057 23.428a.5.5 0 00.514.572l5.762-1.512A11.943 11.943 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.9a9.9 9.9 0 01-5.031-1.371l-.361-.214-3.741.981.999-3.648-.235-.374A9.862 9.862 0 012.1 12C2.1 6.534 6.534 2.1 12 2.1S21.9 6.534 21.9 12 17.466 21.9 12 21.9z"/></svg></a>`;
}
function downloadCSV(filename, headers, rows) {
  const esc = v => {
    const s = (v == null ? '' : String(v)).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const lines = [headers, ...rows].map(row => row.map(esc).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportRecebimentos() {
  const recs = filteredRec();
  const headers = ['Data','Paciente','Modalidade','Valor (R$)','Status','NF Status','Número NF','Observações'];
  const rows = recs.map(r => [
    fmtDate(r.date),
    r.patient || '',
    labels.consultationType[r.consultationType] || r.consultationType || '',
    (r.value || 0).toFixed(2).replace('.', ','),
    labels.status[r.status] || r.status || '',
    labels.invoiceStatus[r.invoiceStatus] || r.invoiceStatus || '',
    r.invoiceNumber || '',
    r.notes || '',
  ]);
  downloadCSV(`consultas_${today()}.csv`, headers, rows);
}

function exportDespesas() {
  const desp = filteredDesp();
  const headers = ['Data','Descrição','Categoria','Recorrência','Valor (R$)'];
  const rows = desp.map(d => [
    fmtDate(d.date),
    d.description || '',
    labels.expenseCategory[d.category] || d.category || '',
    labels.recurrence[d.recurrence] || d.recurrence || '',
    resolvedValue(d).toFixed(2).replace('.', ','),
  ]);
  downloadCSV(`despesas_${today()}.csv`, headers, rows);
}

function exportPacientes() {
  const q = el('search-pac').value.toLowerCase();
  const pacs = S.data.patients
    .filter(p => !q || (p.name || '').toLowerCase().includes(q))
    .filter(p => S.pacStatusFilter === 'todos' || (p.status || 'ativo') === S.pacStatusFilter);
  const headers = ['Nome','Telefone','Telefone 2','E-mail','Data Nascimento','Status','CPF','Sexo','Como chegou','Observações'];
  const genderMap = { m: 'Masculino', f: 'Feminino', o: 'Outro' };
  const rows = pacs.map(p => [
    p.name || '',
    p.phone || '',
    p.phone2 || '',
    p.email || '',
    p.birthDate ? fmtDate(p.birthDate) : '',
    labels.patientStatus[p.status] || p.status || '',
    p.cpf || '',
    genderMap[p.gender] || '',
    p.indication || '',
    p.notes || '',
  ]);
  downloadCSV(`pacientes_${today()}.csv`, headers, rows);
}

el('btn-export-rec').addEventListener('click', exportRecebimentos);
el('btn-export-desp').addEventListener('click', exportDespesas);
el('btn-export-pac').addEventListener('click', exportPacientes);

function daysBetween(d1,d2) { return Math.max(0,Math.round((new Date(d2)-new Date(d1))/86400000)); }
function dateAddDays(dateStr,n) { const d=new Date(dateStr); d.setDate(d.getDate()+n); return d.toISOString().split('T')[0]; }
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
  let value  = 0;
  let isTele = false;

  const desc = (description || '').toLowerCase();
  isTele = desc.includes('online') || desc.includes('teleconsult');

  const descValMatch = (description || '').match(/\((\d+(?:[,\.]\d+)?)\)/);
  if (descValMatch) value = parseBRNumber(descValMatch[1]);

  if (!value && procedurePack) {
    const ppMatch = procedurePack.match(/[Cc]onsulta\s*([\d.,]+)/);
    if (ppMatch) value = parseBRNumber(ppMatch[1]);
    if (!isTele && procedurePack.toLowerCase().includes('online')) isTele = true;
  }

  return { value, isTele };
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
  const cls = { ativo:'badge-ativo', inativo:'badge-inativo', alta:'badge-alta' };
  return `<span class="badge ${cls[status]||''}">${labels.patientStatus[status]||status||'—'}</span>`;
}

let toastTimer = null;
let toastUndoFn = null;

function showToast(msg, type = 'success', undoFn = null) {
  const t = el('toast'), ic = el('toast-icon'), mg = el('toast-msg');
  const undoBtn = el('toast-undo'), progress = el('toast-progress'), bar = el('toast-progress-bar');
  const icons = { success: '✓', error: '✕', info: 'ℹ' };

  clearTimeout(toastTimer);
  toastUndoFn = undoFn;

  t.className = `toast toast-${type}`;
  ic.textContent = icons[type] || '✓';
  mg.textContent = msg;

  if (undoFn) {
    undoBtn.classList.remove('hidden');
    progress.classList.remove('hidden');
    bar.style.transition = 'none';
    bar.style.width = '100%';
    t.classList.remove('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bar.style.transition = 'width 5s linear';
      bar.style.width = '0%';
    }));
    toastTimer = setTimeout(() => { t.classList.add('hidden'); toastUndoFn = null; }, 5000);
  } else {
    undoBtn.classList.add('hidden');
    progress.classList.add('hidden');
    t.classList.remove('hidden');
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
  }
}
function showLoading()  { el('loading-overlay').classList.remove('hidden'); }
function hideLoading()  { el('loading-overlay').classList.add('hidden'); }

function showConfirm(msg, onOk, { title = 'Confirmar ação', danger = true, okLabel = 'Confirmar' } = {}) {
  el('confirm-title').textContent = title;
  el('confirm-msg').textContent   = msg;
  const okBtn = el('confirm-ok');
  okBtn.textContent = okLabel;
  okBtn.className   = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  openModal('modal-confirm');
  okBtn.onclick = () => { closeModal('modal-confirm'); onOk(); };
}
el('confirm-cancel').addEventListener('click', () => closeModal('modal-confirm'));

el('toast-undo').addEventListener('click', () => {
  clearTimeout(toastTimer);
  el('toast').classList.add('hidden');
  if (toastUndoFn) { const fn = toastUndoFn; toastUndoFn = null; fn(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────────────────────────────────────
applyPreset('mes');
setupAutocomplete('rec-paciente', 'rec-paciente-list', 'rec-paciente-id');
