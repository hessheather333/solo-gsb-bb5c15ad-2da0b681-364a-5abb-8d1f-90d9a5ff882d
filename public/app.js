'use strict';

/* 小剧场走台排程前端逻辑（原生 JS，无构建步骤） */

const $ = (sel) => document.querySelector(sel);

let state = { cues: [], cycles: [], hasCycle: false };
let editingId = null;

// ---------- 时间工具：分钟数 <-> HH:MM ----------
function strToMin(s) {
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function minToStr(min) {
  if (min == null) return '—';
  const day = Math.floor(min / 1440);
  const m = min % 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return (day > 0 ? `次日 ${hh}:${mm}` : `${hh}:${mm}`);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------- API ----------
async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `请求失败（${res.status}）`);
  return data;
}

async function refresh() {
  state = await api('/api/state');
  renderAll();
}

// ---------- 渲染 ----------
const STATUS_TEXT = { ok: '正常', late: '超时', cycle: '环依赖', blocked: '无法排程' };

function cueName(id) {
  const c = state.cues.find((x) => x.id === id);
  return c ? c.name : `#${id}`;
}

function predNames(cue) {
  if (!cue.predecessors.length) return '—';
  return cue.predecessors.map((p) => esc(cueName(p))).join('、');
}

function renderAll() {
  renderCycleBanner();
  renderTable();
  renderPredCheckboxes();
  renderRunSheet();
}

function renderCycleBanner() {
  const banner = $('#cycle-banner');
  if (!state.hasCycle) {
    banner.classList.add('hidden');
    banner.innerHTML = '';
    return;
  }
  const lines = state.cycles
    .map((path) => `<div class="cycle-path">${path.map((id) => esc(cueName(id))).join(' → ')}</div>`)
    .join('');
  banner.innerHTML = `<strong>⚠ 检测到环依赖，以下提示点相互等待，无法排程：</strong>${lines}<div>请调整它们的前置关系。</div>`;
  banner.classList.remove('hidden');
}

function renderTable() {
  const tbody = $('#cue-table tbody');
  if (!state.cues.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="muted">暂无提示点，请在左侧添加。</td></tr>';
    return;
  }
  tbody.innerHTML = state.cues
    .map((c) => {
      const rowClass =
        c.status === 'late' ? 'row-late' : c.status === 'cycle' ? 'row-cycle' : c.status === 'blocked' ? 'row-blocked' : '';
      const lateBy =
        c.status === 'late' ? `（超 ${c.finish - c.latestFinish} 分钟）` : '';
      return `<tr class="${rowClass}">
        <td>${esc(c.name)}</td>
        <td>${c.duration} 分钟</td>
        <td>${minToStr(c.earliestStart)}</td>
        <td>${predNames(c)}</td>
        <td>${minToStr(c.start)}</td>
        <td>${minToStr(c.finish)}</td>
        <td>${c.latestFinish == null ? '—' : minToStr(c.latestFinish)}</td>
        <td><span class="badge ${c.status}">${STATUS_TEXT[c.status]}${lateBy}</span></td>
        <td>
          <button class="btn small" data-edit="${c.id}">编辑</button>
          <button class="btn small danger" data-del="${c.id}">删除</button>
        </td>
      </tr>`;
    })
    .join('');
}

function renderPredCheckboxes() {
  const box = $('#f-predecessors');
  const others = state.cues.filter((c) => c.id !== editingId);
  const checked = new Set(
    [...box.querySelectorAll('input:checked')].map((i) => Number(i.value))
  );
  if (!others.length) {
    box.innerHTML = '<p class="muted">暂无其他提示点</p>';
    return;
  }
  box.innerHTML = others
    .map(
      (c) => `<label><input type="checkbox" value="${c.id}" ${checked.has(c.id) ? 'checked' : ''}>
        ${esc(c.name)}</label>`
    )
    .join('');
}

function renderRunSheet() {
  const scheduled = state.cues
    .filter((c) => c.start != null)
    .sort((a, b) => a.start - b.start || a.id - b.id);
  const unscheduled = state.cues.filter((c) => c.start == null);

  const tbody = $('#runsheet-table tbody');
  if (!scheduled.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="muted">暂无可排程的提示点。</td></tr>';
  } else {
    tbody.innerHTML = scheduled
      .map((c, i) => {
        const remark =
          c.status === 'late'
            ? `<span class="badge late">超最晚完成 ${c.finish - c.latestFinish} 分钟</span>`
            : '';
        return `<tr class="${c.status === 'late' ? 'row-late' : ''}">
          <td>${i + 1}</td>
          <td>${minToStr(c.start)}</td>
          <td>${minToStr(c.finish)}</td>
          <td>${c.duration} 分钟</td>
          <td>${esc(c.name)}</td>
          <td>${predNames(c)}</td>
          <td>${remark}</td>
        </tr>`;
      })
      .join('');
  }

  const box = $('#unscheduled');
  if (unscheduled.length) {
    box.innerHTML =
      '⚠ 以下提示点因环依赖未排程：' +
      unscheduled
        .map((c) => `${esc(c.name)}（${c.status === 'cycle' ? '处于环中' : '前置无法排程'}）`)
        .join('、');
  } else {
    box.innerHTML = '';
  }

  const total = scheduled.length
    ? Math.max(...scheduled.map((c) => c.finish)) - Math.min(...scheduled.map((c) => c.start))
    : 0;
  $('#print-meta').textContent = `共 ${scheduled.length} 个提示点 · 预计总时长 ${total} 分钟 · 生成于 ${new Date().toLocaleString('zh-CN')}`;
}

// ---------- 表单 ----------
function readForm() {
  const predecessors = [...document.querySelectorAll('#f-predecessors input:checked')].map((i) =>
    Number(i.value)
  );
  return {
    name: $('#f-name').value,
    duration: Number($('#f-duration').value),
    earliestStart: strToMin($('#f-earliest').value),
    latestFinish: strToMin($('#f-latest').value),
    predecessors,
  };
}

function resetForm() {
  editingId = null;
  $('#cue-form').reset();
  $('#f-duration').value = 5;
  $('#f-earliest').value = '18:00';
  $('#form-title').textContent = '新增提示点';
  $('#submit-btn').textContent = '添加';
  $('#cancel-edit').hidden = true;
  renderPredCheckboxes();
}

function startEdit(id) {
  const c = state.cues.find((x) => x.id === id);
  if (!c) return;
  editingId = id;
  $('#f-name').value = c.name;
  $('#f-duration').value = c.duration;
  $('#f-earliest').value = minToStr(c.earliestStart).replace('次日 ', '');
  $('#f-latest').value = c.latestFinish == null ? '' : minToStr(c.latestFinish).replace('次日 ', '');
  $('#form-title').textContent = `编辑提示点 #${id}`;
  $('#submit-btn').textContent = '保存修改';
  $('#cancel-edit').hidden = false;
  renderPredCheckboxes();
  for (const p of c.predecessors) {
    const input = document.querySelector(`#f-predecessors input[value="${p}"]`);
    if (input) input.checked = true;
  }
  $('#f-name').focus();
}

let toastTimer = null;
function toast(msg, isError) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('error', !!isError);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ---------- 事件 ----------
$('#cue-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = readForm();
  try {
    if (editingId == null) {
      await api('/api/cues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      toast('已添加');
    } else {
      await api(`/api/cues/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      toast('已保存，已重新排程');
    }
    resetForm();
    await refresh();
  } catch (err) {
    toast(err.message, true);
  }
});

$('#cancel-edit').addEventListener('click', resetForm);

$('#cue-table').addEventListener('click', async (e) => {
  const editId = e.target.dataset.edit;
  const delId = e.target.dataset.del;
  if (editId) {
    startEdit(Number(editId));
  } else if (delId) {
    const c = state.cues.find((x) => x.id === Number(delId));
    if (!confirm(`确定删除提示点「${c ? c.name : delId}」吗？其依赖关系会一并移除。`)) return;
    try {
      await api(`/api/cues/${delId}`, { method: 'DELETE' });
      if (editingId === Number(delId)) resetForm();
      toast('已删除，已重新排程');
      await refresh();
    } catch (err) {
      toast(err.message, true);
    }
  }
});

// 示例数据
$('#load-sample').addEventListener('click', async () => {
  const sample = [
    { name: '技术就位 · 各组检查', duration: 10, earliestStart: '17:30', latestFinish: '17:45', predecessors: [] },
    { name: '开场音乐 Cue 1', duration: 5, earliestStart: '18:00', latestFinish: '18:10', predecessors: [0] },
    { name: '灯光 Cue 1 · 面光起', duration: 3, earliestStart: '18:00', latestFinish: null, predecessors: [1] },
    { name: '演员甲入场', duration: 4, earliestStart: '18:05', latestFinish: null, predecessors: [1] },
    { name: '音效 Cue · 雨声渐入', duration: 6, earliestStart: '18:10', latestFinish: '18:25', predecessors: [2, 3] },
    { name: '灯光 Cue 2 · 转场暗场', duration: 2, earliestStart: '18:20', latestFinish: null, predecessors: [4] },
    { name: '谢幕音乐 · 全场合影', duration: 5, earliestStart: '19:00', latestFinish: '19:10', predecessors: [5] },
  ];
  try {
    const ids = [];
    for (const s of sample) {
      const body = {
        name: s.name,
        duration: s.duration,
        earliestStart: strToMin(s.earliestStart),
        latestFinish: s.latestFinish ? strToMin(s.latestFinish) : null,
        predecessors: s.predecessors.map((i) => ids[i]),
      };
      const { id } = await api('/api/cues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      ids.push(id);
    }
    toast('示例数据已载入');
    await refresh();
  } catch (err) {
    toast(err.message, true);
  }
});

// 打印视图
function enterPreview() {
  document.body.classList.add('print-preview');
  $('#preview-bar').classList.remove('hidden');
}
function exitPreview() {
  document.body.classList.remove('print-preview');
  $('#preview-bar').classList.add('hidden');
}
$('#print-view-btn').addEventListener('click', enterPreview);
$('#preview-exit').addEventListener('click', exitPreview);
$('#print-btn').addEventListener('click', () => window.print());
$('#preview-print').addEventListener('click', () => window.print());
window.addEventListener('afterprint', exitPreview);

// ---------- 启动 ----------
resetForm();
refresh().catch((err) => toast(err.message, true));
