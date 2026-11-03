/* 浏览器回归阶段二：阶段一完成后刷新 index.html，再执行本函数。最终清空测试数据。 */
async () => {
  const checks = [];
  const assert = (condition, name) => { if (!condition) throw new Error('验证失败：' + name); checks.push(name); };
  const $ = (id) => document.getElementById(id);
  const waitUntil = (predicate) => new Promise((resolve, reject) => {
    if (predicate()) { resolve(); return; }
    const observer = new MutationObserver(() => { if (predicate()) { clearTimeout(timer); observer.disconnect(); resolve(); } });
    const timer = setTimeout(() => { observer.disconnect(); reject(new Error('等待界面超时')); }, 5000);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  });
  assert($('originInfo').textContent.includes('测试公司') && $('destinationCount').textContent === '3', '刷新恢复公司及三个小区');
  assert(document.querySelectorAll('.destination-pin').length === 3 && document.querySelectorAll('.origin-pin').length === 1, '刷新恢复红蓝标记');
  assert([...document.querySelectorAll('[data-rent-id]')].map(input => input.value).join(',') === '4500,0,', '刷新恢复月租 4500、0 和空值');
  assert($('apiKey').value === 'browser-test-key-not-real', '刷新读取保存的 Key 配置');
  assert([...$('resultsBody').children].every(row => row.children[2].textContent === '待计算'), '不缓存过期路线，刷新后待计算');
  const originalFetch = window.fetch;
  const originalAlert = window.alert;
  const originalConfirm = window.confirm;
  const originalTimeout = window.setTimeout;
  const originalSetItem = Storage.prototype.setItem;
  const alerts = [];
  window.alert = (message) => alerts.push(message);
  try {
    window.fetch = async () => ({ ok: true, json: async () => ({ status: '0', info: 'INVALID_USER_KEY', infocode: '10001' }) });
    $('calculateBtn').click();
    await waitUntil(() => !$('calculateBtn').disabled);
    assert(alerts.length === 1 && alerts[0].includes('Key'), '批量错误 Key 只弹窗一次');
    assert($('routeSummary').textContent.includes('失败 3'), '错误 Key 时所有失败行可见');
    $('originInput').value = '错误Key测试';
    $('originForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitUntil(() => !$('originInput').disabled);
    assert(alerts.length === 2 && alerts.at(-1).includes('Key'), '搜索时错误 Key 有弹窗');
    assert($('originInfo').textContent.includes('测试公司'), '失败搜索不会覆盖原有起点');
    window.fetch = async () => { throw new TypeError('Failed to fetch'); };
    $('calculateBtn').click();
    await waitUntil(() => !$('calculateBtn').disabled);
    assert($('resultsBody').textContent.includes('网络请求失败') && $('routeSummary').textContent.includes('失败 3'), '网络失败隔离并显示可理解原因');
    // 缩短模拟请求超时，避免回归脚本真实等待 15 秒；不修改生产配置。
    window.setTimeout = (callback, ms, ...args) => originalTimeout(callback, ms === 15000 ? 20 : ms, ...args);
    window.fetch = (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    $('calculateBtn').click();
    await waitUntil(() => !$('calculateBtn').disabled);
    assert($('resultsBody').textContent.includes('请求超时') && $('routeSummary').textContent.includes('失败 3'), '请求超时结束加载状态并允许重试');
    window.setTimeout = originalTimeout;
    let pending = [];
    let aborted = 0;
    window.fetch = (url, options) => new Promise((resolve) => {
      options.signal.addEventListener('abort', () => { aborted += 1; }, { once: true });
      // 故意不让模拟请求因 abort 拒绝，用迟到成功响应验证代次保护。
      pending.push(resolve);
    });
    $('calculateBtn').click();
    assert(pending.length === 3 && $('calculateBtn').disabled, '计算中禁用重复计算');
    window.confirm = () => false;
    $('clearBtn').click();
    assert($('destinationCount').textContent === '3' && aborted === 0, '取消清空不会删除数据或中断计算');
    window.confirm = () => true;
    $('clearBtn').click();
    assert(aborted === 3, '清空取消全部进行中请求');
    for (const resolve of pending) resolve({ ok: true, json: async () => ({ status: '1', route: { paths: [{ distance: '10', duration: '1', steps: [{ polyline: '120.1,30.1;120.2,30.2' }] }] } }) });
    await new Promise(resolve => originalTimeout(resolve, 0));
    assert($('destinationCount').textContent === '0' && !$('resultsBody').children.length, '迟到响应不会复活被清空的数据');
    assert(!document.querySelector('.origin-pin') && !document.querySelector('.destination-pin'), '清空同步删除地图标记');
    assert(localStorage.getItem('rent-map:data:v1') === null && localStorage.getItem('rent-map:config:v1') === null && $('apiKey').value === '', '清空删除地点、租金与浏览器 Key 配置');
    assert($('calculateBtn').disabled && !$('originInput').disabled, '清空恢复可搜索状态');
    $('apiKey').value = 'browser-test-key-not-real';
    Storage.prototype.setItem = function (key, value) { if (key === 'rent-map:data:v1') throw new DOMException('Quota exceeded', 'QuotaExceededError'); return originalSetItem.call(this, key, value); };
    window.fetch = async () => ({ ok: true, json: async () => ({ status: '1', pois: [{ name: '存储受限公司', location: '120.1551,30.2741' }] }) });
    $('originInput').value = '存储受限公司';
    $('originForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitUntil(() => !$('originInput').disabled);
    assert($('originInfo').textContent.includes('存储受限公司') && $('status').textContent.includes('本地保存失败'), 'localStorage 写入失败时页面可继续使用且明确告警');
    Storage.prototype.setItem = originalSetItem;
    let searchResolve;
    window.fetch = () => new Promise(resolve => { searchResolve = resolve; });
    $('destInput').value = '清空中搜索';
    $('destForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    $('clearBtn').click();
    searchResolve({ ok: true, json: async () => ({ status: '1', pois: [{ name: '迟到小区', location: '120.16,30.25' }] }) });
    await new Promise(resolve => originalTimeout(resolve, 0));
    assert($('destinationCount').textContent === '0' && !$('originInfo').textContent.includes('存储受限公司'), '清空同样阻止迟到搜索结果');
    return { passed: checks.length, checks, status: $('status').textContent, testDataRemoved: localStorage.getItem('rent-map:data:v1') === null };
  } finally {
    window.fetch = originalFetch; window.alert = originalAlert; window.confirm = originalConfirm;
    window.setTimeout = originalTimeout; Storage.prototype.setItem = originalSetItem;
  }
}
