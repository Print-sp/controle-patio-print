const SEMINOVOS_API = '/api/seminovos';
const SEMINOVOS_VEHICLE_TYPES = ['Toco', 'Truck', 'Carreta', 'Cavalo'];
const SEMINOVOS_OPERATIONAL_STATUSES = [
  'Disponível',
  'Em manutenção',
  'Em borracharia',
  'Em funilaria',
  'Pendente de documentação',
  'Problema mecânico',
  'Aguardando peça',
  'Liberado'
];
const SEMINOVOS_COMMERCIAL_STATUSES = ['Nenhum', 'Pós-venda', 'Garantia', 'Pós-venda e garantia', 'Finalizado'];
const SEMINOVOS_SERVICE_CATEGORIES = ['Manutenção', 'Borracharia', 'Funilaria', 'Documentação'];
const SEMINOVOS_SERVICE_STATUSES = ['Aberta', 'Em andamento', 'Aguardando peça', 'Concluída', 'Cancelada'];
const SEMINOVOS_PHOTO_CATEGORIES = ['Frente', 'Traseira', 'Lado esquerdo', 'Lado direito', 'Painel / odômetro', 'Avaria / observação'];

let seminovosCurrentUser = null;
let seminovosVehicles = [];
let seminovosServiceOrders = [];
let seminovosCurrentView = 'painel';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function canAccessSeminovos(user) {
  return ['admin', 'seminovos'].includes(user?.role);
}

function getLocalDateTimeInputValue(date = new Date()) {
  const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
  return local.toISOString().slice(0, 16);
}

function serializeDateTimeInputValue(value) {
  if (!value) return '';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function formatDateTimeBR(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function formatNumberBR(value) {
  return new Intl.NumberFormat('pt-BR').format(Number(value || 0));
}

function getPlateType(plate) {
  if (!plate) return 'mercosul';
  const cleanPlate = String(plate).replace(/[-\s]/g, '').toUpperCase();
  if (/^[A-Z]{3}\d{4}$/.test(cleanPlate)) return 'vermelha';
  return 'mercosul';
}

function renderPlate(plate) {
  const safePlate = escapeHtml(plate || '—');
  const cssClass = getPlateType(plate) === 'vermelha' ? 'placa-vermelha' : 'placa-mercosul';
  return `<span class="placa-container ${cssClass}"><span class="placa-texto">${safePlate}</span></span>`;
}

function getVehicleStatusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('document')) return 'doc';
  if (normalized.includes('mec')) return 'mec';
  if (normalized.includes('funilar')) return 'funilaria';
  if (normalized.includes('borrachar')) return 'borracharia';
  if (normalized.includes('peça')) return 'peca';
  if (normalized.includes('liber')) return 'liberado';
  if (normalized.includes('dispon')) return 'disponivel';
  return '';
}

function getCommercialStatusClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('garantia') && normalized.includes('pós')) return 'posvenda garantia';
  if (normalized.includes('garantia')) return 'garantia';
  if (normalized.includes('pós')) return 'posvenda';
  if (normalized.includes('final')) return 'finalizado';
  return '';
}

function renderVehicleStatus(status) {
  return `<span class="status-pill ${getVehicleStatusClass(status)}">${escapeHtml(status || '—')}</span>`;
}

function renderCommercialStatus(status) {
  return `<span class="commercial-pill ${getCommercialStatusClass(status)}">${escapeHtml(status || '—')}</span>`;
}

function renderVehicleType(type) {
  return `<span class="type-pill"><i class="bi bi-truck-front"></i>${escapeHtml(type || '—')}</span>`;
}

function showToast(message, variant = 'success') {
  const tone = {
    success: 'alert-success',
    danger: 'alert-danger',
    warning: 'alert-warning',
    info: 'alert-info'
  }[variant] || 'alert-secondary';
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `alert ${tone} shadow-sm border-0`;
  toast.innerHTML = `<div class="d-flex align-items-start gap-2"><i class="bi bi-info-circle mt-1"></i><div>${escapeHtml(message)}</div></div>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

function populateSelect(selectId, values, { includeAll = false, allLabel = 'Todos', placeholder = '' } = {}) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const options = [];
  if (placeholder) {
    options.push(`<option value="">${escapeHtml(placeholder)}</option>`);
  } else if (includeAll) {
    options.push(`<option value="">${escapeHtml(allLabel)}</option>`);
  }
  values.forEach(value => {
    options.push(`<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`);
  });
  select.innerHTML = options.join('');
}

function getVehicleById(id) {
  return seminovosVehicles.find(vehicle => String(vehicle.id) === String(id)) || null;
}

function getServiceOrderById(id) {
  return seminovosServiceOrders.find(order => String(order.id) === String(id)) || null;
}

function openView(viewName) {
  seminovosCurrentView = viewName;
  document.querySelectorAll('.module-view').forEach(section => section.classList.add('hidden'));
  document.querySelectorAll('.module-nav .nav-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.view === viewName);
  });
  document.getElementById(`${viewName}View`)?.classList.remove('hidden');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Falha na requisição');
  return data;
}

async function checkSeminovosAuth() {
  try {
    const data = await fetchJson('/api/auth/me');
    if (data.authenticated && canAccessSeminovos(data.user)) {
      seminovosCurrentUser = data.user;
      await showSeminovosApp();
      return;
    }
    if (data.authenticated && !canAccessSeminovos(data.user)) {
      window.location.href = '/';
      return;
    }
  } catch (error) {
    // Mantém a tela de login.
  }
  showSeminovosLogin();
}

function showSeminovosLogin() {
  document.getElementById('seminovosLoginScreen').classList.remove('hidden');
  document.getElementById('seminovosApp').classList.add('hidden');
}

async function showSeminovosApp() {
  document.getElementById('seminovosLoginScreen').classList.add('hidden');
  document.getElementById('seminovosApp').classList.remove('hidden');
  document.getElementById('seminovosUserName').textContent = seminovosCurrentUser.username;
  document.getElementById('seminovosUserAvatar').textContent = seminovosCurrentUser.username.charAt(0).toUpperCase();
  document.getElementById('seminovosUserRole').textContent = seminovosCurrentUser.role === 'admin' ? 'ADMIN' : 'SEMINOVOS';
  document.getElementById('btnBackToPatio').classList.toggle('hidden', seminovosCurrentUser.role !== 'admin');
  await loadSeminovosData();
}

async function loadSeminovosData() {
  try {
    const [vehicles, orders] = await Promise.all([
      fetchJson(`${SEMINOVOS_API}/vehicles`),
      fetchJson(`${SEMINOVOS_API}/service-orders`)
    ]);
    seminovosVehicles = Array.isArray(vehicles) ? vehicles : [];
    seminovosServiceOrders = Array.isArray(orders) ? orders : [];
    renderSeminovosModule();
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Não foi possível carregar os dados de seminovos', 'danger');
  }
}

function renderSeminovosModule() {
  renderDashboard();
  renderVehiclesTable();
  renderOrdersTable();
  renderPartsView();
  populateOrderVehicleOptions();
  openView(seminovosCurrentView || 'painel');
}
function getDashboardCards() {
  return [
    { label: 'Total de veículos', value: seminovosVehicles.length, helper: 'Base cadastrada no módulo', action: () => { clearVehicleFilters(); openView('veiculos'); } },
    { label: 'Disponíveis', value: seminovosVehicles.filter(v => v.operationalStatus === 'Disponível').length, helper: 'Prontos para movimentação', action: () => applyVehicleStatusFilter('Disponível') },
    { label: 'Em manutenção', value: seminovosVehicles.filter(v => v.operationalStatus === 'Em manutenção').length, helper: 'Atendimento mecânico em curso', action: () => applyVehicleStatusFilter('Em manutenção') },
    { label: 'Em borracharia', value: seminovosVehicles.filter(v => v.operationalStatus === 'Em borracharia').length, helper: 'Serviço de pneus e rodas', action: () => applyVehicleStatusFilter('Em borracharia') },
    { label: 'Em funilaria', value: seminovosVehicles.filter(v => v.operationalStatus === 'Em funilaria').length, helper: 'Reparo estrutural ou estético', action: () => applyVehicleStatusFilter('Em funilaria') },
    { label: 'Pendente documentação', value: seminovosVehicles.filter(v => v.operationalStatus === 'Pendente de documentação').length, helper: 'Impedimento documental', action: () => applyVehicleStatusFilter('Pendente de documentação') },
    { label: 'Problema mecânico', value: seminovosVehicles.filter(v => v.operationalStatus === 'Problema mecânico').length, helper: 'Parados por falha mecânica', action: () => applyVehicleStatusFilter('Problema mecânico') },
    { label: 'Aguardando peça', value: seminovosVehicles.filter(v => v.operationalStatus === 'Aguardando peça').length, helper: 'Dependem de componente', action: () => applyVehicleStatusFilter('Aguardando peça') },
    { label: 'Pós-venda', value: seminovosVehicles.filter(v => v.commercialStatus === 'Pós-venda' || v.commercialStatus === 'Pós-venda e garantia').length, helper: 'Acompanhamento comercial ativo', action: () => applyCommercialStatusFilter('Pós-venda') },
    { label: 'Garantia', value: seminovosVehicles.filter(v => v.commercialStatus === 'Garantia' || v.commercialStatus === 'Pós-venda e garantia').length, helper: 'Atendimento coberto por garantia', action: () => applyCommercialStatusFilter('Garantia') }
  ];
}

function renderDashboard() {
  const cards = getDashboardCards();
  const cardsContainer = document.getElementById('seminovosDashboardCards');
  cardsContainer.innerHTML = cards.map((card, index) => `
    <button type="button" class="panel-card text-start border-0" data-dashboard-index="${index}">
      <div class="label">${escapeHtml(card.label)}</div>
      <div class="value">${escapeHtml(String(card.value))}</div>
      <div class="helper">${escapeHtml(card.helper)}</div>
    </button>
  `).join('');
  cardsContainer.querySelectorAll('[data-dashboard-index]').forEach(button => {
    button.addEventListener('click', () => cards[Number(button.dataset.dashboardIndex)]?.action?.());
  });

  const attentionVehicles = seminovosVehicles
    .filter(vehicle => !['Disponível', 'Liberado'].includes(vehicle.operationalStatus) || vehicle.commercialStatus !== 'Nenhum')
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, 8);
  const attentionList = document.getElementById('seminovosAttentionList');
  if (!attentionVehicles.length) {
    attentionList.innerHTML = '<div class="empty-state"><i class="bi bi-check2-circle fs-2 d-block mb-2"></i>Nenhum veículo exige atenção imediata neste momento.</div>';
  } else {
    attentionList.innerHTML = attentionVehicles.map(vehicle => `
      <div class="d-flex flex-column flex-md-row justify-content-between align-items-md-center gap-3 py-2 border-bottom">
        <div>
          <div class="mb-2">${renderPlate(vehicle.plate)}</div>
          <div class="d-flex flex-wrap gap-2 mb-2">${renderVehicleType(vehicle.type)} ${renderVehicleStatus(vehicle.operationalStatus)} ${renderCommercialStatus(vehicle.commercialStatus)}</div>
          <small class="text-muted">Odômetro: ${formatNumberBR(vehicle.odometer)} km • Atualizado em ${formatDateTimeBR(vehicle.updatedAt)}</small>
        </div>
        <div class="d-flex gap-2">
          <button type="button" class="btn btn-outline-warning btn-sm" onclick="openSeminovosVehicleModal('${vehicle.id}')"><i class="bi bi-pencil"></i></button>
          <button type="button" class="btn btn-outline-secondary btn-sm" onclick="viewSeminovosVehicleDetails('${vehicle.id}')"><i class="bi bi-eye"></i></button>
        </div>
      </div>
    `).join('');
  }

  const openOrders = seminovosServiceOrders.filter(order => !['Concluída', 'Cancelada'].includes(order.status)).slice(0, 8);
  const openOrdersList = document.getElementById('seminovosOpenOrdersList');
  if (!openOrders.length) {
    openOrdersList.innerHTML = '<div class="empty-state"><i class="bi bi-clipboard2-check fs-2 d-block mb-2"></i>Nenhuma ordem de serviço em aberto.</div>';
  } else {
    openOrdersList.innerHTML = openOrders.map(order => `
      <div class="py-2 border-bottom">
        <div class="d-flex justify-content-between align-items-start gap-3">
          <div>
            <strong>OS ${escapeHtml(order.serviceOrderNumber)}</strong>
            <div class="mt-2 d-flex flex-wrap gap-2">${renderVehicleStatus(order.status)} ${renderVehicleType(order.vehicleType)}</div>
            <small class="text-muted d-block mt-2">${escapeHtml(order.vehiclePlate)} • ${escapeHtml(order.category)} • ${formatDateTimeBR(order.openedAt)}</small>
          </div>
          <button type="button" class="btn btn-outline-warning btn-sm" onclick="openSeminovosOrderModal('${order.id}')"><i class="bi bi-pencil"></i></button>
        </div>
      </div>
    `).join('');
  }
}

function getFilteredVehicles() {
  const search = document.getElementById('seminovosVehicleSearch').value.trim().toLowerCase();
  const type = document.getElementById('seminovosVehicleTypeFilter').value;
  const status = document.getElementById('seminovosVehicleStatusFilter').value;
  const commercial = document.getElementById('seminovosVehicleCommercialFilter').value;
  return seminovosVehicles.filter(vehicle => {
    const haystack = `${vehicle.plate} ${vehicle.chassis} ${vehicle.notes} ${vehicle.latestServiceOrderNumber}`.toLowerCase();
    if (search && !haystack.includes(search)) return false;
    if (type && vehicle.type !== type) return false;
    if (status && vehicle.operationalStatus !== status) return false;
    if (commercial) {
      if (commercial === 'Pós-venda') {
        if (!['Pós-venda', 'Pós-venda e garantia'].includes(vehicle.commercialStatus)) return false;
      } else if (commercial === 'Garantia') {
        if (!['Garantia', 'Pós-venda e garantia'].includes(vehicle.commercialStatus)) return false;
      } else if (vehicle.commercialStatus !== commercial) {
        return false;
      }
    }
    return true;
  });
}

function renderVehiclesTable() {
  const tbody = document.getElementById('seminovosVehiclesTableBody');
  const emptyState = document.getElementById('seminovosVehiclesEmptyState');
  const filtered = getFilteredVehicles();
  emptyState.classList.toggle('hidden', filtered.length > 0);
  if (!filtered.length) {
    tbody.innerHTML = '';
    return;
  }
  tbody.innerHTML = filtered.map(vehicle => `
    <tr>
      <td>${renderPlate(vehicle.plate)}</td>
      <td>${renderVehicleType(vehicle.type)}</td>
      <td><strong>${formatNumberBR(vehicle.odometer)}</strong> km</td>
      <td>${renderVehicleStatus(vehicle.operationalStatus)}</td>
      <td>${renderCommercialStatus(vehicle.commercialStatus)}</td>
      <td>${vehicle.latestServiceOrderNumber ? `<span class="fw-semibold">${escapeHtml(vehicle.latestServiceOrderNumber)}</span>` : '<span class="text-muted">Sem OS</span>'}</td>
      <td><span class="badge text-bg-light border"><i class="bi bi-images me-1"></i>${vehicle.photoCount || 0}</span></td>
      <td><small>${formatDateTimeBR(vehicle.updatedAt)}</small></td>
      <td>
        <div class="d-flex gap-2 flex-wrap">
          <button type="button" class="btn btn-outline-secondary btn-sm" onclick="viewSeminovosVehicleDetails('${vehicle.id}')"><i class="bi bi-eye"></i></button>
          <button type="button" class="btn btn-outline-warning btn-sm" onclick="openSeminovosVehicleModal('${vehicle.id}')"><i class="bi bi-pencil"></i></button>
          <button type="button" class="btn btn-outline-dark btn-sm" onclick="openSeminovosOrderModal('', '${vehicle.id}')"><i class="bi bi-tools"></i></button>
          <button type="button" class="btn btn-outline-danger btn-sm" onclick="deleteSeminovosVehicle('${vehicle.id}')"><i class="bi bi-trash"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
}
function getFilteredOrders() {
  const search = document.getElementById('seminovosOrderSearch').value.trim().toLowerCase();
  const category = document.getElementById('seminovosOrderCategoryFilter').value;
  const status = document.getElementById('seminovosOrderStatusFilter').value;
  return seminovosServiceOrders.filter(order => {
    const haystack = `${order.serviceOrderNumber} ${order.vehiclePlate} ${order.description} ${order.notes}`.toLowerCase();
    if (search && !haystack.includes(search)) return false;
    if (category && order.category !== category) return false;
    if (status && order.status !== status) return false;
    return true;
  });
}

function renderOrdersTable() {
  const tbody = document.getElementById('seminovosOrdersTableBody');
  const emptyState = document.getElementById('seminovosOrdersEmptyState');
  const filtered = getFilteredOrders();
  emptyState.classList.toggle('hidden', filtered.length > 0);
  if (!filtered.length) {
    tbody.innerHTML = '';
    return;
  }
  tbody.innerHTML = filtered.map(order => `
    <tr>
      <td><strong>${escapeHtml(order.serviceOrderNumber)}</strong></td>
      <td>
        <div class="mb-1">${renderPlate(order.vehiclePlate)}</div>
        <small>${renderVehicleType(order.vehicleType)}</small>
      </td>
      <td>${escapeHtml(order.category)}</td>
      <td>${renderVehicleStatus(order.status)}</td>
      <td>${formatNumberBR(order.odometer)} km</td>
      <td><small>${formatDateTimeBR(order.openedAt)}</small></td>
      <td><small>${formatDateTimeBR(order.closedAt)}</small></td>
      <td><span class="badge text-bg-light border">${order.parts?.length || 0}</span></td>
      <td>
        <div class="d-flex gap-2 flex-wrap">
          <button type="button" class="btn btn-outline-warning btn-sm" onclick="openSeminovosOrderModal('${order.id}')"><i class="bi bi-pencil"></i></button>
          <button type="button" class="btn btn-outline-danger btn-sm" onclick="deleteSeminovosOrder('${order.id}')"><i class="bi bi-trash"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
}

function getFlattenedParts() {
  return seminovosServiceOrders.flatMap(order => (order.parts || []).map(part => ({
    ...part,
    vehiclePlate: order.vehiclePlate,
    serviceOrderNumber: order.serviceOrderNumber,
    category: order.category,
    openedAt: order.openedAt
  })));
}

function renderPartsView() {
  const search = document.getElementById('seminovosPartsSearch').value.trim().toLowerCase();
  const parts = getFlattenedParts();
  const filtered = parts.filter(part => {
    const haystack = `${part.vehiclePlate} ${part.serviceOrderNumber} ${part.partName} ${part.notes}`.toLowerCase();
    return !search || haystack.includes(search);
  });

  const uniqueVehicles = new Set(filtered.map(part => part.vehiclePlate)).size;
  const totalQuantity = filtered.reduce((acc, part) => acc + Number(part.quantity || 0), 0);
  const summary = [
    { label: 'Itens registrados', value: filtered.length, helper: 'Lançamentos de peças' },
    { label: 'Quantidade total', value: totalQuantity, helper: 'Soma das quantidades usadas' },
    { label: 'Veículos impactados', value: uniqueVehicles, helper: 'Veículos com peças registradas' }
  ];
  document.getElementById('seminovosPartsSummary').innerHTML = summary.map(item => `
    <div class="panel-card text-start border-0">
      <div class="label">${escapeHtml(item.label)}</div>
      <div class="value">${escapeHtml(String(item.value))}</div>
      <div class="helper">${escapeHtml(item.helper)}</div>
    </div>
  `).join('');

  const tbody = document.getElementById('seminovosPartsTableBody');
  const emptyState = document.getElementById('seminovosPartsEmptyState');
  emptyState.classList.toggle('hidden', filtered.length > 0);
  if (!filtered.length) {
    tbody.innerHTML = '';
    return;
  }
  tbody.innerHTML = filtered.map(part => `
    <tr>
      <td>${renderPlate(part.vehiclePlate)}</td>
      <td><strong>${escapeHtml(part.serviceOrderNumber)}</strong></td>
      <td>${escapeHtml(part.category)}</td>
      <td>${escapeHtml(part.partName)}</td>
      <td>${formatNumberBR(part.quantity)}</td>
      <td><small>${escapeHtml(part.notes || '—')}</small></td>
      <td><small>${formatDateTimeBR(part.createdAt || part.openedAt)}</small></td>
    </tr>
  `).join('');
}

function clearVehicleFilters() {
  document.getElementById('seminovosVehicleSearch').value = '';
  document.getElementById('seminovosVehicleTypeFilter').value = '';
  document.getElementById('seminovosVehicleStatusFilter').value = '';
  document.getElementById('seminovosVehicleCommercialFilter').value = '';
  renderVehiclesTable();
}

function applyVehicleStatusFilter(status) {
  openView('veiculos');
  document.getElementById('seminovosVehicleStatusFilter').value = status;
  renderVehiclesTable();
}

function applyCommercialStatusFilter(status) {
  openView('veiculos');
  document.getElementById('seminovosVehicleCommercialFilter').value = status;
  renderVehiclesTable();
}

function renderVehiclePhotoFields(existingPhotos = []) {
  const photosByCategory = new Map(existingPhotos.map(photo => [photo.category, photo]));
  const container = document.getElementById('seminovosVehiclePhotoFields');
  container.innerHTML = SEMINOVOS_PHOTO_CATEGORIES.map(category => {
    const photo = photosByCategory.get(category);
    const safeId = category.replace(/[^a-zA-Z0-9]/g, '');
    return `
      <div class="photo-slot" data-category="${escapeHtml(category)}">
        <div class="photo-slot-title">${escapeHtml(category)}</div>
        <div class="photo-preview ${photo ? '' : 'empty'}" data-preview="${escapeHtml(category)}">
          ${photo ? `<img src="${escapeHtml(photo.filePath)}" alt="${escapeHtml(category)}">` : '<span>Sem foto nesta categoria</span>'}
        </div>
        <input type="file" class="form-control seminovos-photo-input" accept="image/*">
        <div class="form-check mt-2">
          <input class="form-check-input seminovos-photo-remove" type="checkbox" id="removePhoto${safeId}">
          <label class="form-check-label small" for="removePhoto${safeId}">Remover foto atual</label>
        </div>
        <div class="form-text">Imagem comprimida automaticamente antes do envio.</div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.seminovos-photo-input').forEach(input => {
    input.addEventListener('change', handlePhotoInputChange);
  });
}

function handlePhotoInputChange(event) {
  const input = event.currentTarget;
  const slot = input.closest('.photo-slot');
  if (!slot) return;
  const preview = slot.querySelector('.photo-preview');
  const removeToggle = slot.querySelector('.seminovos-photo-remove');
  const file = input.files?.[0];
  if (!file) return;
  removeToggle.checked = false;
  const objectUrl = URL.createObjectURL(file);
  preview.classList.remove('empty');
  preview.innerHTML = `<img src="${objectUrl}" alt="Pré-visualização">`;
}

async function compressImage(file) {
  const image = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const maxDimension = 1600;
  let { width, height } = image;
  if (width > maxDimension || height > maxDimension) {
    const ratio = Math.min(maxDimension / width, maxDimension / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/webp', 0.72);
}

async function collectVehiclePhotoPayloads() {
  const slots = Array.from(document.querySelectorAll('#seminovosVehiclePhotoFields .photo-slot'));
  const payloads = [];
  for (const slot of slots) {
    const category = slot.dataset.category;
    const file = slot.querySelector('.seminovos-photo-input').files?.[0];
    const remove = slot.querySelector('.seminovos-photo-remove').checked;
    if (file) {
      payloads.push({ category, dataUrl: await compressImage(file) });
    } else if (remove) {
      payloads.push({ category, remove: true });
    }
  }
  return payloads;
}
function resetVehicleForm() {
  document.getElementById('seminovosVehicleForm').reset();
  document.getElementById('seminovosVehicleId').value = '';
  document.getElementById('seminovosVehicleModalTitle').textContent = 'Novo veículo seminovo';
  document.getElementById('seminovosVehicleOperationalStatus').value = 'Disponível';
  document.getElementById('seminovosVehicleCommercialStatus').value = 'Nenhum';
  renderVehiclePhotoFields([]);
}

function openSeminovosVehicleModal(id = '') {
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('seminovosVehicleModal'));
  resetVehicleForm();
  if (id) {
    const vehicle = getVehicleById(id);
    if (!vehicle) return;
    document.getElementById('seminovosVehicleModalTitle').textContent = `Editar veículo ${vehicle.plate}`;
    document.getElementById('seminovosVehicleId').value = vehicle.id;
    document.getElementById('seminovosVehiclePlate').value = vehicle.plate;
    document.getElementById('seminovosVehicleType').value = vehicle.type;
    document.getElementById('seminovosVehicleChassis').value = vehicle.chassis || '';
    document.getElementById('seminovosVehicleOdometer').value = vehicle.odometer || 0;
    document.getElementById('seminovosVehicleOperationalStatus').value = vehicle.operationalStatus;
    document.getElementById('seminovosVehicleCommercialStatus').value = vehicle.commercialStatus;
    document.getElementById('seminovosVehicleNotes').value = vehicle.notes || '';
    renderVehiclePhotoFields(vehicle.photos || []);
  }
  modal.show();
}

async function saveSeminovosVehicle(event) {
  event.preventDefault();
  const id = document.getElementById('seminovosVehicleId').value;
  const payload = {
    plate: document.getElementById('seminovosVehiclePlate').value.trim().toUpperCase(),
    type: document.getElementById('seminovosVehicleType').value,
    chassis: document.getElementById('seminovosVehicleChassis').value.trim(),
    odometer: document.getElementById('seminovosVehicleOdometer').value,
    operationalStatus: document.getElementById('seminovosVehicleOperationalStatus').value,
    commercialStatus: document.getElementById('seminovosVehicleCommercialStatus').value,
    notes: document.getElementById('seminovosVehicleNotes').value,
    photos: await collectVehiclePhotoPayloads()
  };

  try {
    await fetchJson(id ? `${SEMINOVOS_API}/vehicles/${id}` : `${SEMINOVOS_API}/vehicles`, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    bootstrap.Modal.getInstance(document.getElementById('seminovosVehicleModal')).hide();
    await loadSeminovosData();
    showToast(id ? 'Veículo atualizado com sucesso' : 'Veículo cadastrado com sucesso', 'success');
  } catch (error) {
    showToast(error.message || 'Não foi possível salvar o veículo', 'danger');
  }
}

async function deleteSeminovosVehicle(id) {
  const vehicle = getVehicleById(id);
  if (!vehicle) return;
  if (!window.confirm(`Excluir o veículo ${vehicle.plate} do módulo Seminovos?`)) return;
  try {
    await fetchJson(`${SEMINOVOS_API}/vehicles/${id}`, { method: 'DELETE' });
    await loadSeminovosData();
    showToast('Veículo excluído com sucesso', 'warning');
  } catch (error) {
    showToast(error.message || 'Não foi possível excluir o veículo', 'danger');
  }
}

function renderPartRow(part = {}) {
  return `
    <div class="part-row" data-part-row>
      <input type="text" class="form-control part-name" placeholder="Peça utilizada" value="${escapeHtml(part.partName || '')}">
      <input type="number" class="form-control part-quantity" min="1" step="1" placeholder="Qtd" value="${escapeHtml(String(part.quantity || 1))}">
      <input type="text" class="form-control part-notes" placeholder="Observação" value="${escapeHtml(part.notes || '')}">
      <button type="button" class="btn btn-outline-danger" data-remove-part><i class="bi bi-trash"></i></button>
    </div>
  `;
}

function bindPartRowButtons() {
  document.querySelectorAll('[data-remove-part]').forEach(button => {
    button.onclick = () => {
      button.closest('[data-part-row]')?.remove();
      if (!document.querySelector('#seminovosOrderPartsContainer [data-part-row]')) {
        addSeminovosPartRow();
      }
    };
  });
}

function addSeminovosPartRow(part = {}) {
  const container = document.getElementById('seminovosOrderPartsContainer');
  container.insertAdjacentHTML('beforeend', renderPartRow(part));
  bindPartRowButtons();
}

function collectOrderParts() {
  return Array.from(document.querySelectorAll('#seminovosOrderPartsContainer [data-part-row]')).map(row => ({
    partName: row.querySelector('.part-name').value.trim(),
    quantity: row.querySelector('.part-quantity').value,
    notes: row.querySelector('.part-notes').value.trim()
  })).filter(part => part.partName);
}

function populateOrderVehicleOptions() {
  const select = document.getElementById('seminovosOrderVehicleId');
  const options = ['<option value="">Selecione um veículo</option>']
    .concat([...seminovosVehicles]
      .sort((a, b) => a.plate.localeCompare(b.plate))
      .map(vehicle => `<option value="${vehicle.id}">${escapeHtml(vehicle.plate)} • ${escapeHtml(vehicle.type)}</option>`));
  select.innerHTML = options.join('');
}

function resetOrderForm() {
  document.getElementById('seminovosOrderForm').reset();
  document.getElementById('seminovosOrderId').value = '';
  document.getElementById('seminovosOrderModalTitle').textContent = 'Nova ordem de serviço';
  document.getElementById('seminovosOrderOpenedAt').value = getLocalDateTimeInputValue();
  document.getElementById('seminovosOrderStatus').value = 'Aberta';
  document.getElementById('seminovosOrderCategory').value = 'Manutenção';
  document.getElementById('seminovosOrderPartsContainer').innerHTML = '';
  addSeminovosPartRow();
}

function openSeminovosOrderModal(id = '', vehicleId = '') {
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('seminovosOrderModal'));
  resetOrderForm();
  if (vehicleId) {
    document.getElementById('seminovosOrderVehicleId').value = vehicleId;
    const vehicle = getVehicleById(vehicleId);
    if (vehicle) document.getElementById('seminovosOrderOdometer').value = vehicle.odometer || 0;
  }
  if (id) {
    const order = getServiceOrderById(id);
    if (!order) return;
    document.getElementById('seminovosOrderModalTitle').textContent = `Editar OS ${order.serviceOrderNumber}`;
    document.getElementById('seminovosOrderId').value = order.id;
    document.getElementById('seminovosOrderVehicleId').value = order.vehicleId;
    document.getElementById('seminovosOrderNumber').value = order.serviceOrderNumber;
    document.getElementById('seminovosOrderCategory').value = order.category;
    document.getElementById('seminovosOrderStatus').value = order.status;
    document.getElementById('seminovosOrderOdometer').value = order.odometer || 0;
    document.getElementById('seminovosOrderOpenedAt').value = order.openedAt ? getLocalDateTimeInputValue(new Date(order.openedAt)) : getLocalDateTimeInputValue();
    document.getElementById('seminovosOrderClosedAt').value = order.closedAt ? getLocalDateTimeInputValue(new Date(order.closedAt)) : '';
    document.getElementById('seminovosOrderDescription').value = order.description || '';
    document.getElementById('seminovosOrderNotes').value = order.notes || '';
    document.getElementById('seminovosOrderPartsContainer').innerHTML = '';
    if ((order.parts || []).length) {
      order.parts.forEach(part => addSeminovosPartRow(part));
    } else {
      addSeminovosPartRow();
    }
  }
  modal.show();
}

async function saveSeminovosOrder(event) {
  event.preventDefault();
  const id = document.getElementById('seminovosOrderId').value;
  const payload = {
    vehicleId: document.getElementById('seminovosOrderVehicleId').value,
    serviceOrderNumber: document.getElementById('seminovosOrderNumber').value.trim(),
    category: document.getElementById('seminovosOrderCategory').value,
    status: document.getElementById('seminovosOrderStatus').value,
    odometer: document.getElementById('seminovosOrderOdometer').value,
    openedAt: serializeDateTimeInputValue(document.getElementById('seminovosOrderOpenedAt').value),
    closedAt: serializeDateTimeInputValue(document.getElementById('seminovosOrderClosedAt').value),
    description: document.getElementById('seminovosOrderDescription').value,
    notes: document.getElementById('seminovosOrderNotes').value,
    parts: collectOrderParts()
  };

  try {
    await fetchJson(id ? `${SEMINOVOS_API}/service-orders/${id}` : `${SEMINOVOS_API}/service-orders`, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    bootstrap.Modal.getInstance(document.getElementById('seminovosOrderModal')).hide();
    await loadSeminovosData();
    showToast(id ? 'Ordem de serviço atualizada com sucesso' : 'Ordem de serviço registrada com sucesso', 'success');
  } catch (error) {
    showToast(error.message || 'Não foi possível salvar a ordem de serviço', 'danger');
  }
}

async function deleteSeminovosOrder(id) {
  const order = getServiceOrderById(id);
  if (!order) return;
  if (!window.confirm(`Excluir a OS ${order.serviceOrderNumber}?`)) return;
  try {
    await fetchJson(`${SEMINOVOS_API}/service-orders/${id}`, { method: 'DELETE' });
    await loadSeminovosData();
    showToast('Ordem de serviço excluída com sucesso', 'warning');
  } catch (error) {
    showToast(error.message || 'Não foi possível excluir a ordem de serviço', 'danger');
  }
}

function viewSeminovosVehicleDetails(id) {
  const vehicle = getVehicleById(id);
  if (!vehicle) return;

  const relatedOrders = seminovosServiceOrders
    .filter(order => String(order.vehicleId) === String(vehicle.id))
    .sort((a, b) => new Date(b.openedAt || 0) - new Date(a.openedAt || 0));

  const relatedParts = relatedOrders.flatMap(order => (order.parts || []).map(part => ({
    ...part,
    serviceOrderNumber: order.serviceOrderNumber,
    category: order.category
  })));

  const photosHtml = (vehicle.photos || []).length
    ? `
      <div class="row g-3">
        ${(vehicle.photos || []).map(photo => `
          <div class="col-md-4">
            <div class="surface-card h-100">
              <div class="mb-2 fw-semibold">${escapeHtml(photo.category)}</div>
              <img src="${escapeHtml(photo.filePath)}" alt="${escapeHtml(photo.category)}" class="img-fluid rounded border">
              <small class="text-muted d-block mt-2">${formatDateTimeBR(photo.createdAt || photo.updatedAt)}</small>
            </div>
          </div>
        `).join('')}
      </div>
    `
    : '<div class="empty-state"><i class="bi bi-image fs-2 d-block mb-2"></i>Nenhuma foto cadastrada para este veículo.</div>';

  const ordersHtml = relatedOrders.length
    ? `
      <div class="table-responsive">
        <table class="table align-middle">
          <thead>
            <tr>
              <th>Nº da OS</th>
              <th>Categoria</th>
              <th>Situação</th>
              <th>Odômetro</th>
              <th>Abertura</th>
              <th>Fechamento</th>
            </tr>
          </thead>
          <tbody>
            ${relatedOrders.map(order => `
              <tr>
                <td><strong>${escapeHtml(order.serviceOrderNumber)}</strong></td>
                <td>${escapeHtml(order.category)}</td>
                <td>${renderVehicleStatus(order.status)}</td>
                <td>${formatNumberBR(order.odometer)} km</td>
                <td>${formatDateTimeBR(order.openedAt)}</td>
                <td>${formatDateTimeBR(order.closedAt)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
    : '<div class="empty-state"><i class="bi bi-tools fs-2 d-block mb-2"></i>Nenhuma ordem de serviço registrada para este veículo.</div>';

  const partsHtml = relatedParts.length
    ? `
      <div class="table-responsive">
        <table class="table align-middle">
          <thead>
            <tr>
              <th>Nº da OS</th>
              <th>Categoria</th>
              <th>Peça</th>
              <th>Quantidade</th>
              <th>Observação</th>
            </tr>
          </thead>
          <tbody>
            ${relatedParts.map(part => `
              <tr>
                <td><strong>${escapeHtml(part.serviceOrderNumber)}</strong></td>
                <td>${escapeHtml(part.category)}</td>
                <td>${escapeHtml(part.partName)}</td>
                <td>${formatNumberBR(part.quantity)}</td>
                <td>${escapeHtml(part.notes || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `
    : '<div class="empty-state"><i class="bi bi-box-seam fs-2 d-block mb-2"></i>Nenhuma peça registrada para este veículo.</div>';

  document.getElementById('seminovosVehicleDetailsContent').innerHTML = `
    <div class="row g-3 mb-3">
      <div class="col-lg-8">
        <div class="surface-card h-100">
          <div class="d-flex flex-column flex-md-row justify-content-between gap-3">
            <div>
              <div class="mb-3">${renderPlate(vehicle.plate)}</div>
              <div class="d-flex flex-wrap gap-2 mb-3">
                ${renderVehicleType(vehicle.type)}
                ${renderVehicleStatus(vehicle.operationalStatus)}
                ${renderCommercialStatus(vehicle.commercialStatus)}
              </div>
            </div>
            <div class="text-md-end">
              <div class="fw-semibold">Última atualização</div>
              <small class="text-muted">${formatDateTimeBR(vehicle.updatedAt)}</small>
            </div>
          </div>
          <div class="row g-3 mt-1">
            <div class="col-md-4">
              <div class="small text-muted text-uppercase">Odômetro</div>
              <div class="fw-semibold">${formatNumberBR(vehicle.odometer)} km</div>
            </div>
            <div class="col-md-4">
              <div class="small text-muted text-uppercase">Chassi</div>
              <div class="fw-semibold">${escapeHtml(vehicle.chassis || 'Não informado')}</div>
            </div>
            <div class="col-md-4">
              <div class="small text-muted text-uppercase">Última OS</div>
              <div class="fw-semibold">${escapeHtml(vehicle.latestServiceOrderNumber || 'Sem OS')}</div>
            </div>
          </div>
          <hr>
          <div class="small text-muted text-uppercase mb-1">Observações gerais</div>
          <div>${escapeHtml(vehicle.notes || 'Sem observações registradas.')}</div>
        </div>
      </div>
      <div class="col-lg-4">
        <div class="surface-card h-100">
          <h6 class="mb-3">Resumo rápido</h6>
          <div class="d-flex justify-content-between border-bottom py-2">
            <span>Fotos cadastradas</span>
            <strong>${formatNumberBR(vehicle.photoCount || 0)}</strong>
          </div>
          <div class="d-flex justify-content-between border-bottom py-2">
            <span>Ordens registradas</span>
            <strong>${formatNumberBR(relatedOrders.length)}</strong>
          </div>
          <div class="d-flex justify-content-between py-2">
            <span>Peças lançadas</span>
            <strong>${formatNumberBR(relatedParts.length)}</strong>
          </div>
        </div>
      </div>
    </div>
    <div class="surface-card mb-3">
      <div class="section-title">
        <h6 class="mb-0"><i class="bi bi-images me-2"></i>Fotos do veículo</h6>
      </div>
      ${photosHtml}
    </div>
    <div class="surface-card mb-3">
      <div class="section-title">
        <h6 class="mb-0"><i class="bi bi-tools me-2"></i>Histórico de ordens de serviço</h6>
      </div>
      ${ordersHtml}
    </div>
    <div class="surface-card">
      <div class="section-title">
        <h6 class="mb-0"><i class="bi bi-box-seam me-2"></i>Peças utilizadas</h6>
      </div>
      ${partsHtml}
    </div>
  `;

  bootstrap.Modal.getOrCreateInstance(document.getElementById('seminovosVehicleDetailsModal')).show();
}

async function logoutSeminovos() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    console.error(error);
  }
  seminovosCurrentUser = null;
  seminovosVehicles = [];
  seminovosServiceOrders = [];
  showSeminovosLogin();
}

function bindSeminovosEvents() {
  populateSelect('seminovosVehicleType', SEMINOVOS_VEHICLE_TYPES, { placeholder: 'Selecione o tipo' });
  populateSelect('seminovosVehicleOperationalStatus', SEMINOVOS_OPERATIONAL_STATUSES);
  populateSelect('seminovosVehicleCommercialStatus', SEMINOVOS_COMMERCIAL_STATUSES);
  populateSelect('seminovosVehicleTypeFilter', SEMINOVOS_VEHICLE_TYPES, { includeAll: true, allLabel: 'Todos os tipos' });
  populateSelect('seminovosVehicleStatusFilter', SEMINOVOS_OPERATIONAL_STATUSES, { includeAll: true, allLabel: 'Todas as situações' });
  populateSelect('seminovosVehicleCommercialFilter', SEMINOVOS_COMMERCIAL_STATUSES, { includeAll: true, allLabel: 'Toda situação comercial' });
  populateSelect('seminovosOrderCategory', SEMINOVOS_SERVICE_CATEGORIES);
  populateSelect('seminovosOrderStatus', SEMINOVOS_SERVICE_STATUSES);
  populateSelect('seminovosOrderCategoryFilter', SEMINOVOS_SERVICE_CATEGORIES, { includeAll: true, allLabel: 'Todas as categorias' });
  populateSelect('seminovosOrderStatusFilter', SEMINOVOS_SERVICE_STATUSES, { includeAll: true, allLabel: 'Todas as situações' });

  document.querySelectorAll('.module-nav .nav-btn').forEach(button => {
    button.addEventListener('click', () => openView(button.dataset.view));
  });

  ['seminovosVehicleSearch', 'seminovosVehicleTypeFilter', 'seminovosVehicleStatusFilter', 'seminovosVehicleCommercialFilter'].forEach(id => {
    document.getElementById(id)?.addEventListener(id.includes('Search') ? 'input' : 'change', renderVehiclesTable);
  });

  ['seminovosOrderSearch', 'seminovosOrderCategoryFilter', 'seminovosOrderStatusFilter'].forEach(id => {
    document.getElementById(id)?.addEventListener(id.includes('Search') ? 'input' : 'change', renderOrdersTable);
  });

  document.getElementById('seminovosPartsSearch')?.addEventListener('input', renderPartsView);
  document.getElementById('btnNovoVeiculoSeminovos')?.addEventListener('click', () => openSeminovosVehicleModal());
  document.getElementById('btnNovaOSSeminovos')?.addEventListener('click', () => openSeminovosOrderModal());
  document.getElementById('btnAddSeminovosPart')?.addEventListener('click', () => addSeminovosPartRow());
  document.getElementById('btnBackToPatio')?.addEventListener('click', () => { window.location.href = '/'; });
  document.getElementById('btnSeminovosLogout')?.addEventListener('click', logoutSeminovos);
  document.getElementById('seminovosVehicleForm')?.addEventListener('submit', saveSeminovosVehicle);
  document.getElementById('seminovosOrderForm')?.addEventListener('submit', saveSeminovosOrder);
  document.getElementById('seminovosOrderVehicleId')?.addEventListener('change', (event) => {
    const vehicle = getVehicleById(event.target.value);
    if (vehicle) {
      document.getElementById('seminovosOrderOdometer').value = vehicle.odometer || 0;
    }
  });

  document.getElementById('seminovosLoginForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const errorBox = document.getElementById('seminovosLoginError');
    errorBox.classList.add('hidden');
    errorBox.textContent = '';

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: document.getElementById('seminovosLoginUsername').value.trim(),
          password: document.getElementById('seminovosLoginPassword').value
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Não foi possível fazer login');
      }
      if (!canAccessSeminovos(data.user)) {
        await fetch('/api/auth/logout', { method: 'POST' });
        throw new Error('Este usuário não tem acesso ao módulo Seminovos');
      }
      seminovosCurrentUser = data.user;
      await showSeminovosApp();
      showToast('Acesso ao módulo Seminovos liberado', 'success');
    } catch (error) {
      errorBox.textContent = error.message || 'Não foi possível fazer login';
      errorBox.classList.remove('hidden');
    }
  });
}

window.openSeminovosVehicleModal = openSeminovosVehicleModal;
window.deleteSeminovosVehicle = deleteSeminovosVehicle;
window.openSeminovosOrderModal = openSeminovosOrderModal;
window.deleteSeminovosOrder = deleteSeminovosOrder;
window.viewSeminovosVehicleDetails = viewSeminovosVehicleDetails;

document.addEventListener('DOMContentLoaded', async () => {
  bindSeminovosEvents();
  await checkSeminovosAuth();
});
