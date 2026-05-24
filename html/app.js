const API = {
    clients: '/api/clients',
    limit: '/api/limit',
    kill: '/api/kill',
}

let timer = null
let clients = []
let selectedId = null
let drawerOpen = false

const $ = (s, c) => (c || document).querySelector(s)
const $$ = (s, c) => Array.from((c || document).querySelectorAll(s))

function fmtBytes(b) {
    if (b === 0) return '0 B'
    const u = ['B', 'K', 'M', 'G', 'T']
    const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1)
    const v = b / Math.pow(1024, i)
    return v < 10 ? v.toFixed(1) + ' ' + u[i] : Math.round(v) + ' ' + u[i]
}

function fmtLimit(limit, unlimit) {
    if (unlimit) return '\u221e'
    if (limit <= 0) return '0 B/s'
    return fmtBytes(Math.round(limit)) + '/s'
}

function fmtTime(iso) {
    if (!iso) return '-'
    const d = new Date(iso)
    const p = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function fmtDuration(iso) {
    if (!iso) return '-'
    const ms = Date.now() - new Date(iso).getTime()
    if (ms < 1000) return '0s'
    const s = Math.floor(ms / 1000)
    const m = Math.floor(s / 60)
    const h = Math.floor(m / 60)
    const d = Math.floor(h / 24)
    if (d > 0) return `${d}d ${h % 24}h`
    if (h > 0) return `${h}h ${m % 60}m`
    if (m > 0) return `${m}m ${s % 60}s`
    return `${s}s`
}

function esc(s) {
    const d = document.createElement('div')
    d.textContent = s
    return d.innerHTML
}

async function fetchClients() {
    try {
        const r = await fetch(API.clients)
        if (!r.ok) throw new Error('HTTP ' + r.status)
        const data = await r.json()
        setLive(true)
        clients = data.sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10))
        renderCards(clients)
        updateTraffic(clients)
        updateCount(clients.length)
        if (selectedId && !clients.find(c => c.id === selectedId)) {
            selectedId = null
        }
        updateDrawer()
    } catch (e) {
        setLive(false)
        clients = []
        renderCards([])
        updateTraffic([])
        updateCount(0)
        selectedId = null
        updateDrawer()
    }
}

async function setLimit(id, limit) {
    try {
        const url = API.limit + '?id=' + encodeURIComponent(id) + '&limit=' + encodeURIComponent(limit)
        const r = await fetch(url)
        if (!r.ok) throw new Error('HTTP ' + r.status)
        await fetchClients()
    } catch (e) {
        console.error('setLimit:', e)
    }
}

async function killStream(cid, sid) {
    try {
        const url = API.kill + '?id=' + encodeURIComponent(cid) + '&sid=' + encodeURIComponent(sid)
        await fetch(url)
        await fetchClients()
    } catch (e) {
        console.error('killStream:', e)
    }
}

function setLive(on) {
    const dot = $('#liveDot')
    const txt = $('#statusText')
    dot.className = 'live-indicator ' + (on ? 'on' : 'off')
    txt.textContent = on ? '已连接' : '未连接'
}

function updateTraffic(data) {
    let rx = 0, tx = 0
    for (const c of data) {
        rx += c.rx || 0
        tx += c.tx || 0
    }
    $('#totalRX').textContent = fmtBytes(rx)
    $('#totalTX').textContent = fmtBytes(tx)
}

function updateCount(n) {
    $('#clientCount').textContent = n
}

const cardMap = new Map()

function renderCards(data) {
    const grid = $('#clientGrid')
    const filter = ($('#searchInput').value || '').toLowerCase()

    let filtered = data
    if (filter) {
        filtered = data.filter(c =>
            c.id.toLowerCase().includes(filter) ||
            c.protocol.toLowerCase().includes(filter) ||
            c.module.toLowerCase().includes(filter)
        )
    }

    if (filtered.length === 0) {
        cardMap.clear()
        if (data.length === 0) {
            grid.innerHTML = '<div class="empty-state"><div class="empty-icon">\u25c8</div><div class="empty-title">等待客户端连接...</div><div class="empty-sub">客户端连接后将在此处显示</div></div>'
        } else {
            grid.innerHTML = ''
        }
        return
    }

    for (const [id, el] of cardMap) {
        if (!filtered.some(c => c.id === id)) {
            el.remove()
            cardMap.delete(id)
        }
    }

    if (cardMap.size === 0) {
        grid.innerHTML = ''
    }

    let prev = null
    for (const c of filtered) {
        let card = cardMap.get(c.id)
        if (!card) {
            card = document.createElement('div')
            card.dataset.id = c.id
            card.addEventListener('click', onCardClick)
            cardMap.set(c.id, card)
        }
        updateCardContent(card, c)

        if (prev) {
            if (prev.nextElementSibling !== card) {
                grid.insertBefore(card, prev.nextElementSibling)
            }
        } else {
            if (grid.firstElementChild !== card) {
                grid.insertBefore(card, grid.firstElementChild)
            }
        }
        prev = card
    }

    bindLimitEvents()
}

function updateCardContent(card, c) {
    const pc = (c.protocol || '').toLowerCase()
    const lc = c.unlimit ? 'unlimited' : 'limited'
    const lt = fmtLimit(c.limit, c.unlimit)
    const streams = (c.active || 0) + '/' + (c.cumulative || 0)

    card.className = 'card' + (selectedId === c.id ? ' selected' : '')

    let top = card.querySelector('.card-top')
    if (!top) {
        card.innerHTML = `
            <div class="card-top">
                <span class="card-id-label">客户端 ID：</span>
                <span class="card-id"></span>
                <span class="card-proto"></span>
            </div>
            <div class="card-body">
                <div class="card-field"><span class="card-field-label">模块</span><span class="card-field-val"></span></div>
                <div class="card-field"><span class="card-field-label">连接时间</span><span class="card-field-val"></span></div>
                <div class="card-field"><span class="card-field-label"><span class="arrow-dn">▼</span> RX</span><span class="card-field-val highlight"></span></div>
                <div class="card-field"><span class="card-field-label"><span class="arrow-up">▲</span> TX</span><span class="card-field-val highlight"></span></div>
            </div>
            <div class="card-bottom">
                <span class="card-bottom-group">
                    <span class="card-bottom-label">限流</span>
                    <span class="card-limit" data-id="${esc(c.id)}"></span>
                </span>
                <span class="card-streams"></span>
            </div>`
        top = card.querySelector('.card-top')
    }

    card.querySelector('.card-id').textContent = c.id
    const protoEl = card.querySelector('.card-proto')
    protoEl.className = 'card-proto ' + pc
    protoEl.textContent = c.protocol

    const vals = card.querySelectorAll('.card-body .card-field-val')
    vals[0].textContent = c.module
    vals[1].textContent = fmtTime(c.connected_at)
    vals[2].textContent = fmtBytes(c.rx || 0)
    vals[3].textContent = fmtBytes(c.tx || 0)

    const limitEl = card.querySelector('.card-limit')
    limitEl.className = 'card-limit ' + lc
    limitEl.dataset.id = c.id
    limitEl.dataset.limit = c.limit
    limitEl.dataset.unlimit = c.unlimit
    limitEl.innerHTML = lt + '<span class="edit-icon"><svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M11.5 2.5l2 2L6 12H4v-2z"/><path d="M9.5 4.5l2 2"/></svg></span>'

    card.querySelector('.card-streams').innerHTML = '<strong>' + streams + '</strong> 个子流'
}

function bindLimitEvents() {
}

function onCardClick(e) {
    if (e.target.closest('.card-limit')) return
    const card = e.currentTarget
    const id = card.dataset.id
    if (selectedId === id) {
        selectedId = null
    } else {
        selectedId = id
    }
    $$('#clientGrid .card').forEach(c => c.classList.toggle('selected', c.dataset.id === selectedId))
    updateDrawer()
}

function updateDrawer() {
    const title = $('#drawerTitle')
    const extra = $('#drawerExtra')
    const empty = $('#drawerEmpty')
    const table = $('#streamTable')
    const body = $('#streamBody')

    if (!selectedId) {
        title.textContent = '子流列表'
        extra.textContent = ''
        empty.style.display = ''
        table.style.display = 'none'
        closeDrawer()
        return
    }

    const client = clients.find(c => c.id === selectedId)
    if (!client) {
        title.textContent = '子流列表'
        extra.textContent = ''
        empty.style.display = ''
        table.style.display = 'none'
        return
    }

    title.textContent = '客户端 ' + client.id
    extra.textContent = client.active + ' 个活跃子流'
    openDrawer()

    if (!client.streams || client.streams.length === 0) {
        empty.style.display = ''
        table.style.display = 'none'
        return
    }

    empty.style.display = 'none'
    table.style.display = ''
    const sorted = [...client.streams].sort((a, b) => (a.id || 0) - (b.id || 0))
    body.innerHTML = sorted.map(s => streamRow(s, client)).join('')
}

function streamRow(s, client) {
    const id = s.id || '-'
    return `<tr data-sid="${esc(String(id))}">
        <td>${esc(String(id))}</td>
        <td>${fmtBytes(s.rx || 0)}</td>
        <td>${fmtBytes(s.tx || 0)}</td>
        <td>${fmtTime(s.established_at)}</td>
        <td>${fmtDuration(s.established_at)}</td>
        <td><button class="stream-kill" data-client="${esc(client.id)}" data-sid="${id}">\u2715 结束</button></td>
    </tr>`
}

document.addEventListener('click', e => {
    const btn = e.target.closest('.stream-kill')
    if (btn) {
        killStream(btn.dataset.client, btn.dataset.sid)
        return
    }
    const badge = e.target.closest('.card-limit')
    if (badge) {
        e.stopPropagation()
        const id = badge.dataset.id || badge.closest('[data-id]').dataset.id
        if (id) openLimitModalFor(id)
    }
})

let drawerDragH = 420

function openDrawer() {
    if (drawerOpen) return
    drawerOpen = true
    const d = $('#drawer')
    d.classList.add('open')
    d.style.height = drawerDragH + 'px'
}

function closeDrawer() {
    if (!drawerOpen) return
    drawerOpen = false
    $('#drawer').classList.remove('open')
}

const drawerBar = $('#drawerBar')
let dragging = false
let dragStartY = 0
let dragStartH = 0

drawerBar.addEventListener('mousedown', e => {
    if (!drawerOpen) return
    dragging = true
    dragStartY = e.clientY
    dragStartH = drawerDragH
    const d = $('#drawer')
    d.classList.add('resizing')
    d.style.transition = 'none'
    document.body.style.cursor = 'ns-resize'
})

document.addEventListener('mousemove', e => {
    if (!dragging) return
    const delta = dragStartY - e.clientY
    const h = Math.max(80, Math.min(dragStartH + delta, window.innerHeight * 0.6))
    drawerDragH = h
    $('#drawer').style.height = h + 'px'
})

document.addEventListener('mouseup', () => {
    if (!dragging) return
    dragging = false
    const d = $('#drawer')
    d.classList.remove('resizing')
    d.style.transition = ''
    document.body.style.cursor = ''
})

let modalId = null

function parseLimit(limit, unlimit) {
    if (unlimit) return {val: '', unit: 'inf'}
    const num = Math.round(parseFloat(limit))
    if (num < 1024) return {val: String(num), unit: 'K'}
    if (num < 1024 * 1024) return {val: (num / 1024).toFixed(0), unit: 'K'}
    return {val: (num / (1024 * 1024)).toFixed(1), unit: 'M'}
}

function openLimitModalFor(id) {
    if (!id) return
    modalId = id
    $('#modalClientId').textContent = id

    const badge = document.querySelector(`.card-limit[data-id="${id}"]`)
    if (badge) {
        const pv = parseLimit(badge.dataset.limit, badge.dataset.unlimit === 'true')
        $('#modalLimit').value = pv.val
        $('#modalUnit').value = pv.unit
    } else {
        $('#modalLimit').value = '10'
        $('#modalUnit').value = 'M'
    }

    syncLimitDisabled()
    $('#limitModal').classList.add('open')
    if (!$('#modalLimit').disabled) {
        $('#modalLimit').focus()
        $('#modalLimit').select()
    }
}

function syncLimitDisabled() {
    const d = $('#modalUnit').value === 'inf'
    $('#modalLimit').disabled = d
}

function closeModal() {
    $('#limitModal').classList.remove('open')
    modalId = null
}

function applyLimit() {
    if (!modalId) return
    const unit = $('#modalUnit').value
    let val
    if (unit === 'inf') {
        val = 'inf'
    } else {
        const num = $('#modalLimit').value.trim()
        if (!num) return
        val = num + unit
    }
    setLimit(modalId, val)
    closeModal()
}

$('#btnRefresh').addEventListener('click', () => fetchClients())
$('#refreshInterval').addEventListener('change', restartAutoRefresh)
$('#searchInput').addEventListener('input', () => renderCards(clients))

$$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        $$('.tab').forEach(t => t.classList.remove('active'))
        tab.classList.add('active')
        $$('.view').forEach(v => v.classList.remove('active'))
        const view = $('#view-' + tab.dataset.view)
        if (view) view.classList.add('active')
    })
})

$('#modalClose').addEventListener('click', closeModal)
$('#modalCancel').addEventListener('click', closeModal)
$('#modalApply').addEventListener('click', applyLimit)
$('#limitModal').addEventListener('click', e => {
    if (e.target === $('#limitModal')) closeModal()
})
$('#modalLimit').addEventListener('keydown', e => {
    if (e.key === 'Enter') applyLimit()
    if (e.key === 'Escape') closeModal()
})
$('#modalUnit').addEventListener('change', syncLimitDisabled)

function startAutoRefresh() {
    stopAutoRefresh()
    const sec = parseInt($('#refreshInterval').value, 10)
    if (sec <= 0) {
        $('#refreshInfo').textContent = '手动'
        return
    }
    $('#refreshInfo').textContent = sec + 's'
    timer = setInterval(fetchClients, sec * 1000)
}

function stopAutoRefresh() {
    if (timer) {
        clearInterval(timer)
        timer = null
    }
}

function restartAutoRefresh() {
    stopAutoRefresh()
    startAutoRefresh()
}

fetchClients()
startAutoRefresh()
