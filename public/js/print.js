'use strict';

async function load() {
  const result = await CS.api('/api/schedule');
  render(result);
}

function render({ cues, cycle }) {
  document.getElementById('gen-time').textContent = new Date().toLocaleString('zh-CN');

  const banner = document.getElementById('cycle-banner');
  if (cycle) {
    const byId = new Map(cues.map((c) => [c.id, c]));
    const names = cycle.nodes
      .map((id) => {
        const c = byId.get(id);
        return c ? `${c.ref ? c.ref + ' ' : ''}「${CS.esc(c.title)}」` : `#${id}`;
      })
      .join('、');
    const paths = (cycle.paths || (cycle.path ? [cycle.path] : []))
      .map((p) => p.map((id) => CS.esc(CS.labelOf(byId, id))).join(' → '))
      .join('；');
    banner.innerHTML =
      `⚠ <strong>环依赖（${cycle.nodes.length} 项）：</strong>${names}。` +
      (paths ? ` 环路：${paths}。` : '') +
      `下列标记为“环依赖 / 环阻塞”的项目无法排程。`;
    banner.classList.remove('hidden');
  }

  const tbody = document.getElementById('cue-tbody');
  tbody.innerHTML = cues
    .map((c, i) => {
      const rowCls = c.inCycle ? 'row-cycle' : c.blockedByCycle ? 'row-blocked' : c.overdue ? 'row-overdue' : '';
      const pres = c.prerequisites.length
        ? c.prerequisites.map((pid) => CS.esc(CS.labelOf(new Map(cues.map((x) => [x.id, x])), pid))).join('、')
        : '—';
      let status = '□ 正常';
      if (c.inCycle) status = '⚠ 环依赖';
      else if (c.blockedByCycle) status = '⚠ 环阻塞';
      else if (c.overdue) status = '⚠ 超最晚完成';

      return `<tr class="${rowCls}">
        <td>${i + 1}</td>
        <td>${CS.esc(c.ref || `#${c.id}`)}</td>
        <td class="cue-name">${CS.esc(c.title)}</td>
        <td class="num">${CS.fmtDur(c.duration)}</td>
        <td class="num">${c.scheduled ? CS.fmtTime(c.earliestStart) : '—'}</td>
        <td class="num ${c.overdue ? 't-overdue' : ''}">${
          c.scheduled ? CS.fmtTime(c.earliestFinish) : '—'
        }</td>
        <td class="num">${c.maxFinish == null ? '不限' : CS.fmtTime(c.maxFinish)}</td>
        <td>${pres}</td>
        <td>${status}</td>
      </tr>`;
    })
    .join('');
}

load().catch((err) => {
  const banner = document.getElementById('cycle-banner');
  banner.textContent = '加载排程失败：' + err.message;
  banner.classList.remove('hidden');
});
