/* 浏览器补充回归：阶段一完成后执行，恢复持久化夹具后刷新再执行阶段二。 */
() => {
  const saved = localStorage.getItem('rent-map:data:v1');
  const originalUpdate = L.Polyline.prototype.setTooltipContent;
  const updated = [];
  const checks = [];
  const assert = (condition, name) => { if (!condition) throw new Error('验证失败：' + name); checks.push(name); };
  L.Polyline.prototype.setTooltipContent = function (content) {
    updated.push({ line: this, label: content.textContent });
    return originalUpdate.call(this, content);
  };
  try {
    const rows = [...document.getElementById('resultsBody').children];
    const selected = rows.find(row => row.textContent.includes('测试小区B'));
    selected.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert(selected.classList.contains('selected-row'), '键盘回车可选择表格行');
    document.querySelector('.destination-card [data-delete]').click();
    const remaining = [...document.getElementById('resultsBody').children];
    assert(document.querySelectorAll('.destination-pin').length === 2 && [...document.querySelectorAll('.destination-pin')].map(pin => pin.textContent).join(',') === 'A,B', '删除原 A 后标记重排为 A/B');
    assert(updated.length === 1 && updated[0].label.startsWith('A · 测试小区B'), '原 B 路线提示同步重新编号为 A');
    assert(updated[0].line.options.color === window.RENT_MAP_CONFIG.routeColors[0], '重新编号后路线颜色同步');
    assert(updated[0].line.options.weight === 9 && remaining.find(row => row.textContent.includes('测试小区B')).classList.contains('selected-row'), '重新编号后高亮仍关联同一个小区');
    assert(localStorage.getItem('rent-map:data:v1') !== saved && JSON.parse(localStorage.getItem('rent-map:data:v1')).destinations.length === 2, '删除首个小区即时保存');
    return { passed: checks.length, checks, next: '测试夹具已恢复到存储；刷新后继续 browser-reload.js' };
  } finally {
    L.Polyline.prototype.setTooltipContent = originalUpdate;
    localStorage.setItem('rent-map:data:v1', saved);
  }
}
