const FROTA_API = '/api/frota';

let frotaVehicles = [];
let selectedFrotaVehicleId = null;
let plateLookupTimer = null;
let lastLookupPlate = '';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function normalizePlateInput(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

function formatPlateForDisplay(value) {
  const plate = normalizePlateInput(value);
  if (/^[A-Z]{3}\d{4}$/.test(plate)) {
    const oldToMercosul = { '0': 'A', '1': 'B', '2': 'C', '3': 'D', '4': 'E', '5': 'F', '6': 'G', '7': 'H', '8': 'I', '9': 'J' };
    return `${plate.slice(0, 4)}${oldToMercosul[plate[4]] || plate[4]}${plate.slice(5)}`;
  }
  return plate || '---';
}

function getVehicleDisplayPlate(vehicle) {
  return formatPlateForDisplay(vehicle?.patioVehicle?.plate || vehicle?.plate);
}

function getPlateType(plate) {
  const cleanPlate = normalizePlateInput(plate);
  if (/^[A-Z]{3}\d{4}$/.test(cleanPlate)) return 'vermelha';
  return 'mercosul';
}

function renderFrotaPlate(plate, title = '', { forceMercosul = false } = {}) {
  const displayPlate = formatPlateForDisplay(plate);
  const cssClass = forceMercosul ? 'placa-mercosul' : (getPlateType(plate) === 'vermelha' ? 'placa-vermelha' : 'placa-mercosul');
  const safeTitle = title ? ` title="${escapeHtml(title)}"` : '';
  return `<span class="placa-container ${cssClass}"${safeTitle}><span class="placa-texto">${escapeHtml(displayPlate)}</span></span>`;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('pt-BR');
}

function showToast(message, tone = 'primary') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast align-items-center text-bg-${tone} border-0`;
  toast.role = 'status';
  toast.innerHTML = `
    <div class="d-flex">
      <div class="toast-body">${escapeHtml(message)}</div>
      <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
    </div>
  `;
  container.appendChild(toast);
  const instance = bootstrap.Toast.getOrCreateInstance(toast, { delay: 3600 });
  toast.addEventListener('hidden.bs.toast', () => toast.remove());
  instance.show();
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function updateMetrics() {
  document.getElementById('metricTotal').textContent = frotaVehicles.length;
  document.getElementById('metricOpen').textContent = frotaVehicles.filter(vehicle => vehicle.status !== 'pronto').length;
  document.getElementById('metricReady').textContent = frotaVehicles.filter(vehicle => vehicle.status === 'pronto').length;
  const openVehicles = frotaVehicles.filter(vehicle => vehicle.status !== 'pronto');
  const oldest = openVehicles
    .map(vehicle => ({ vehicle, days: getPreparationDays(vehicle) }))
    .sort((left, right) => right.days - left.days)[0];
  document.getElementById('metricOldestDays').textContent = oldest ? `${oldest.days} dias` : '0 dias';
  document.getElementById('metricOldestPlate').textContent = oldest ? getVehicleDisplayPlate(oldest.vehicle) : '-';
}

function buildUpdatesList() {
  return frotaVehicles
    .flatMap(vehicle => (vehicle.logs || []).map(log => ({ ...log, vehicle })))
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))
    .slice(0, 6);
}

function renderUpdates() {
  const updates = buildUpdatesList();
  const grid = document.getElementById('frotaUpdatesGrid');
  if (!grid) return;
  grid.innerHTML = updates.length ? updates.map(update => {
    const plate = getVehicleDisplayPlate(update.vehicle);
    const user = update.username || 'sistema';
    return `
      <article class="update-card">
        <p><strong>${escapeHtml(plate)}</strong> ${escapeHtml(update.action || 'Atualização registrada')}</p>
        <small>${escapeHtml(user)} · ${escapeHtml(formatDateTime(update.createdAt))}</small>
      </article>
    `;
  }).join('') : '<div class="empty-state py-3">Nenhuma atualização registrada.</div>';
}

function getPreparationDays(vehicle) {
  const createdAt = vehicle?.createdAt ? new Date(vehicle.createdAt) : null;
  if (!createdAt || Number.isNaN(createdAt.getTime())) return 0;
  return Math.max(1, Math.ceil((Date.now() - createdAt.getTime()) / 86400000));
}

function getAreaShortLabel(area) {
  const slug = String(area?.slug || '').toLowerCase();
  if (slug.includes('document')) return 'DOC';
  if (slug.includes('licenc')) return 'LIC';
  if (slug.includes('manut')) return 'MAN';
  if (slug.includes('rast')) return 'RAS';
  return String(area?.name || '---').slice(0, 3).toUpperCase();
}

function getAreaChipClass(area) {
  if (area.status === 'concluido') return 'done';
  if (area.completed > 0) return 'progress';
  return 'pending';
}

function renderVehicleRows() {
  const query = String(document.getElementById('frotaSearch').value || '').trim().toUpperCase();
  const cards = frotaVehicles
    .filter(vehicle => {
      const patio = vehicle.patioVehicle || {};
      return [
        vehicle.plate,
        vehicle.fleetNumber,
        vehicle.model,
        vehicle.chassis,
        patio.yard,
        patio.status
      ].filter(Boolean).join(' ').toUpperCase().includes(query);
    })
    .map(vehicle => {
      const active = String(vehicle.id) === String(selectedFrotaVehicleId) ? 'active' : '';
      const ready = vehicle.status === 'pronto';
      const statusLabel = ready ? 'Pronto' : 'Em preparacao';
      const displayPlate = getVehicleDisplayPlate(vehicle);
      const rawPlate = normalizePlateInput(vehicle.plate);
      const days = getPreparationDays(vehicle);
      const dayIcon = ready ? 'check2' : 'stopwatch';
      const dayClass = !ready && days >= 7 ? 'late' : '';
      const fleetLabel = vehicle.fleetNumber ? `Frota ${vehicle.fleetNumber}` : (vehicle.model || vehicle.patioVehicle?.type || 'Preparacao');
      const chassis = vehicle.chassis || vehicle.patioVehicle?.chassis || 'Nao informado';
      const renavam = vehicle.renavam || 'Nao informado';
      const areaChips = (vehicle.areas || []).map(area => `
        <span class="prep-area-chip ${getAreaChipClass(area)}">${escapeHtml(getAreaShortLabel(area))} ${area.completed}/${area.total}</span>
      `).join('');
      return `
        <article class="prep-vehicle-card vehicle-card ${active} ${ready ? 'ready' : ''}" data-id="${escapeHtml(vehicle.id)}">
          <div class="prep-card-hero">
            <div class="prep-card-topline">
              <span class="prep-pill ${dayClass}"><i class="bi bi-${dayIcon}"></i>${days} dias</span>
              <span class="prep-pill status">${escapeHtml(statusLabel)}</span>
            </div>
            <div class="prep-card-main">
              <div class="prep-fleet-number">${escapeHtml(fleetLabel)}</div>
              ${renderFrotaPlate(displayPlate, rawPlate && rawPlate !== displayPlate ? `Cadastro: ${rawPlate}` : displayPlate, { forceMercosul: true })}
            </div>
            <div class="prep-card-truck">
              <span class="prep-card-wheel one"></span>
              <span class="prep-card-wheel two"></span>
              <span class="prep-card-wheel three"></span>
            </div>
          </div>
          <div class="prep-card-body">
            <div class="prep-meta-row"><span>Chassi</span><strong>${escapeHtml(chassis)}</strong></div>
            <div class="prep-meta-row"><span>RENAVAM</span><strong>${escapeHtml(renavam)}</strong></div>
            <div class="prep-progress-row">
              <div class="prep-progress-track"><div class="prep-progress-fill" style="width: ${vehicle.progress || 0}%"></div></div>
              <span class="prep-progress-value">${vehicle.progress || 0}%</span>
            </div>
            <div class="prep-area-chips">${areaChips}</div>
            <div class="prep-card-actions">
              <button type="button" class="prep-open-button prep-open-checklist">Abrir checklist -></button>
              <button type="button" class="prep-icon-action prep-edit-card" title="Editar veiculo"><i class="bi bi-pencil"></i></button>
              <button type="button" class="prep-icon-action danger prep-delete-card" title="Excluir veiculo"><i class="bi bi-trash"></i></button>
            </div>
          </div>
        </article>
      `;
    }).join('');

  document.getElementById('frotaVehiclesTable').innerHTML = cards || `
    <div class="empty-state">Nenhum veiculo encontrado.</div>
  `;
}

function renderDetails(vehicle) {
  if (!vehicle) {
    document.getElementById('frotaDetails').innerHTML = `
      <div class="empty-state">
        <i class="bi bi-clipboard2-check fs-1 d-block mb-2"></i>
        Selecione um veiculo para acompanhar a preparacao.
      </div>
    `;
    return;
  }

  const patio = vehicle.patioVehicle || {};
  const displayPlate = getVehicleDisplayPlate(vehicle);
  const rawPlate = normalizePlateInput(vehicle.plate);
  const areasHtml = (vehicle.areas || []).map(area => `
    <div class="area-block">
      <div class="area-header">
        <div>
          <strong>${escapeHtml(area.name)}</strong>
          <div class="small text-muted">${area.completed}/${area.total} item(ns)</div>
        </div>
        <span class="badge ${area.status === 'concluido' ? 'text-bg-success' : area.status === 'andamento' ? 'text-bg-warning' : 'text-bg-secondary'}">${escapeHtml(area.status)}</span>
      </div>
      ${(area.items || []).map(item => `
        <div class="check-row" data-item-id="${escapeHtml(item.id)}">
          <label class="form-check d-flex align-items-center gap-2 mb-0">
            <input class="form-check-input frota-item-check" type="checkbox" ${item.completed ? 'checked' : ''}>
            <span>
              <strong>${escapeHtml(item.templateName)}</strong>
              ${item.completedBy ? `<span class="d-block small text-muted">Concluido por ${escapeHtml(item.completedBy)} ${item.completedAt ? `em ${escapeHtml(formatDateTime(item.completedAt))}` : ''}</span>` : ''}
            </span>
          </label>
          <input class="form-control form-control-sm frota-item-observation" value="${escapeHtml(item.observation || '')}" placeholder="Observacao">
          <button class="btn btn-sm btn-outline-primary frota-save-item" title="Salvar item"><i class="bi bi-check2"></i></button>
        </div>
      `).join('')}
    </div>
  `).join('');

  const logsHtml = (vehicle.logs || []).slice(0, 8).map(log => `
    <li class="list-group-item d-flex justify-content-between gap-3">
      <span>${escapeHtml(log.action)}</span>
      <small class="text-muted text-nowrap">${escapeHtml(formatDateTime(log.createdAt))}</small>
    </li>
  `).join('');

  document.getElementById('frotaDetails').innerHTML = `
    <div class="p-3 border-bottom d-flex align-items-start justify-content-between gap-3 flex-wrap">
      <div>
        <div class="d-flex align-items-center gap-2 flex-wrap">
          ${renderFrotaPlate(displayPlate, rawPlate && rawPlate !== displayPlate ? `Cadastro: ${rawPlate}` : displayPlate, { forceMercosul: true })}
          <span class="badge ${vehicle.status === 'pronto' ? 'text-bg-success' : 'text-bg-warning'}">${vehicle.status === 'pronto' ? 'Pronto' : 'Em preparacao'}</span>
        </div>
        <div class="small text-muted mt-2">
          ${escapeHtml(vehicle.model || patio.type || 'Modelo nao informado')}
          ${vehicle.chassis || patio.chassis ? ` • Chassi ${escapeHtml(vehicle.chassis || patio.chassis)}` : ''}
          ${patio.yard ? ` • ${escapeHtml(patio.yard)}` : ''}
        </div>
      </div>
      <div class="text-end" style="min-width: 210px">
        <div class="d-flex justify-content-end gap-2 mb-2">
          <button class="btn btn-sm btn-outline-primary frota-edit-vehicle" data-vehicle-id="${escapeHtml(vehicle.id)}" title="Editar veículo"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger frota-delete-vehicle" data-vehicle-id="${escapeHtml(vehicle.id)}" title="Excluir veículo"><i class="bi bi-trash"></i></button>
        </div>
        <strong class="fs-4">${vehicle.progress || 0}%</strong>
        <div class="progress mt-1" style="height: 8px"><div class="progress-bar ${vehicle.status === 'pronto' ? 'bg-success' : ''}" style="width: ${vehicle.progress || 0}%"></div></div>
      </div>
    </div>
    ${areasHtml || '<div class="empty-state">Checklist ainda nao criado para este veiculo.</div>'}
    <div class="p-3 border-top">
      <h2 class="h6 mb-2"><i class="bi bi-clock-history me-1"></i>Historico</h2>
      <ul class="list-group list-group-flush">${logsHtml || '<li class="list-group-item text-muted">Sem historico.</li>'}</ul>
    </div>
  `;
}

async function loadFrotaData({ keepSelection = true } = {}) {
  frotaVehicles = await fetchJson(`${FROTA_API}/vehicles`);
  if (!keepSelection || !frotaVehicles.some(vehicle => String(vehicle.id) === String(selectedFrotaVehicleId))) {
    selectedFrotaVehicleId = frotaVehicles[0]?.id || null;
  }
  updateMetrics();
  renderUpdates();
  renderVehicleRows();
  renderDetails(frotaVehicles.find(vehicle => String(vehicle.id) === String(selectedFrotaVehicleId)));
}

function getVehicleTypeLabel(source) {
  return String(source?.type || source?.model || source?.vehicleType || '').trim();
}

async function lookupPlate({ silent = false } = {}) {
  const plateField = document.getElementById('frotaPlate');
  const plate = normalizePlateInput(plateField.value);
  plateField.value = plate;
  if (!plate) {
    if (!silent) showToast('Informe uma placa para consultar.', 'warning');
    return;
  }

  const data = await fetchJson(`${FROTA_API}/lookup?plate=${encodeURIComponent(plate)}`);
  const hint = document.getElementById('lookupHint');
  if (data.existingPreparation) {
    hint.textContent = 'Esta placa ja esta no modulo de Preparacao de Frota.';
    if (!silent) showToast('Placa ja cadastrada na preparacao.', 'warning');
    return;
  }

  const source = data.catalogVehicle || data.patioVehicle || {};
  const vehicleType = getVehicleTypeLabel(source);
  document.getElementById('frotaFleetNumber').value = source.sourceId || '';
  document.getElementById('frotaModel').value = vehicleType;
  document.getElementById('frotaChassis').value = source.chassis || '';
  document.getElementById('frotaRenavam').value = source.renavam || '';
  hint.textContent = data.patioVehicle
    ? `Vinculo encontrado no patio: ${data.patioVehicle.yard || 'patio nao informado'} / ${data.patioVehicle.status || 'status nao informado'}${vehicleType ? ` / tipo: ${vehicleType}` : ''}.`
    : data.catalogVehicle ? `Dados encontrados no catalogo mestre${vehicleType ? ` / tipo: ${vehicleType}` : ''}.` : 'Nenhum vinculo encontrado; a placa sera cadastrada mesmo assim.';
}

function schedulePlateLookup() {
  const plate = normalizePlateInput(document.getElementById('frotaPlate').value);
  clearTimeout(plateLookupTimer);
  if (plate.length < 7) {
    document.getElementById('lookupHint').textContent = '';
    lastLookupPlate = '';
    return;
  }
  plateLookupTimer = setTimeout(async () => {
    if (plate === lastLookupPlate) return;
    lastLookupPlate = plate;
    try {
      await lookupPlate({ silent: true });
    } catch (error) {
      document.getElementById('lookupHint').textContent = error.message || 'Nao foi possivel consultar a placa.';
    }
  }, 450);
}

async function saveVehicle(event) {
  event.preventDefault();
  const payload = {
    plate: normalizePlateInput(document.getElementById('frotaPlate').value),
    fleetNumber: document.getElementById('frotaFleetNumber').value,
    model: document.getElementById('frotaModel').value,
    chassis: document.getElementById('frotaChassis').value,
    renavam: document.getElementById('frotaRenavam').value,
    notes: document.getElementById('frotaNotes').value
  };
  if (!payload.plate) {
    showToast('Placa obrigatoria.', 'warning');
    return;
  }

  const result = await fetchJson(`${FROTA_API}/vehicles`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  selectedFrotaVehicleId = result.vehicle?.id || selectedFrotaVehicleId;
  document.getElementById('frotaVehicleForm').reset();
  document.getElementById('lookupHint').textContent = '';
  await loadFrotaData();
  showToast('Veiculo incluido na preparacao de frota.', 'success');
}

async function saveItem(row) {
  const itemId = row.dataset.itemId;
  const completed = row.querySelector('.frota-item-check').checked;
  const observation = row.querySelector('.frota-item-observation').value;
  const result = await fetchJson(`${FROTA_API}/items/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify({ completed, observation })
  });
  const updatedVehicle = result.vehicle;
  frotaVehicles = frotaVehicles.map(vehicle => String(vehicle.id) === String(updatedVehicle.id) ? updatedVehicle : vehicle);
  selectedFrotaVehicleId = updatedVehicle.id;
  updateMetrics();
  renderUpdates();
  renderVehicleRows();
  renderDetails(updatedVehicle);
  showToast('Item salvo.', 'success');
}

function getSelectedVehicle() {
  return frotaVehicles.find(vehicle => String(vehicle.id) === String(selectedFrotaVehicleId)) || null;
}

function selectVehicle(vehicleId, { scrollToDetails = false } = {}) {
  selectedFrotaVehicleId = vehicleId;
  renderVehicleRows();
  renderDetails(getSelectedVehicle());
  if (scrollToDetails) {
    document.getElementById('frotaDetails')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function openEditVehicleModal(vehicle) {
  if (!vehicle) return;
  document.getElementById('frotaEditId').value = vehicle.id;
  document.getElementById('frotaEditTitle').textContent = `Editar veículo ${vehicle.plate}`;
  document.getElementById('frotaEditPlate').value = vehicle.plate || '';
  document.getElementById('frotaEditFleetNumber').value = vehicle.fleetNumber || '';
  document.getElementById('frotaEditModel').value = vehicle.model || vehicle.patioVehicle?.type || '';
  document.getElementById('frotaEditChassis').value = vehicle.chassis || vehicle.patioVehicle?.chassis || '';
  document.getElementById('frotaEditRenavam').value = vehicle.renavam || '';
  document.getElementById('frotaEditPurchaseDate').value = vehicle.purchaseDate ? String(vehicle.purchaseDate).slice(0, 10) : '';
  document.getElementById('frotaEditNotes').value = vehicle.notes || '';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('frotaEditModal')).show();
}

async function saveEditedVehicle(event) {
  event.preventDefault();
  const id = document.getElementById('frotaEditId').value;
  const result = await fetchJson(`${FROTA_API}/vehicles/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      fleetNumber: document.getElementById('frotaEditFleetNumber').value,
      model: document.getElementById('frotaEditModel').value,
      chassis: document.getElementById('frotaEditChassis').value,
      renavam: document.getElementById('frotaEditRenavam').value,
      purchaseDate: document.getElementById('frotaEditPurchaseDate').value,
      notes: document.getElementById('frotaEditNotes').value
    })
  });
  const updatedVehicle = result.vehicle;
  frotaVehicles = frotaVehicles.map(vehicle => String(vehicle.id) === String(updatedVehicle.id) ? updatedVehicle : vehicle);
  selectedFrotaVehicleId = updatedVehicle.id;
  bootstrap.Modal.getInstance(document.getElementById('frotaEditModal'))?.hide();
  updateMetrics();
  renderUpdates();
  renderVehicleRows();
  renderDetails(updatedVehicle);
  showToast('Veículo atualizado.', 'success');
}

async function deleteSelectedVehicle(vehicle) {
  if (!vehicle) return;
  if (!window.confirm(`Excluir o veículo ${vehicle.plate} da Preparação de Frota? O checklist e o histórico deste módulo serão removidos.`)) return;
  await fetchJson(`${FROTA_API}/vehicles/${vehicle.id}`, { method: 'DELETE' });
  frotaVehicles = frotaVehicles.filter(item => String(item.id) !== String(vehicle.id));
  selectedFrotaVehicleId = frotaVehicles[0]?.id || null;
  updateMetrics();
  renderUpdates();
  renderVehicleRows();
  renderDetails(getSelectedVehicle());
  showToast('Veículo excluído da preparação.', 'warning');
}

function bindEvents() {
  document.getElementById('btnBackToPatio').addEventListener('click', () => { window.location.href = '/'; });
  document.getElementById('btnRefreshFrota').addEventListener('click', () => loadFrotaData().then(() => showToast('Modulo atualizado.', 'success')));
  document.getElementById('btnLookupPlate').addEventListener('click', () => lookupPlate().catch(error => showToast(error.message, 'danger')));
  document.getElementById('frotaVehicleForm').addEventListener('submit', event => saveVehicle(event).catch(error => showToast(error.message, 'danger')));
  document.getElementById('frotaEditForm').addEventListener('submit', event => saveEditedVehicle(event).catch(error => showToast(error.message, 'danger')));
  document.getElementById('frotaPlate').addEventListener('input', event => {
    event.target.value = normalizePlateInput(event.target.value);
    schedulePlateLookup();
  });
  document.getElementById('frotaSearch').addEventListener('input', renderVehicleRows);
  document.getElementById('frotaVehiclesTable').addEventListener('click', event => {
    const card = event.target.closest('.vehicle-card');
    if (!card) return;
    const vehicleId = card.dataset.id;
    const vehicle = frotaVehicles.find(item => String(item.id) === String(vehicleId));
    if (event.target.closest('.prep-edit-card')) {
      selectVehicle(vehicleId);
      openEditVehicleModal(vehicle);
      return;
    }
    if (event.target.closest('.prep-delete-card')) {
      selectVehicle(vehicleId);
      deleteSelectedVehicle(vehicle).catch(error => showToast(error.message, 'danger'));
      return;
    }
    selectVehicle(vehicleId, { scrollToDetails: Boolean(event.target.closest('.prep-open-checklist')) });
  });
  document.getElementById('frotaDetails').addEventListener('click', event => {
    const editButton = event.target.closest('.frota-edit-vehicle');
    if (editButton) {
      openEditVehicleModal(getSelectedVehicle());
      return;
    }
    const deleteButton = event.target.closest('.frota-delete-vehicle');
    if (deleteButton) {
      deleteSelectedVehicle(getSelectedVehicle()).catch(error => showToast(error.message, 'danger'));
      return;
    }
    const button = event.target.closest('.frota-save-item');
    if (!button) return;
    const row = button.closest('[data-item-id]');
    saveItem(row).catch(error => showToast(error.message, 'danger'));
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  try {
    const auth = await fetchJson('/api/auth/me');
    if (!auth.authenticated) {
      window.location.href = '/';
      return;
    }
    await loadFrotaData({ keepSelection: false });
  } catch (error) {
    showToast(error.message || 'Nao foi possivel carregar o modulo.', 'danger');
  }
});
