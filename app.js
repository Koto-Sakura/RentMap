/* 页面控制：所有地点和路线坐标均保留高德 GCJ-02，不引入 JS API 或坐标转换。 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const core = window.RentMapCore;
  const defaults = {
    apiKey: '', city: '杭州', cityLimit: true, mapCenter: [30.2741, 120.1551], mapZoom: 12,
    requestTimeoutMs: 15000, storageKey: 'rent-map:data:v1', configStorageKey: 'rent-map:config:v1',
    tileUrl: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    tileSubdomains: ['1', '2', '3', '4'],
    routeColors: ['#e34c46', '#2778db', '#169c74', '#8b55cf', '#db8a1d', '#159caf']
  };
  const config = { ...defaults, ...window.RENT_MAP_CONFIG };
  if (!Array.isArray(config.routeColors) || !config.routeColors.length) config.routeColors = defaults.routeColors;
  let state = { origin: null, destinations: [] };
  let map = null;
  let originMarker = null;
  const markers = new Map();
  const lines = new Map();
  const results = new Map();
  const controllers = new Set();
  let generation = 0;
  let searching = false;
  let calculating = false;
  let selectedId = null;
  let sort = { field: null, direction: 'asc' };
  let storageWarning = '';

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function notify(message, kind = 'info') {
    $('status').textContent = message + (storageWarning ? '；' + storageWarning : '');
    $('status').dataset.kind = kind;
  }
  function fail(message) {
    notify(message, 'error');
    window.alert(message);
  }
  function readStorage(key) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch {
      storageWarning = '本地数据无法读取（可能损坏或存储被禁用），当前仍可使用';
      return null;
    }
  }
  function persist() {
    // 只保存普通数据，不序列化 Leaflet Marker、折线或即时路线结果。
    try {
      localStorage.setItem(config.storageKey, JSON.stringify(state));
      return true;
    } catch {
      storageWarning = '本地保存失败，刷新后可能丢失本次修改';
      notify('当前修改仍在页面中生效', 'error');
      return false;
    }
  }
  function saveConfig(showMessage = true) {
    config.apiKey = $('apiKey').value.trim();
    config.city = $('cityInput').value.trim();
    try {
      localStorage.setItem(config.configStorageKey, JSON.stringify({ apiKey: config.apiKey, city: config.city }));
      if (showMessage) notify('配置已保存到当前浏览器');
      return true;
    } catch {
      storageWarning = '配置无法保存到浏览器，可使用“导出配置”保存文件';
      notify('配置已用于本次会话', 'error');
      return false;
    }
  }
  function exportConfig() {
    saveConfig(false);
    // 浏览器不能静默覆盖磁盘配置。下载后手动替换项目中的 config.js。
    const content = '/* 本机配置：请勿将含真实 Key 的文件提交到公开仓库。 */\nwindow.RENT_MAP_CONFIG = ' + JSON.stringify(config, null, 2) + ';\n';
    const url = URL.createObjectURL(new Blob([content], { type: 'text/javascript;charset=utf-8' }));
    const link = element('a');
    link.href = url;
    link.download = 'config.js';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('已导出配置，请用下载的文件替换项目 config.js');
  }
  function currentKey() {
    const key = $('apiKey').value.trim();
    if (!key) throw new Error('请先填写高德 Web 服务 API Key');
    return key;
  }
  function coordinates(point) { return [point.lat, point.lng]; }
  function colorFor(id) {
    const index = state.destinations.findIndex((item) => item.id === id);
    return config.routeColors[Math.max(0, index) % config.routeColors.length];
  }
  function labelFor(id) {
    return core.labelForIndex(state.destinations.findIndex((item) => item.id === id));
  }
  function pinIcon(label, origin = false) {
    // label 仅为程序生成的字母序号，不拼接外部 POI 名称到 HTML。
    return L.divIcon({ className: 'custom-marker', html: '<span class="map-pin ' + (origin ? 'origin-pin' : 'destination-pin') + '">' + '<span>' + label + '</span></span>', iconSize: [34, 42], iconAnchor: [17, 42], popupAnchor: [0, -42] });
  }
  function popupFor(point, label) {
    const node = element('div');
    node.append(element('strong', '', label + ' · ' + point.name));
    if (point.address) node.append(element('p', '', point.address));
    node.append(element('small', 'coordinate', point.lng.toFixed(6) + ', ' + point.lat.toFixed(6)));
    return node;
  }
  function renderMarkers() {
    if (!map) return;
    if (originMarker) map.removeLayer(originMarker);
    originMarker = state.origin ? L.marker(coordinates(state.origin), { icon: pinIcon('起', true), title: '公司：' + state.origin.name }).addTo(map).bindPopup(popupFor(state.origin, '公司')) : null;
    for (const marker of markers.values()) map.removeLayer(marker);
    markers.clear();
    state.destinations.forEach((point, index) => {
      const label = core.labelForIndex(index);
      const marker = L.marker(coordinates(point), { icon: pinIcon(label), title: label + '：' + point.name }).addTo(map).bindPopup(popupFor(point, label));
      marker.on('click', () => selectRoute(point.id, false));
      markers.set(point.id, marker);
    });
  }
  function fitAll() {
    if (!map) return;
    const points = state.destinations.map(coordinates);
    if (state.origin) points.push(coordinates(state.origin));
    for (const result of results.values()) {
      if (result.status === 'success') for (const point of result.coordinates) points.push(point);
    }
    if (points.length) map.fitBounds(L.latLngBounds(points), { padding: [42, 42], maxZoom: 15 });
    else map.setView(config.mapCenter, config.mapZoom);
  }
  function updateControls() {
    const busy = searching || calculating;
    for (const id of ['originSearchBtn', 'destSearchBtn', 'originInput', 'destInput', 'apiKey', 'cityInput']) $(id).disabled = busy || !map;
    $('calculateBtn').disabled = busy || !map || !state.origin || !state.destinations.length;
    $('calculateBtn').textContent = calculating ? '正在计算所有路线…' : '一键计算所有路线';
    document.querySelectorAll('[data-delete]').forEach((button) => { button.disabled = busy; });
    $('fitAllBtn').disabled = !map;
    $('resetHighlightBtn').disabled = !selectedId;
    $('map').setAttribute('aria-busy', String(calculating));
  }
  function invalidateRoutes() {
    for (const line of lines.values()) map?.removeLayer(line);
    lines.clear();
    results.clear();
    selectedId = null;
  }
  function removeDestination(id) {
    if (searching || calculating) return;
    state.destinations = state.destinations.filter((item) => item.id !== id);
    const line = lines.get(id);
    if (line) map?.removeLayer(line);
    lines.delete(id);
    results.delete(id);
    if (selectedId === id) selectedId = null;
    persist();
    renderAll();
    // 删除后颜色、标记与路线提示中的序号一起更新，避免旧 B 路线仍显示 B 而地图已改为 A。
    for (const [routeId, routeLine] of lines) {
      routeLine.setStyle({ color: colorFor(routeId) });
      const point = state.destinations.find((item) => item.id === routeId);
      if (point) routeLine.setTooltipContent(popupFor(point, labelFor(routeId)));
    }
    styleRoutes();
    notify('已删除小区，剩余序号已重新排列');
  }
  function locatePoint(id) {
    const point = state.destinations.find((item) => item.id === id);
    if (!point || !map) return;
    selectRoute(id);
  }
  function actionButton(text, className, callback) {
    const button = element('button', className, text);
    button.type = 'button';
    button.addEventListener('click', (event) => { event.stopPropagation(); callback(); });
    return button;
  }
  function renderSidebar() {
    $('originInfo').replaceChildren();
    if (state.origin) {
      $('originInfo').append(element('strong', '', state.origin.name), element('p', 'muted', state.origin.address || '未提供详细地址'), element('small', 'coordinate', state.origin.lng.toFixed(6) + ', ' + state.origin.lat.toFixed(6)));
    } else $('originInfo').append(element('p', 'empty-state', '尚未设置公司，请先搜索起点'));
    $('destinationCount').textContent = String(state.destinations.length);
    $('destinationsList').replaceChildren();
    if (!state.destinations.length) $('destinationsList').append(element('p', 'empty-state', '添加想对比的小区，月租可稍后填写'));
    state.destinations.forEach((point, index) => {
      const label = core.labelForIndex(index);
      const card = element('article', 'destination-card');
      const title = element('div', 'destination-title', label + ' · ' + point.name);
      card.append(title, element('p', 'destination-address muted', point.address || '未提供详细地址'));
      const field = element('label', 'rent-field', '月租（元）');
      const input = element('input', 'rent-input');
      input.type = 'number';
      input.min = '0';
      input.step = 'any';
      input.placeholder = '未填写';
      input.value = point.rent ?? '';
      input.setAttribute('aria-label', label + ' ' + point.name + ' 月租（元）');
      input.dataset.rentId = point.id;
      input.addEventListener('input', () => {
        input.setCustomValidity('');
        if (input.validity.badInput || (input.value !== '' && (!Number.isFinite(input.valueAsNumber) || input.valueAsNumber < 0))) {
          input.setCustomValidity('月租必须是非负数字，或留空');
          notify('月租必须是非负数字，或留空', 'error');
          return;
        }
        point.rent = input.value === '' ? null : input.valueAsNumber;
        persist();
        renderResults();
      });
      input.addEventListener('change', () => { if (!input.checkValidity()) input.reportValidity(); });
      field.append(input);
      const actions = element('div', 'destination-actions');
      const locate = actionButton('定位', 'button secondary', () => locatePoint(point.id));
      locate.setAttribute('aria-label', '定位小区 ' + label + ' ' + point.name);
      const remove = actionButton('删除', 'button danger', () => removeDestination(point.id));
      remove.dataset.delete = point.id;
      remove.setAttribute('aria-label', '删除小区 ' + label + ' ' + point.name);
      actions.append(locate, remove);
      card.append(field, actions);
      $('destinationsList').append(card);
    });
  }
  function sortedDestinations() {
    if (!sort.field) return [...state.destinations];
    const value = (point) => sort.field === 'rent' ? point.rent : results.get(point.id)?.[sort.field];
    // 稳定排序保留地图标记的序号，不用表格行号重新编号。
    return [...state.destinations].sort((a, b) => core.compareNullable(value(a), value(b), sort.direction));
  }
  function renderResults() {
    $('resultsBody').replaceChildren();
    $('emptyResults').hidden = state.destinations.length > 0;
    let successful = 0;
    let failed = 0;
    for (const point of sortedDestinations()) {
      const result = results.get(point.id);
      if (result?.status === 'success') successful += 1;
      if (result?.status === 'error') failed += 1;
      const row = element('tr', selectedId === point.id ? 'selected-row' : '');
      row.dataset.destinationId = point.id;
      row.tabIndex = 0;
      row.setAttribute('aria-label', labelFor(point.id) + ' ' + point.name + '，按回车定位并高亮路线');
      row.addEventListener('click', () => selectRoute(point.id));
      row.addEventListener('keydown', (event) => {
        if (event.target === row && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectRoute(point.id); }
      });
      const sequence = element('td');
      const swatch = element('span', 'route-swatch');
      swatch.style.backgroundColor = colorFor(point.id);
      swatch.setAttribute('aria-hidden', 'true');
      sequence.append(swatch, document.createTextNode(labelFor(point.id)));
      const name = element('td');
      name.append(element('strong', '', point.name));
      if (result?.status === 'error') name.append(element('div', 'error-text', '计算失败：' + result.error));
      let distance = '待计算';
      let duration = '—';
      if (result?.status === 'success') {
        distance = (result.distance / 1000).toFixed(1);
        duration = String(Math.round(result.duration / 60));
      } else if (result?.status === 'pending') distance = '计算中…';
      else if (result?.status === 'error') distance = '计算失败';
      const operations = element('td');
      const locate = actionButton(result?.status === 'success' ? '查看路线' : '定位', 'button secondary', () => locatePoint(point.id));
      locate.setAttribute('aria-label', '查看 ' + labelFor(point.id) + ' ' + point.name);
      const remove = actionButton('删除', 'button danger', () => removeDestination(point.id));
      remove.dataset.delete = point.id;
      remove.disabled = searching || calculating;
      operations.append(locate, remove);
      row.append(sequence, name, element('td', '', distance), element('td', '', duration), element('td', '', point.rent === null ? '未填写' : String(point.rent)), operations);
      $('resultsBody').append(row);
    }
    $('routeSummary').textContent = calculating ? '正在并发计算 ' + state.destinations.length + ' 条路线' : '共 ' + state.destinations.length + ' 个小区 · 成功 ' + successful + ' · 失败 ' + failed;
    document.querySelectorAll('th[data-sort]').forEach((header) => {
      const active = header.dataset.sort === sort.field;
      header.setAttribute('aria-sort', active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
    });
  }
  function renderAll() { renderSidebar(); renderResults(); renderMarkers(); updateControls(); }
  function styleRoutes() {
    for (const [id, line] of lines) line.setStyle({ weight: selectedId === id ? 9 : 5, opacity: !selectedId || selectedId === id ? 0.9 : 0.22 });
    if (selectedId && lines.has(selectedId)) lines.get(selectedId).bringToFront();
  }
  function selectRoute(id, focus = true) {
    if (!state.destinations.some((point) => point.id === id)) return;
    selectedId = id;
    styleRoutes();
    // 不重建表格以保留键盘焦点。
    for (const row of $('resultsBody').children) row.classList.toggle('selected-row', row.dataset.destinationId === id);
    if (focus && map) {
      const line = lines.get(id);
      if (line) map.fitBounds(line.getBounds(), { padding: [42, 42], maxZoom: 16 });
      else map.setView(coordinates(state.destinations.find((point) => point.id === id)), 15);
      markers.get(id)?.openPopup();
    }
    updateControls();
  }
  async function requestAmap(endpoint, parameters, key) {
    const controller = new AbortController();
    controllers.add(controller);
    let timeout = false;
    const ms = Number(config.requestTimeoutMs);
    const timer = setTimeout(() => { timeout = true; controller.abort(); }, Number.isFinite(ms) && ms > 0 ? ms : 15000);
    const url = new URL('https://restapi.amap.com/v3/' + endpoint);
    for (const [name, value] of Object.entries({ ...parameters, key })) url.searchParams.set(name, String(value));
    try {
      const response = await fetch(url.toString(), { signal: controller.signal });
      if (!response.ok) throw new Error('高德服务 HTTP ' + response.status);
      const data = await response.json();
      // 高德业务失败也可能 HTTP 200，必须先判断 status，再读取 pois/route。
      if (String(data.status) !== '1') {
        const code = String(data.infocode || '');
        const info = typeof data.info === 'string' ? data.info : '未知错误';
        const keyError = ['10001', '10002', '10005', '10006', '10007', '10008', '10009', '10012', '10013'].includes(code) || /INVALID.*KEY|KEY.*INVALID/.test(info);
        const error = new Error(keyError ? '高德 Key 无效或权限/绑定配置不正确，请检查 Web 服务 Key（' + info + '）' : '高德服务返回错误：' + info + (code ? '（' + code + '）' : ''));
        error.keyError = keyError;
        throw error;
      }
      return data;
    } catch (error) {
      if (timeout) throw new Error('高德请求超时，请稍后重试');
      if (error.name === 'AbortError') throw error;
      if (error instanceof TypeError) throw new Error('网络请求失败，请检查网络、浏览器跨域限制或高德服务可用性');
      throw error;
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }
  async function search(kind) {
    if (searching || calculating || !map) return;
    const input = kind === 'origin' ? $('originInput') : $('destInput');
    const keyword = input.value.trim();
    let key;
    try { key = currentKey(); if (!keyword) throw new Error('请输入要搜索的公司或小区名称'); }
    catch (error) { fail(error.message); return; }
    saveConfig(false);
    searching = true;
    updateControls();
    const token = generation;
    notify('正在搜索“' + keyword + '”…');
    try {
      const parameters = { keywords: keyword, offset: 1, page: 1 };
      const city = $('cityInput').value.trim();
      if (city) { parameters.city = city; parameters.citylimit = config.cityLimit ? 'true' : 'false'; }
      const data = await requestAmap('place/text', parameters, key);
      if (token !== generation) return;
      // 用户约定取 pois[0]，不擅自跳到其他结果；无结果或坐标异常明确提示。
      const poi = Array.isArray(data.pois) ? data.pois[0] : null;
      if (!poi) throw new Error('搜索无结果，请更换关键词或搜索城市');
      const location = core.parseLocation(poi.location);
      const point = { name: typeof poi.name === 'string' && poi.name.trim() ? poi.name : keyword, ...location, address: typeof poi.address === 'string' ? poi.address : '' };
      if (kind === 'origin') {
        state.origin = point;
        invalidateRoutes();
      } else {
        if (state.destinations.some((item) => item.name === point.name && item.lng === point.lng && item.lat === point.lat)) throw new Error('该小区已在列表中，无需重复添加');
        const id = window.crypto?.randomUUID ? window.crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2);
        state.destinations.push({ ...point, id, rent: null });
        input.value = '';
      }
      persist();
      renderAll();
      fitAll();
      notify((kind === 'origin' ? '已设置公司：' : '已添加小区：') + point.name);
    } catch (error) {
      if (token === generation && error.name !== 'AbortError') fail(error.message);
    } finally {
      if (token === generation) { searching = false; updateControls(); }
    }
  }
  async function calculateRoutes() {
    if (searching || calculating || !map) return;
    let key;
    try {
      key = currentKey();
      if (!state.origin) throw new Error('请先设置起点');
      if (!state.destinations.length) throw new Error('请先添加终点');
    } catch (error) { fail(error.message); return; }
    saveConfig(false);
    invalidateRoutes();
    calculating = true;
    const token = generation;
    const origin = state.origin.lng + ',' + state.origin.lat;
    const snapshot = [...state.destinations];
    let keyErrorMessage = '';
    for (const point of snapshot) results.set(point.id, { status: 'pending' });
    renderResults();
    updateControls();
    notify('正在并发计算所有驾车路线…');
    // 每个任务内部捕获异常，使 Promise.all 不因一条路线失败而提前结束。
    await Promise.all(snapshot.map(async (point) => {
      try {
        const data = await requestAmap('direction/driving', { origin, destination: point.lng + ',' + point.lat, extensions: 'base' }, key);
        if (token !== generation) return;
        const route = core.parseDrivingResult(data);
        const line = L.polyline(route.coordinates, { color: colorFor(point.id), weight: 5, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(map);
        line.bindTooltip(popupFor(point, labelFor(point.id)));
        line.on('click', () => selectRoute(point.id));
        lines.set(point.id, line);
        results.set(point.id, { status: 'success', ...route });
      } catch (error) {
        if (token !== generation) return;
        results.set(point.id, { status: 'error', error: error.message });
        if (error.keyError) keyErrorMessage = error.message;
      }
      if (token === generation) { renderResults(); styleRoutes(); }
    }));
    if (token !== generation) return;
    calculating = false;
    renderResults();
    updateControls();
    fitAll();
    const failed = [...results.values()].filter((item) => item.status === 'error').length;
    notify('计算完成：成功 ' + (snapshot.length - failed) + ' 条，失败 ' + failed + ' 条' + (failed ? '；失败原因见表格，可再次计算重试' : ''), failed ? 'error' : 'success');
    // 批量 Key 错误只弹一次，不为每个终点重复打扰用户。
    if (keyErrorMessage) window.alert(keyErrorMessage);
  }
  function clearAll() {
    if (!window.confirm('确定清空公司、所有小区、月租及浏览器保存的 Key 配置吗？磁盘 config.js 不会被删除。')) return;
    // 取消请求并递增代次，避免清空后迟到的响应把数据重新写回来。
    generation += 1;
    for (const controller of controllers) controller.abort();
    searching = false;
    calculating = false;
    state = { origin: null, destinations: [] };
    sort = { field: null, direction: 'asc' };
    invalidateRoutes();
    let removed = true;
    try {
      localStorage.removeItem(config.storageKey);
      localStorage.removeItem(config.configStorageKey);
      // 本次清理成功后，不继续显示之前写入失败留下的过时提示。
      storageWarning = '';
    }
    catch { removed = false; storageWarning = '本地存储清理失败，刷新后可能恢复旧数据'; }
    config.apiKey = '';
    config.city = defaults.city;
    $('apiKey').value = '';
    $('cityInput').value = config.city;
    $('originInput').value = '';
    $('destInput').value = '';
    renderAll();
    fitAll();
    notify(removed ? '已清空所有页面与浏览器数据（磁盘配置文件未改动）' : '页面数据已清空，但浏览器存储未能删除', removed ? 'success' : 'error');
  }
  function initialize() {
    if (!core) { fail('解析模块未加载，请检查 core.js'); return; }
    const savedConfig = readStorage(config.configStorageKey);
    if (savedConfig && typeof savedConfig === 'object') {
      if (typeof savedConfig.apiKey === 'string') config.apiKey = savedConfig.apiKey;
      if (typeof savedConfig.city === 'string') config.city = savedConfig.city;
    }
    $('apiKey').value = typeof config.apiKey === 'string' ? config.apiKey : '';
    $('cityInput').value = typeof config.city === 'string' ? config.city : defaults.city;
    state = core.normalizeSavedData(readStorage(config.storageKey));
    $('originForm').addEventListener('submit', (event) => { event.preventDefault(); search('origin'); });
    $('destForm').addEventListener('submit', (event) => { event.preventDefault(); search('destination'); });
    const saveButton = $('saveConfigBtn') || $('saveKeyBtn');
    if (saveButton) saveButton.addEventListener('click', () => saveConfig());
    $('exportConfigBtn').addEventListener('click', exportConfig);
    $('calculateBtn').addEventListener('click', calculateRoutes);
    $('clearBtn').addEventListener('click', clearAll);
    $('fitAllBtn').addEventListener('click', fitAll);
    $('resetHighlightBtn').addEventListener('click', () => {
      selectedId = null;
      styleRoutes();
      renderResults();
      updateControls();
    });
    document.querySelectorAll('th[data-sort]').forEach((header) => header.querySelector('button').addEventListener('click', () => {
      const field = header.dataset.sort;
      sort = { field, direction: sort.field === field && sort.direction === 'asc' ? 'desc' : 'asc' };
      renderResults();
    }));
    try {
      if (!window.L) throw new Error('Leaflet CDN 加载失败，请检查网络后刷新');
      if (!Array.isArray(config.mapCenter) || config.mapCenter.length !== 2) config.mapCenter = defaults.mapCenter;
      try { const point = core.parseLocation(config.mapCenter[1] + ',' + config.mapCenter[0]); config.mapCenter = coordinates(point); }
      catch { config.mapCenter = defaults.mapCenter; }
      if (!Number.isFinite(Number(config.mapZoom))) config.mapZoom = defaults.mapZoom;
      map = L.map('map').setView(config.mapCenter, Number(config.mapZoom));
      // Leaflet 不识别 {1-4}，用 {s}+subdomains 实际请求完全相同的四个高德瓦片域名。
      const tiles = L.tileLayer(config.tileUrl, { subdomains: config.tileSubdomains, maxZoom: 18, attribution: '© 高德地图 | GCJ-02' }).addTo(map);
      let tileWarningShown = false;
      tiles.on('tileerror', () => { if (!tileWarningShown) { tileWarningShown = true; notify('部分底图瓦片加载失败，请检查网络；路线计算与已保存数据不受影响', 'error'); } });
      if (window.ResizeObserver) new ResizeObserver(() => map.invalidateSize()).observe($('map'));
    } catch (error) {
      $('mapFallback').hidden = false;
      $('mapFallback').textContent = error.message;
      notify(error.message, 'error');
    }
    renderAll();
    fitAll();
    if (map) notify(state.origin || state.destinations.length ? '已恢复本地地点和月租，请重新计算路线以获取最新结果' : '从搜索公司开始，添加小区后即可比对驾车通勤');
  }
  initialize();
})();
