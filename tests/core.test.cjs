const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'core.js'), 'utf8');
const sandbox = { window: {} };
vm.runInNewContext(source, sandbox, { filename: 'core.js' });
const core = sandbox.window.RentMapCore;

assert.ok(core && typeof core === 'object', 'core.js 应在 window.RentMapCore 暴露接口');

const { parseLocation, labelForIndex, parseDrivingResult, compareNullable, normalizeSavedData } = core;

test('parseLocation 解析经度、纬度字符串并接受边界值', () => {
  assert.deepEqual({ ...parseLocation('120.1551,30.2741') }, { lng: 120.1551, lat: 30.2741 });
  assert.deepEqual({ ...parseLocation('-180,-90') }, { lng: -180, lat: -90 });
  assert.deepEqual({ ...parseLocation('180,90') }, { lng: 180, lat: 90 });
  assert.deepEqual({ ...parseLocation(' 120.5 , -30.25 ') }, { lng: 120.5, lat: -30.25 });
});

test('parseLocation 拒绝空值、错误分量和非数字', () => {
  for (const value of ['', '   ', null, undefined, '1', '1,2,3', ',2', '1,', 'x,2', '1,NaN']) {
    assert.throws(() => parseLocation(value), String(value));
  }
});

test('parseLocation 严格限制经纬度范围与有限数值', () => {
  for (const value of ['180.0001,0', '-180.0001,0', '0,90.0001', '0,-90.0001', 'Infinity,0', '0,-Infinity', '1e309,0']) {
    assert.throws(() => parseLocation(value), value);
  }
});

test('labelForIndex 使用 Excel 式字母序号', () => {
  assert.deepEqual([0, 1, 25, 26, 27, 51, 52, 701, 702].map(labelForIndex),
    ['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
});

test('parseDrivingResult 解析高德驾车路线并转换为 Leaflet 坐标', () => {
  const result = {
    status: '1',
    route: { paths: [{
      distance: '1250', duration: '310',
      steps: [
        { instruction: '出发', polyline: '120.1000,30.2000;120.1100,30.2100' },
        { instruction: '直行', polyline: '120.1100,30.2100;120.1200,30.2200' },
        { instruction: '到达', polyline: '120.1300,30.2300' }
      ]
    }] }
  };
  const parsed = parseDrivingResult(result);
  assert.equal(parsed.distance, 1250);
  assert.equal(parsed.duration, 310);
  assert.deepEqual(Array.from(parsed.coordinates, point => [...point]), [
    [30.2, 120.1], [30.21, 120.11], [30.22, 120.12], [30.23, 120.13]
  ]);
});

test('parseDrivingResult 跳过空步骤折线并去除相邻重复点', () => {
  const parsed = parseDrivingResult({ route: { paths: [{
    distance: 0, duration: '0', steps: [
      { polyline: '' }, { polyline: null },
      { polyline: '1,2;1,2;2,3' },
      { polyline: '2,3;3,4' }
    ]
  }] } });
  assert.equal(parsed.distance, 0);
  assert.equal(parsed.duration, 0);
  assert.deepEqual(Array.from(parsed.coordinates, point => [...point]), [[2, 1], [3, 2], [4, 3]]);
});

test('parseDrivingResult 拒绝缺失路径、几何不足和无效距离时长', () => {
  for (const result of [null, {}, { route: {} }, { route: { paths: [] } },
    { route: { paths: [{ distance: 1, duration: 1, steps: [] }] } },
    { route: { paths: [{ distance: 1, duration: 1, steps: [{ polyline: '1,2' }] }] } }]) {
    assert.throws(() => parseDrivingResult(result));
  }
  for (const field of ['distance', 'duration']) {
    for (const bad of [undefined, null, '', ' ', 'oops', NaN, Infinity, -1, '-0.1']) {
      const pathData = { distance: 1, duration: 1, steps: [{ polyline: '1,2;2,3' }] };
      pathData[field] = bad;
      assert.throws(() => parseDrivingResult({ route: { paths: [pathData] } }), field + '=' + String(bad));
    }
  }
});

test('compareNullable 按数字排序且空值始终置尾', () => {
  assert.ok(compareNullable(2, 10, 'asc') < 0);
  assert.ok(compareNullable(10, 2, 'desc') < 0);
  assert.equal(compareNullable(3, 3, 'asc'), 0);
  for (const direction of ['asc', 'desc']) {
    for (const empty of [null, undefined, '']) {
      assert.ok(compareNullable(0, empty, direction) < 0);
      assert.ok(compareNullable(empty, 0, direction) > 0);
    }
  }
});

test('normalizeSavedData 清理有效POI、规范租金并修复重复ID', () => {
  const output = normalizeSavedData({
    origin: { name: '公司', lng: '120.1', lat: 30.2 },
    destinations: [
      { id: 'home-1', name: '甲小区', lng: 120.2, lat: '30.3', rent: '5200' },
      { id: 'home-1', name: '乙小区', lng: '120.4', lat: 30.5, rent: 0 },
      { id: '', name: '丙小区', lng: 120.6, lat: 30.7, rent: '' },
      { id: 'bad-rent', name: '丁小区', lng: 120.8, lat: 30.9, rent: '-1' }
    ]
  });
  assert.equal(output.origin.name, '公司');
  assert.equal(output.origin.lng, 120.1);
  assert.equal(output.origin.lat, 30.2);
  assert.equal(output.destinations.length, 4);
  assert.equal(output.destinations[0].rent, 5200);
  assert.equal(output.destinations[1].rent, 0);
  assert.equal(output.destinations[2].rent, null);
  assert.equal(output.destinations[3].rent, null);
  assert.ok(output.destinations.every(item => typeof item.id === 'string' && item.id.length > 0));
  assert.equal(new Set(output.destinations.map(item => item.id)).size, output.destinations.length);
});

test('normalizeSavedData 丢弃坏名称或越界坐标并接受有效数值字符串坐标', () => {
  const output = normalizeSavedData({
    origin: { name: '越界', lng: 181, lat: 0 },
    destinations: [
      { id: 'a', name: '经度越界', lng: '180.01', lat: 0, rent: 1 },
      { id: 'b', name: '纬度越界', lng: 0, lat: '-90.01', rent: 1 },
      { id: 'c', name: '  ', lng: 0, lat: 0, rent: 1 },
      { id: 'd', name: '有效边界', lng: '-180', lat: '90', rent: '12.5' }
    ]
  });
  assert.equal(output.origin, null);
  assert.equal(output.destinations.length, 1);
  assert.equal(output.destinations[0].name, '有效边界');
  assert.equal(output.destinations[0].lng, -180);
  assert.equal(output.destinations[0].lat, 90);
  assert.equal(output.destinations[0].rent, 12.5);
});

test('normalizeSavedData 对异常输入返回空结构', () => {
  for (const value of [null, undefined, 1, 'data', [], { origin: {}, destinations: {} }]) {
    const output = normalizeSavedData(value);
    assert.equal(output.origin, null);
    assert.deepEqual([...output.destinations], []);
  }
});
