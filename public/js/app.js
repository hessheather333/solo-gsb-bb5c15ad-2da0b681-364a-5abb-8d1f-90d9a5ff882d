'use strict';

let state = {
  cues: [], // 原始提示点（供前置选择）
  scheduled: [], // 排程结果
  cycle: null,
  editingId: null,
};

const els = {
  tbody: document.getElementById('cue-tbody'),
  banner: document.getElementById('cycle-banner'),
  stats: document.getElementById('stats'),
  mask: document.getElementById('modal-mask'),
  form: document.getElementById('cue-form'),
  modalTitle: document.getElementById('modal-title'),
  preList: document.getElementById('pre-list'),
  formError: document.getElementById('form-error'),
};

document.getElementById('btn-new').addEventListener('click', () => openModal());
document.getElementById('btn-cancel').addEventListener('click', closeModal);
els.mask.addEventListener('click', (e) => {
  if (e.target === els.mask) closeModal();
});
els.form.addEventListener('submit', onSubmit);

async function refresh() {
  const [cues, scheduleResult] = await Promise.all([
    CS.api('/api/cues'),
    CS.api('/api/schedule'),
  ]);
  state.cues = cues;
  state.scheduled = scheduleResult.cues;
  state.cycle = scheduleResult.cycle;
  render();
}

function render() {
  renderBanner();
  renderStats();
  renderTable();
}

function renderBanner() {
  if (!state.cycle) {
    els.banner.classList.add('hidden');
    els.banner.innerHTML = '';
    return;
  }
  const byId = new Map(state.scheduled.map((c) => [c.id, c]));
  const chains = (state.cycle.paths || (state.cycle.path ? [state.cycle.path] : []))
    .map(
      (p) =>
        `<span class="cycle-chain">${p
          .map((id) => CS.esc(CS.labelOf(byId, id)))
          .join(' → ')}</span>`
    )
    .join(' ');
  const names = state.cycle.nodes
    .map((id) => {
      const c = byId.get(id);
      return c ? `${c.ref ? c.ref + ' ' : ''}「${CS.esc(c.title)}」` : `#${id}`;
    })
    .join('、');
  els.banner.innerHTML =
    `⚠ <strong>发现环依赖，涉及 ${state.cycle.nodes.length} 个提示点：</strong>${names}<br>` +
    (chains ? `环路：${chains}<br>` : '') +
    `<span>环上及其下游提示点暂无法排程，请在编辑中移除构成环的某项前置关系。</span>`;
  els.banner.classList.remove('hidden');
}

function renderStats() {
  const total = state.scheduled.length;
  const scheduled = state.scheduled.filter((c) => c.scheduled);
  const overdue = state.scheduled.filter((c) => c.overdue).length;
  const cyclic = state.cycle ? state.cycle.nodes.length : 0;
  const blocked = state.scheduled.filter((c) => c.blockedByCycle).length;
  const finish = scheduled.length ? Math.max(...scheduled.map((c) => c.earliestFinish)) : null;

  const stat = (cls, num, label) =>
    `<div class="stat ${cls}"><div class="num">${num}</div><div class="label">${label}</div></div>`;

  els.stats.innerHTML =
    stat('', total, '提示点总数') +
    stat('', scheduled.length, '可排程') +
    stat(cyclic ? 'danger' : '', cyclic, '环依赖') +
    stat(blocked ? 'warn' : '', blocked, '被环阻塞') +
    stat(overdue ? 'danger' : '', overdue, '超过最晚完成') +
    stat('', finish == null ? '—' : CS.fmtTime(finish), '预计全部完成');
}

function renderTable() {
  const byId = new Map(state.scheduled.map((c) => [c.id, c]));
  els.tbody.innerHTML = state.scheduled
    .map((c, i) => {
      const rowCls = c.inCycle
        ? 'row-cycle'
        : c.blockedByCycle
          ? 'row-blocked'
          : c.overdue
            ? 'row-overdue'
            : '';

      const pres = c.prerequisites.length
        ? `<div class="pres">${c.prerequisites
            .map((pid) => {
              const exists = byId.has(pid);
              return `<span class="pre-tag ${exists ? '' : 'pre-missing'}" title="${
                exists ? '' : '前置提示点已删除'
              }">${CS.esc(CS.labelOf(byId, pid))}</span>`;
            })
            .join('')}</div>`
        : '<span class="hint">—</span>';

      const slackCell = c.scheduled
        ? c.slack == null
          ? '—'
          : c.slack < 0
            ? `<span class="t-slack-neg">${CS.fmtDur(Math.abs(c.slack))} 超时</span>`
            : c.slack === 0
              ? `<span class="t-slack-zero">0:00</span>`
              : CS.fmtDur(c.slack)
        : '—';

      return `
      <tr class="${rowCls}">
        <td>${i + 1}</td>
        <td>
          <span class="cue-ref">${CS.esc(c.ref || `#${c.id}`)}</span>
          <span class="cue-name">${CS.esc(c.title)}</span>
        </td>
        <td class="num">${CS.fmtDur(c.duration)}</td>
        <td class="num t-time">${CS.fmtTime(c.minStart)}</td>
        <td>${pres}</td>
        <td class="num t-time">${c.scheduled ? CS.fmtTime(c.earliestStart) : '—'}</td>
        <td class="num t-time ${c.overdue ? 't-overdue' : ''}">${
          c.scheduled ? CS.fmtTime(c.earliestFinish) : '—'
        }</td>
        <td class="num t-time">${c.maxFinish == null ? '不限' : CS.fmtTime(c.maxFinish)}</td>
        <td class="num">${slackCell}</td>
        <td>${statusBadge(c)}</td>
        <td>
          <div class="row-ops">
            <button class="btn btn-sm" data-act="edit" data-id="${c.id}">编辑</button>
            <button class="btn btn-sm btn-danger-text" data-act="del" data-id="${c.id}">删除</button>
          </div>
        </td>
      </tr>`;
    })
    .join('');

  els.tbody.querySelectorAll('button[data-act]').forEach((btn) => {
    const id = Number(btn.dataset.id);
    if (btn.dataset.act === 'edit') btn.addEventListener('click', () => openModal(id));
    if (btn.dataset.act === 'del') btn.addEventListener('click', () => onDelete(id));
  });
}

function statusBadge(c) {
  if (c.inCycle) return '<span class="badge badge-cycle">⚠ 环依赖</span>';
  if (c.blockedByCycle) return '<span class="badge badge-blocked">环阻塞</span>';
  if (c.overdue) return '<span class="badge badge-overdue">⚠ 超过最晚完成</span>';
  return '<span class="badge badge-ok">正常</span>';
}

/* ---------- 弹窗 ---------- */

function openModal(id) {
  state.editingId = id || null;
  els.form.reset();
  els.formError.classList.add('hidden');
  els.modalTitle.textContent = id ? '编辑提示点' : '新增提示点';

  const cue = id ? state.cues.find((c) => c.id === id) : null;
  els.form.elements.id.value = id || '';
  if (cue) {
    els.form.elements.ref.value = cue.ref || '';
    els.form.elements.title.value = cue.title || '';
    els.form.elements.duration.value = CS.durationForInput(cue.duration);
    els.form.elements.minStart.value = cue.minStart ? CS.fmtTime(cue.minStart) : '';
    els.form.elements.maxFinish.value = cue.maxFinish == null ? '' : CS.fmtTime(cue.maxFinish);
  }

  // 前置候选项不含自身
  const selected = new Set(cue ? cue.prerequisites : []);
  const candidates = state.cues.filter((c) => !id || c.id !== id);
  els.preList.innerHTML = candidates.length
    ? candidates
        .map((c) => {
          const label = `${c.ref ? c.ref + ' · ' : ''}${CS.esc(c.title)}`;
          return `<label class="pre-item">
            <input type="checkbox" name="prerequisites" value="${c.id}" ${
              selected.has(c.id) ? 'checked' : ''
            } /> ${label}</label>`;
        })
        .join('')
    : '<span class="pre-list-empty">暂无其他提示点，可先保存本项后再设置前置。</span>';

  els.mask.classList.remove('hidden');
  els.form.elements.title.focus();
}

function closeModal() {
  els.mask.classList.add('hidden');
  state.editingId = null;
}

async function onSubmit(e) {
  e.preventDefault();
  const f = els.form.elements;
  const payload = {
    ref: f.ref.value.trim(),
    title: f.title.value.trim(),
    duration: f.duration.value.trim(),
    minStart: f.minStart.value.trim(),
    maxFinish: f.maxFinish.value.trim(),
    prerequisites: Array.from(els.preList.querySelectorAll('input:checked')).map((i) =>
      Number(i.value)
    ),
  };

  try {
    if (state.editingId) {
      await CS.api(`/api/cues/${state.editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
    } else {
      await CS.api('/api/cues', { method: 'POST', body: JSON.stringify(payload) });
    }
    closeModal();
    await refresh();
  } catch (err) {
    els.formError.textContent = err.message;
    els.formError.classList.remove('hidden');
  }
}

async function onDelete(id) {
  const cue = state.cues.find((c) => c.id === id);
  const label = cue ? `${cue.ref ? cue.ref + ' ' : ''}「${cue.title}」` : `#${id}`;
  if (!confirm(`确定删除提示点 ${label} 吗？相关依赖关系会一并移除。`)) return;
  try {
    await CS.api(`/api/cues/${id}`, { method: 'DELETE' });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
}

refresh().catch((err) => {
  els.banner.textContent = '加载排程失败：' + err.message;
  els.banner.classList.remove('hidden');
});
