/* 可公开提交的配置模板。首次克隆后复制为 config.js，再填写自己的 Key。
 * config.js 已加入 Git 忽略规则，真实 Key 仅保存在本机，不要提交到仓库。 */
window.RENT_MAP_CONFIG = {
  apiKey: "",
  city: "杭州",
  cityLimit: true,
  mapCenter: [30.2741, 120.1551],
  mapZoom: 12,
  requestTimeoutMs: 15000,
  storageKey: "rent-map:data:v1",
  configStorageKey: "rent-map:config:v1",
  // Leaflet 用 {s} 表示子域，对应高德的 webrd01～webrd04。
  tileUrl: "https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
  tileSubdomains: ["1", "2", "3", "4"],
  routeColors: ["#e34c46", "#2778db", "#169c74", "#8b55cf", "#db8a1d", "#159caf"]
};
