const API = {
    clients: '/api/clients',
    limit:   '/api/limit',
    kill:    '/api/kill',
};

let timer = null;
let clients = [];
let selectedClientId = null;

const $ = (sel, ctx) => (ctx || document).querySelector(sel);
const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

// ---------- Formatting ----------
function formatBytes(b) {
    if (b === 0) return '0 B';
    const units = ['B', 'K', 'M', 'G', 'T'];
    const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), units.length - 1);
    const v = b / Math.pow(1024, i);
    return v < 10 ? v.toFixed(1) + ' ' + units[i] : Math.round(v) + ' ' + units[i];
}

function formatLimit(limit, unlimit) {
    if (unlimit) return '∞';
    if (limit <= 0) return '0 B/s';
    return formatBytes(Math.round(limit)) + '/s';
}

function formatTime(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function formatDuration(iso) {
    if (!iso) return '-';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 1000) return '0s';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d}d ${h%24}h`;
    if (h > 0) return `${h}h ${m%60}m`;
    if (m > 0) return `${m}m ${s%60}s`;
    return `${s}s`;
}

function escapeHTML(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ---------- API ----------
async function fetchClients() {
    try {
        const res = await fetch(API.clients);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        setStatus('connected');
        clients = data.sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));
        renderTable(clients);
        updateTraffic(clients);
        updateClientCount(clients.length);
        if (selectedClientId && !clients.find(c => c.id === selectedClientId)) {
            selectedClientId = null;
        }
        if (!selectedClientId && clients.length > 0) {
            selectedClientId = clients[0].id;
            renderTable(clients);
        }
        renderStreamPane();
    } catch (err) {
        setStatus('disconnected');
        console.warn('fetchClients error:', err);
        clients = [];
        renderTable(clients);
        updateTraffic([]);
        updateClientCount(0);
        selectedClientId = null;
        renderStreamPane();
    }
}

async function setLimit(id, limit) {
    try {
        const url = API.limit + '?id=' + encodeURIComponent(id) + '&limit=' + encodeURIComponent(limit);
        const res = await fetch(url);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        await fetchClients();
    } catch (err) {
        console.error('setLimit failed:', err);
    }
}

async function killStream(clientId, streamId) {
    try {
        const url = API.kill + '?id=' + encodeURIComponent(clientId) + '&sid=' + encodeURIComponent(streamId);
        await fetch(url);
        await fetchClients();
    } catch (err) {
        console.error('killStream failed:', err);
    }
}

// ---------- Status ----------
function setStatus(state) {
    const dot = $('#statusDot');
    const text = $('#statusText');
    dot.className = 'status-dot ' + state;
    text.textContent = state === 'connected' ? '已连接' : '未连接';
}

// ---------- Traffic ----------
function updateTraffic(data) {
    let totalRX = 0, totalTX = 0;
    for (const c of data) {
        totalRX += c.rx || 0;
        totalTX += c.tx || 0;
    }
    $('#totalRX').textContent = formatBytes(totalRX);
    $('#totalTX').textContent = formatBytes(totalTX);
}

function updateClientCount(n) {
    $('#clientCount').textContent = n;
}

// ---------- Client table ----------
function renderTable(data) {
    const tbody = $('#clientBody');
    const filter = ($('#searchInput').value || '').toLowerCase();

    let filtered = data;
    if (filter) {
        filtered = data.filter(c =>
            c.id.toLowerCase().includes(filter) ||
            c.protocol.toLowerCase().includes(filter) ||
            c.module.toLowerCase().includes(filter)
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="8">' +
            (data.length === 0 ? '等待客户端连接...' : '无匹配的客户端') +
            '</td></tr>';
        return;
    }

    if (tbody.querySelector('tr[data-id]')) {
        updateExistingRows(tbody, filtered);
        return;
    }

    tbody.innerHTML = filtered.map(c => rowHTML(c)).join('');
    bindClientEvents();
}

function rowHTML(c) {
    const protoClass = (c.protocol || '').toLowerCase();
    const limitClass = c.unlimit ? 'unlimited' : 'limited';
    const limitText = formatLimit(c.limit, c.unlimit);
    const isSelected = selectedClientId === c.id;

    return `
    <tr data-id="${escapeHTML(c.id)}" class="${isSelected ? 'selected' : ''}">
        <td class="col-id">${escapeHTML(c.id)}</td>
        <td class="col-proto"><span class="proto-badge ${protoClass}">${escapeHTML(c.protocol)}</span></td>
        <td class="col-module">${escapeHTML(c.module)}</td>
        <td class="col-connected">${formatTime(c.connected_at)}</td>
        <td class="col-limit">
            <span class="limit-badge ${limitClass}" data-id="${escapeHTML(c.id)}" data-limit="${c.limit}" data-unlimit="${c.unlimit}">
                ${limitText}
                <span class="limit-edit-icon">✎</span>
            </span>
        </td>
        <td class="col-rx">${formatBytes(c.rx || 0)}</td>
        <td class="col-tx">${formatBytes(c.tx || 0)}</td>
        <td class="col-streams">${c.active || 0}<span class="text-muted">/${c.cumulative || 0}</span></td>
    </tr>`;
}

function updateExistingRows(tbody, filtered) {
    const existing = tbody.querySelectorAll('tr[data-id]');
    const map = new Map();
    existing.forEach(el => map.set(el.dataset.id, el));

    let prevSibling = null;
    for (const c of filtered) {
        let row = map.get(c.id);
        if (!row) {
            row = document.createElement('tr');
            row.dataset.id = c.id;
        }

        row.className = selectedClientId === c.id ? 'selected' : '';
        row.innerHTML = rowHTML(c);

        row.addEventListener('click', onClientClick);
        map.delete(c.id);

        if (prevSibling) {
            if (prevSibling.nextElementSibling !== row) {
                tbody.insertBefore(row, prevSibling.nextElementSibling);
            }
        } else {
            if (tbody.firstElementChild !== row) {
                tbody.insertBefore(row, tbody.firstElementChild);
            }
        }
        prevSibling = row;
    }

    for (const [, el] of map) {
        el.remove();
    }
    bindClientEvents();
}

function bindClientEvents() {
    $$('#clientBody tr[data-id]').forEach(el => {
        el.addEventListener('click', onClientClick);
    });
    $$('.limit-badge').forEach(el => {
        el.addEventListener('click', openLimitModal);
    });
}

// ---------- Client selection ----------
function onClientClick(e) {
    if (e.target.closest('.limit-badge')) return;
    const row = e.currentTarget;
    selectedClientId = row.dataset.id;
    $$('#clientBody tr').forEach(r => r.classList.remove('selected'));
    row.classList.add('selected');
    renderStreamPane();
}

// ---------- Stream pane ----------
function renderStreamPane() {
    const title = $('#streamPaneTitle');
    const empty = $('#streamEmpty');
    const table = $('#streamTable');
    const tbody = $('#streamBody');

    if (!selectedClientId) {
        title.textContent = '子流列表';
        empty.style.display = '';
        table.style.display = 'none';
        return;
    }

    const client = clients.find(c => c.id === selectedClientId);
    if (!client) {
        title.textContent = '子流列表';
        empty.style.display = '';
        table.style.display = 'none';
        return;
    }

    title.textContent = '客户端 ' + client.id + ' - 子流 (' + (client.active || 0) + ')';
    empty.style.display = 'none';
    table.style.display = '';

    if (!client.streams || client.streams.length === 0) {
        tbody.innerHTML = '<tr class="empty-row"><td colspan="6">暂无活跃子流</td></tr>';
        return;
    }

    const sorted = [...client.streams].sort((a, b) => (a.id || 0) - (b.id || 0));

    if (tbody.querySelector('tr[data-sid]')) {
        updateStreamRows(tbody, sorted, client);
    } else {
        tbody.innerHTML = sorted.map(s => streamRowHTML(s, client)).join('');
    }
}

function streamRowHTML(s, client) {
    const id = s.id || '-';
    const rx = formatBytes(s.rx || 0);
    const tx = formatBytes(s.tx || 0);
    const time = formatTime(s.established_at);
    const dur = formatDuration(s.established_at);
    return `<tr data-sid="${escapeHTML(String(id))}">
        <td class="col-sid">${escapeHTML(String(id))}</td>
        <td class="col-srx">${rx}</td>
        <td class="col-stx">${tx}</td>
        <td class="col-stime">${time}</td>
        <td class="col-sdur">${dur}</td>
        <td class="col-skill"><button class="kill-btn" data-client="${escapeHTML(client.id)}" data-sid="${id}">结束</button></td>
    </tr>`;
}

function updateStreamRows(tbody, sorted, client) {
    const existing = tbody.querySelectorAll('tr[data-sid]');
    const map = new Map();
    existing.forEach(el => map.set(el.dataset.sid, el));

    let prev = null;
    for (const s of sorted) {
        const sid = String(s.id || '');
        let row = map.get(sid);
        if (!row) {
            row = document.createElement('tr');
            row.dataset.sid = sid;
            tbody.insertBefore(row, prev ? prev.nextElementSibling : tbody.firstElementChild);
        } else {
            map.delete(sid);
        }
        row.innerHTML = streamRowHTML(s, client);

        if (prev) {
            if (prev.nextElementSibling !== row) {
                tbody.insertBefore(row, prev.nextElementSibling);
            }
        } else {
            if (tbody.firstElementChild !== row) {
                tbody.insertBefore(row, tbody.firstElementChild);
            }
        }
        prev = row;
    }

    for (const [, el] of map) {
        el.remove();
    }
}

// ---------- Kill stream (event delegation) ----------
document.addEventListener('click', (e) => {
    const btn = e.target.closest('.kill-btn');
    if (!btn) return;
    killStream(btn.dataset.client, btn.dataset.sid);
});

// ---------- Limit modal ----------
let modalTargetId = null;

function parseLimitValue(limit, unlimit) {
    if (unlimit) return { val: '', unit: 'inf' };
    const num = Math.round(parseFloat(limit));
    if (num < 1024) return { val: String(num), unit: 'K' };
    if (num < 1024 * 1024) return { val: (num / 1024).toFixed(0), unit: 'K' };
    return { val: (num / (1024 * 1024)).toFixed(1), unit: 'M' };
}

function openLimitModal(e) {
    e.stopPropagation();
    const target = e.currentTarget;
    const id = target.dataset.id || target.closest('[data-id]')?.dataset.id;
    if (!id) return;

    modalTargetId = id;
    $('#modalClientId').textContent = id;

    const badge = document.querySelector(`.limit-badge[data-id="${id}"]`);
    if (badge) {
        const pv = parseLimitValue(badge.dataset.limit, badge.dataset.unlimit === 'true');
        $('#modalLimit').value = pv.val;
        $('#modalUnit').value = pv.unit;
    } else {
        $('#modalLimit').value = '10';
        $('#modalUnit').value = 'M';
    }

    syncLimitDisabled();
    $('#limitModal').classList.add('open');
    if (!$('#modalLimit').disabled) {
        $('#modalLimit').focus();
        $('#modalLimit').select();
    }
}

function syncLimitDisabled() {
    const disabled = $('#modalUnit').value === 'inf';
    $('#modalLimit').disabled = disabled;
}

function closeLimitModal() {
    $('#limitModal').classList.remove('open');
    modalTargetId = null;
}

function applyLimit() {
    if (!modalTargetId) return;
    const unit = $('#modalUnit').value;
    let val;
    if (unit === 'inf') {
        val = 'inf';
    } else {
        const num = $('#modalLimit').value.trim();
        if (!num) return;
        val = num + unit;
    }
    setLimit(modalTargetId, val);
    closeLimitModal();
}

// ---------- Events ----------
$('#btnRefresh').addEventListener('click', () => fetchClients());

$('#refreshInterval').addEventListener('change', restartAutoRefresh);

$('#searchInput').addEventListener('input', () => {
    renderTable(clients);
});

$$('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        $$('.nav-item').forEach(n => n.classList.remove('active'));
        item.classList.add('active');
        $$('.view').forEach(v => v.classList.remove('active'));
        const view = $('#view-' + item.dataset.view);
        if (view) view.classList.add('active');
    });
});

$('#modalClose').addEventListener('click', closeLimitModal);
$('#modalCancel').addEventListener('click', closeLimitModal);
$('#modalApply').addEventListener('click', applyLimit);
$('#limitModal').addEventListener('click', (e) => {
    if (e.target === $('#limitModal')) closeLimitModal();
});
$('#modalLimit').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyLimit();
    if (e.key === 'Escape') closeLimitModal();
});
$('#modalUnit').addEventListener('change', syncLimitDisabled);

// ---------- Auto refresh ----------
function startAutoRefresh() {
    stopAutoRefresh();
    const sec = parseInt($('#refreshInterval').value, 10);
    if (sec <= 0) {
        $('#refreshInfo').textContent = '手动';
        return;
    }
    $('#refreshInfo').textContent = sec + 's 刷新';
    timer = setInterval(fetchClients, sec * 1000);
}

function stopAutoRefresh() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

function restartAutoRefresh() {
    stopAutoRefresh();
    startAutoRefresh();
}

// ---------- Init ----------
fetchClients();
startAutoRefresh();
