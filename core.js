/* 与 DOM、Leaflet 无关的解析函数，便于用真实接口结构进行单元测试。 */
(function (root) {
  'use strict';
  function finiteNumber(value) {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && !value.trim()) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  function parseLocation(value) {
    if (typeof value !== 'string') throw new Error('地点坐标格式错误');
    const parts = value.split(',');
    if (parts.length !== 2) throw new Error('地点坐标格式错误');
    const lng = finiteNumber(parts[0]);
    const lat = finiteNumber(parts[1]);
    if (lng === null || lat === null || Math.abs(lng) > 180 || Math.abs(lat) > 90) throw new Error('地点坐标无效');
    return { lng, lat };
  }
  function labelForIndex(index) {
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('序号无效');
    let number = index + 1;
    let label = '';
    while (number > 0) {
      number -= 1;
      label = String.fromCharCode(65 + number % 26) + label;
      number = Math.floor(number / 26);
    }
    return label;
  }
  function parseDrivingResult(result) {
    // v3 驾车接口：选第一条 path；distance 单位米，duration 单位秒。
    const path = result?.route?.paths?.[0];
    if (!path) throw new Error('未返回可用的驾车路线');
    const distance = finiteNumber(path.distance);
    const duration = finiteNumber(path.duration);
    if (distance === null || duration === null || distance < 0 || duration < 0) throw new Error('路线距离或时长无效');
    if (!Array.isArray(path.steps)) throw new Error('路线缺少 steps 几何数据');
    const coordinates = [];
    // 每个 step.polyline 是 "lng,lat;lng,lat;..."，不是 GeoJSON。
    // 地图、POI 和路线均直接使用 GCJ-02；这里只交换成 Leaflet 的 [lat, lng]，不转换坐标系。
    for (const step of path.steps) {
      if (step?.polyline === undefined || step.polyline === null || step.polyline === '') continue;
      if (typeof step.polyline !== 'string') throw new Error('路线几何格式无效');
      for (const pair of step.polyline.split(';')) {
        if (!pair.trim()) continue;
        const { lng, lat } = parseLocation(pair);
        const previous = coordinates[coordinates.length - 1];
        // 相邻 step 常常共用端点，去掉连续重复点，但保留非相邻回环。
        if (!previous || previous[0] !== lat || previous[1] !== lng) coordinates.push([lat, lng]);
      }
    }
    if (coordinates.length < 2) throw new Error('路线几何点不足');
    return { distance, duration, coordinates };
  }
  function compareNullable(a, b, direction = 'asc') {
    const first = finiteNumber(a);
    const second = finiteNumber(b);
    // 未填写月租或计算失败不参与数值比较；升降序均置于最后。
    if (first === null && second === null) return 0;
    if (first === null) return 1;
    if (second === null) return -1;
    return (first - second) * (direction === 'desc' ? -1 : 1);
  }
  function normalizePoint(point) {
    if (!point || typeof point.name !== 'string' || !point.name.trim()) return null;
    const lng = finiteNumber(point.lng);
    const lat = finiteNumber(point.lat);
    if (lng === null || lat === null || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
    return { name: point.name.trim(), lng, lat, address: typeof point.address === 'string' ? point.address : '' };
  }
  function normalizeSavedData(value) {
    const output = { origin: normalizePoint(value?.origin), destinations: [] };
    const used = new Set();
    if (!Array.isArray(value?.destinations)) return output;
    value.destinations.forEach((item, index) => {
      const point = normalizePoint(item);
      if (!point) return;
      let id = typeof item.id === 'string' && item.id ? item.id : 'restored-' + index;
      while (used.has(id)) id += '-duplicate';
      used.add(id);
      const rent = finiteNumber(item.rent);
      output.destinations.push({ ...point, id, rent: rent !== null && rent >= 0 ? rent : null });
    });
    return output;
  }
  root.RentMapCore = Object.freeze({ parseLocation, labelForIndex, parseDrivingResult, compareNullable, normalizeSavedData });
})(window);
