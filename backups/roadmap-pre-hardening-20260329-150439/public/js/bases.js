const state = {
    bases: [],
    filtered: [],
    canManage: false
};

const alertHost = document.getElementById('alertHost');
const baseForm = document.getElementById('baseForm');
const baseNameInput = document.getElementById('baseName');
const submitBtn = document.getElementById('submitBtn');
const resetBtn = document.getElementById('resetBtn');
const searchInput = document.getElementById('searchInput');
const baseList = document.getElementById('baseList');
const emptyState = document.getElementById('emptyState');
const baseCount = document.getElementById('baseCount');
const authNotice = document.getElementById('authNotice');

function showAlert(message, type = 'success') {
    alertHost.innerHTML = `
        <div class="alert alert-${type} alert-dismissible fade show" role="alert">
            ${message}
            <button type="button" class="btn-close" onclick="this.parentElement.remove()" aria-label="Fechar"></button>
        </div>
    `;
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

async function apiFetch(url, options = {}) {
    const response = await fetch(url, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Erro na comunicação com o servidor');
    return data;
}

function updatePermissionsUi() {
    baseForm.hidden = !state.canManage;
    authNotice.hidden = state.canManage;
    authNotice.textContent = 'Somente administradores podem cadastrar novas bases. A lista abaixo continua disponível para consulta.';
    submitBtn.disabled = !state.canManage;
    resetBtn.disabled = !state.canManage;
}

async function loadAuth() {
    try {
        const auth = await apiFetch('/api/auth/me');
        state.canManage = Boolean(auth.authenticated && auth.permissions?.canManage);
    } catch (error) {
        state.canManage = false;
    }

    updatePermissionsUi();
}

async function loadBases() {
    state.bases = await apiFetch('/api/bases');
    applyFilter();
}

function applyFilter() {
    const term = searchInput.value.trim().toLowerCase();
    state.filtered = state.bases.filter(item => {
        if (!term) return true;
        return String(item.name || '').toLowerCase().includes(term);
    });
    renderBases();
}

function renderBases() {
    baseCount.textContent = `${state.bases.length} base${state.bases.length === 1 ? '' : 's'}`;

    if (!state.filtered.length) {
        baseList.innerHTML = '';
        emptyState.hidden = false;
        return;
    }

    emptyState.hidden = true;
    baseList.innerHTML = state.filtered.map((item, index) => `
        <div class="base-chip">
            <span class="base-chip-index">${index + 1}</span>
            <span>${escapeHtml(item.name)}</span>
        </div>
    `).join('');
}

function resetForm() {
    baseForm.reset();
    baseNameInput.focus();
}

baseForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.canManage) return;

    try {
        await apiFetch('/api/bases', {
            method: 'POST',
            body: JSON.stringify({ name: baseNameInput.value })
        });
        showAlert('Base cadastrada com sucesso.');
        resetForm();
        await loadBases();
    } catch (error) {
        showAlert(error.message, 'danger');
    }
});

resetBtn.addEventListener('click', resetForm);
searchInput.addEventListener('input', applyFilter);

async function init() {
    try {
        await loadAuth();
        await loadBases();
    } catch (error) {
        showAlert(error.message, 'danger');
        emptyState.hidden = false;
        emptyState.textContent = 'Falha ao carregar o cadastro de bases.';
    }
}

init();
