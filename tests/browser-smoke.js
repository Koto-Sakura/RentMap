/* 浏览器回归阶段一：在打开 index.html 后通过 DevTools 执行此函数。只使用模拟 Web API。
 * 执行前请使用空白测试浏览器；测试生成的地点会用于下一阶段刷新恢复验证，随后清空。 */
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
  assert(typeof L === 'object', '真实 Leaflet 已加载');
  assert($('sidebar').getBoundingClientRect().width === 350, '桌面侧栏为 350px');
  assert($('resultsBody').children.length === 0, '页面没有伪造初始地点');
  const originalFetch = window.fetch;
  const originalAlert = window.alert;
  const originalPolyline = L.polyline;
  const alerts = [];
  const routeLines = [];
  const calls = [];
  let pending = [];
  let maximumConcurrency = 0;
  const pois = {
    '测试公司': { name: '测试公司', location: '120.1551,30.2741', address: '测试用公司地址' },
    '测试小区A': { name: '测试小区A', location: '120.18,30.29', address: '测试用小区A地址' },
    '测试小区B': { name: '测试小区B', location: '120.20,30.30', address: '测试用小区B地址' },
    '测试小区C': { name: '测试小区C', location: '120.14,30.25', address: '测试用小区C地址' },
    '危险名称': { name: '<img src=x onerror="window.__xss=1">', location: '120.16,30.26', address: '<script>window.__xss=2</script>' }
  };
  window.alert = (message) => alerts.push(message);
  L.polyline = function (coords, options) { const line = originalPolyline.call(this, coords, options); routeLines.push(line); return line; };
  window.fetch = async (url) => {
    const request = new URL(url);
    calls.push(request);
    const response = (data) => ({ ok: true, json: async () => data });
    if (request.pathname.endsWith('/place/text')) {
      const keyword = request.searchParams.get('keywords');
      return response({ status: '1', pois: pois[keyword] ? [pois[keyword], { name: '绝不应选择的第二结果', location: '121,31' }] : [] });
    }
    if (request.pathname.endsWith('/direction/driving')) return new Promise((resolve) => {
      pending.push({ request, resolve });
      maximumConcurrency = Math.max(maximumConcurrency, pending.length);
      // 三个终点的请求全部到达后才返回，以证明确实并发而非串行。
      if (pending.length === 3) {
        const batch = pending;
        pending = [];
        queueMicrotask(() => batch.forEach(({ request: routeRequest, resolve: finish }) => {
          const destination = routeRequest.searchParams.get('destination');
          if (destination === '120.14,30.25') { finish(response({ status: '0', info: 'NO_ROUTE', infocode: '20000' })); return; }
          const first = destination === '120.18,30.29';
          finish(response({ status: '1', route: { paths: [{ distance: first ? '1250' : '8000', duration: first ? '310' : '900', steps: [
            { polyline: '120.1551,30.2741;120.17,30.28' }, { polyline: '120.17,30.28;' + destination }
          ] }] } }));
        }));
      }
    });
    throw new Error('测试遇到未预期请求');
  };
  const submit = async (kind, keyword) => {
    const origin = kind === 'origin';
    $(origin ? 'originInput' : 'destInput').value = keyword;
    $(origin ? 'originForm' : 'destForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitUntil(() => !$(origin ? 'originInput' : 'destInput').disabled);
  };
  try {
    await submit('origin', '测试公司');
    assert(alerts.length === 1 && alerts[0].includes('Key'), '缺少 Key 时弹窗，不发请求');
    assert(calls.length === 0, '缺少 Key 未请求 API');
    $('apiKey').value = 'browser-test-key-not-real';
    document.querySelector('.config-actions button').click();
    assert(JSON.parse(localStorage.getItem('rent-map:config:v1')).apiKey === 'browser-test-key-not-real', 'Key 配置保存到 localStorage');
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    let exportedConfig = null;
    HTMLAnchorElement.prototype.click = function () { exportedConfig = { name: this.download, url: this.href }; };
    try { $('exportConfigBtn').click(); } finally { HTMLAnchorElement.prototype.click = originalAnchorClick; }
    assert(exportedConfig.name === 'config.js', '导出配置使用独立 config.js 文件名');
    const exportedText = await (await originalFetch(exportedConfig.url)).text();
    assert(exportedText.includes('window.RENT_MAP_CONFIG =') && exportedText.includes('browser-test-key-not-real') && exportedText.includes('tileSubdomains'), '导出的配置包含当前 Key 与地图配置');
    await submit('origin', '测试公司');
    assert($('originInfo').textContent.includes('测试公司'), '取第一个 POI 设置公司');
    assert(!document.body.textContent.includes('绝不应选择'), '未使用第二个 POI');
    await submit('destination', '测试小区A');
    await submit('destination', '测试小区B');
    await submit('destination', '测试小区C');
    assert($('destinationCount').textContent === '3', '三个小区已添加');
    assert([...document.querySelectorAll('.destination-pin')].map(pin => pin.textContent).join(',') === 'A,B,C', '蓝色标记按 A/B/C 编号');
    assert(document.querySelectorAll('.origin-pin').length === 1, '公司只有一个红色标记');
    await submit('destination', '测试小区A');
    assert(alerts.at(-1).includes('重复') && $('destinationCount').textContent === '3', '重复小区被拒绝');
    await submit('destination', '不存在');
    assert(alerts.at(-1).includes('无结果'), '搜索无结果有提示');
    const rentInputs = document.querySelectorAll('[data-rent-id]');
    rentInputs[0].value = '4500'; rentInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    rentInputs[1].value = '0'; rentInputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    const saved = JSON.parse(localStorage.getItem('rent-map:data:v1'));
    assert(saved.destinations[0].rent === 4500 && saved.destinations[1].rent === 0 && saved.destinations[2].rent === null, '保存月租并区分 0 与空值');
    rentInputs[0].value = '-1'; rentInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    assert(JSON.parse(localStorage.getItem('rent-map:data:v1')).destinations[0].rent === 4500, '负数月租不会覆盖有效数据');
    rentInputs[0].value = '4500'; rentInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    $('calculateBtn').click();
    await waitUntil(() => !$('calculateBtn').disabled);
    assert(maximumConcurrency === 3, 'Promise.all 三条路线并发请求');
    assert($('routeSummary').textContent.includes('成功 2') && $('routeSummary').textContent.includes('失败 1'), '单条失败不影响其他结果');
    assert(routeLines.length === 2, '两条成功路线绘制真实 Leaflet 折线');
    assert(routeLines[0].getLatLngs().length === 3, 'steps 拼接并去重端点');
    assert(routeLines[0].getLatLngs()[0].lat === 30.2741 && routeLines[0].getLatLngs()[0].lng === 120.1551, '几何直接使用 GCJ-02 并交换为 lat/lng');
    assert(routeLines[0].options.color !== routeLines[1].options.color, '不同路线使用不同颜色');
    let rows = [...$('resultsBody').children];
    assert(rows[0].children[2].textContent === '1.3' && rows[0].children[3].textContent === '5', '距离保留一位小数、分钟四舍五入');
    assert(rows[2].textContent.includes('计算失败'), '失败行明确展示失败');
    const sortBy = (field) => document.querySelector('th[data-sort="' + field + '"] button').click();
    sortBy('distance');
    assert($('resultsBody').firstElementChild.children[0].textContent === 'A', '距离升序');
    sortBy('distance');
    assert($('resultsBody').firstElementChild.children[0].textContent === 'B' && $('resultsBody').lastElementChild.children[0].textContent === 'C', '距离降序，失败仍在末尾');
    sortBy('duration');
    assert($('resultsBody').firstElementChild.children[0].textContent === 'A', '时长升序');
    sortBy('duration');
    assert($('resultsBody').firstElementChild.children[0].textContent === 'B', '时长降序');
    sortBy('rent');
    assert($('resultsBody').firstElementChild.children[0].textContent === 'B', '月租升序，0 不被当作空值');
    sortBy('rent');
    assert($('resultsBody').firstElementChild.children[0].textContent === 'A' && $('resultsBody').lastElementChild.children[0].textContent === 'C', '月租降序，未填写仍在末尾');
    $('resultsBody').firstElementChild.click();
    assert(routeLines[0].options.weight === 9 && routeLines[1].options.opacity === 0.22, '点击表格高亮对应线，其他线变暗');
    $('resetHighlightBtn').click();
    assert(routeLines.every(line => line.options.weight === 5 && line.options.opacity === 0.9), '取消高亮恢复全部路线');
    await submit('destination', '危险名称');
    assert(!window.__xss && !document.querySelector('#destinationsList img') && !document.querySelector('#destinationsList script'), '外部 POI 名称及地址按文本渲染防止 XSS');
    document.querySelectorAll('.destination-card [data-delete]')[3].click();
    assert($('destinationCount').textContent === '3' && document.querySelectorAll('.destination-pin').length === 3, '删除同步清理列表、标记、存储');
    assert(calls.filter(url => url.pathname.endsWith('/place/text')).every(url => url.searchParams.get('city') === '杭州' && url.searchParams.get('citylimit') === 'true'), '搜索城市与配置正确传参');
    assert(calls.filter(url => url.pathname.endsWith('/direction/driving')).every(url => url.searchParams.get('origin') === '120.1551,30.2741'), '路线使用公司坐标作为起点');
    return { passed: checks.length, checks, maximumConcurrency, routesDrawn: routeLines.length, status: $('status').textContent, next: '刷新页面执行 browser-reload.js' };
  } finally { window.fetch = originalFetch; window.alert = originalAlert; L.polyline = originalPolyline; }
}
