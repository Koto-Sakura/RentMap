# 租房通勤比选器

原生 HTML + CSS + JavaScript 的本机租房比较页面，无 React/Vue、无构建步骤、无业务后端。地图仅使用 Leaflet 1.9.4 CDN；地点搜索和驾车计算直接请求高德 Web 服务 API。

## 快速使用

首次克隆仓库后，先将 [config.example.js](<config.example.js>) 复制为本机配置脚本；若本机已有配置，不要覆盖：

```powershell
Copy-Item config.example.js config.js -NoClobber
```

本机 [config.js](<config.js>) 被 Git 忽略，真实 Key 不会随普通提交上传。

1. 用 Chrome 或 Edge 打开 [index.html](<index.html>)。需联网加载 Leaflet、高德瓦片和 API。
2. 填入高德控制台申请的 **Web 服务** Key（不是 JavaScript API Key），点击“保存配置”。默认搜索城市为杭州，城市留空则搜索全国。
3. 搜索公司设置起点，逐个搜索小区添加终点。固定取第一个 POI，请核对名称和地址。
4. 填写月租，点击“一键计算所有路线”。
5. 点击距离、时长、月租表头切换升序/降序；点击行、标记、折线或“查看路线”高亮对应小区。“取消高亮”恢复全部路线。

本次已在 Chrome 的 file:// 页面验证，可直接打开 HTML。若浏览器限制本地文件的跨域请求或存储，可将本目录放到自己的静态 HTTP 服务中使用，**不需要业务后端**。切换浏览器、文件路径、域名或端口可能属于不同存储空间，旧数据不会自动迁移。不要为了跨域关闭浏览器安全机制。

## 配置与隐私

首先读取 [config.js](<config.js>)，浏览器保存的 Key、城市覆盖文件中的同名字段。

| 字段 | 默认值与用途 |
| --- | --- |
| `apiKey` | 空字符串，高德 Web 服务 Key |
| `city` / `cityLimit` | 杭州 / true，指定城市时限制城市内搜索；城市为空则不传城市限制 |
| `mapCenter` / `mapZoom` | `[30.2741, 120.1551]` / 12 |
| `requestTimeoutMs` | 15000 毫秒，单次请求超时 |
| `tileUrl` / `tileSubdomains` | 高德瓦片，Leaflet 的 `{s}` 配合 1/2/3/4 生成 webrd01～webrd04，与指定 URL 一致 |
| `routeColors` | 路线循环色板 |
| `storageKey` / `configStorageKey` | 地点数据、浏览器配置的存储命名空间 |

“保存配置”仅写入 localStorage；浏览器不能静默覆盖磁盘文件。“导出配置”下载新的配置脚本，请手动替换 [config.js](<config.js>)，以后加载时即可读取该文件。

纯前端无法隐藏 Key：它在浏览器存储和网络请求中可见。请仅供本人本机使用，按高德控制台要求配置服务权限、配额和绑定限制，不要将真实 Key 提交到公开仓库，也不要公开发布含 Key 的导出文件。地点和月租仅保存于本机 localStorage；搜索词、公司/小区坐标会发送给高德，地图资源从 CDN/高德加载。

## 功能与坐标说明

- 桌面左侧栏固定 350px，右侧地图及下方对比表格。760px 以下上下布局，表格内部横向滚动。
- 公司为红色标记，小区为带 A/B/C…/AA 序号的蓝色标记。删除后序号、颜色、路线提示同步更新；排序不改变地图序号。
- 底图、POI 与路线统一使用 **GCJ-02**，没有 WGS-84/BD-09 转换。仅将接口经纬度顺序交换为 Leaflet 的纬经度顺序。
- 搜索请求 `/v3/place/text`，先验证业务 `status`，再读取 `pois[0].location`。
- 用 `Promise.all` 并发请求 `/v3/direction/driving`。每个任务单独捕获异常，失败显示“计算失败”，不影响其他路线；错误 Key 批量只弹窗一次。
- 路线读取 `route.paths[0].distance`（米）、`duration`（秒），遍历 `steps[].polyline`，拆分 `lng,lat;...`，转为 `[lat, lng]`，去掉连续重复端点后用 `L.polyline` 绘制。解析模块含清晰的中文注释。
- 距离显示 `(米 / 1000).toFixed(1)`，时长显示 `Math.round(秒 / 60)`。月租空值与 0 区分；负数、无效数字不覆盖已保存的有效值。计算失败和空月租在升降序中都排在末尾。
- 公司变更会使旧路线失效。刷新恢复地点、标记与租金，但不缓存路线结果，需再次计算。
- 清空需确认，会删除公司、小区、月租与浏览器 Key 配置，并取消进行中的请求；迟到响应不能复活数据。磁盘 [config.js](<config.js>) 不会被删除或修改，若其中预填 Key，下次刷新仍会重新读取。
- 结果遵循“公司 → 小区”的单程驾车方向，不代表早高峰实时交通；反向小区 → 公司可能不同。

## 文件说明

| 文件 | 职责 |
| --- | --- |
| [index.html](<index.html>) | 完整页面、Leaflet CDN 引用、可访问的表格与表单 |
| [styles.css](<styles.css>) | 布局、标记、表格和响应式样式 |
| [config.example.js](<config.example.js>) | 空 Key 的公开配置模板 |
| [config.js](<config.js>) | 本机服务与地图配置，Git 忽略、不上传 |
| [core.js](<core.js>) | 坐标、驾车几何、排序和存储解析 |
| [app.js](<app.js>) | API 请求、并发计算、地图联动、DOM 和本地保存 |
| [core.test.cjs](<tests/core.test.cjs>) | 无依赖的 Node 单元测试 |
| [browser-smoke.js](<tests/browser-smoke.js>) | 浏览器主流程与配置导出回归 |
| [browser-renumber.js](<tests/browser-renumber.js>) | 删除首项、序号/颜色/高亮同步回归 |
| [browser-reload.js](<tests/browser-reload.js>) | 刷新恢复、错误 Key、网络/超时、存储与清空回归 |

## 验证结果（2026-11-03）

- 所有生产脚本与浏览器回归脚本通过 Node 语法检查。
- Node 单元测试：**11/11 通过**，覆盖坐标边界、A～AA 序号、steps 几何、非法响应、空值排序和坏存储恢复。
- Chrome + 真实 Leaflet + 模拟高德业务响应：**63 项断言通过**（37 项主流程、6 项重新编号、20 项刷新和异常）。验证三路并发、单条失败隔离、格式、三字段双向排序、折线联动、月租保存、XSS 文本渲染和配置导出。测试数据已清除。
- 390×844 移动视口：**4 项断言通过**，侧栏全宽、页面无横向溢出、地图位置与高度、表格内部横滚；桌面侧栏为 350px。
- 真实 Leaflet CDN 与真实高德底图成功加载；首次检查 21/21 瓦片加载成功。
- 工作区根目录自检：违规文件数 **0**。
- **初次交付的自动验证未使用真实 Key，真实 POI 成功搜索及真实驾车距离未纳入测试记录。** 成功路线、Key 错误、网络与超时分支使用模拟接口验证，不应视为真实高德业务联调已通过。
- 用户随后通过 Zed 预览反馈地图空白，已定位为预览服务提供的编辑缓冲区与磁盘不同：配置和页面脚本含语法错误，而磁盘脚本正常。重新从磁盘加载文件后，用户确认恢复。若重现，请先保护本机配置，关闭异常标签并放弃未保存的错误修改，重新打开文件、重启预览；也可直接用 Chrome 打开磁盘页面。

在本目录运行单元测试，无需安装 npm 依赖：

```powershell
node --check config.js
node --check core.js
node --check app.js
node --test tests/core.test.cjs
```

浏览器回归脚本不被正式页面加载。仅在**无个人数据的测试浏览器**中执行：打开空白初始页面，将 [browser-smoke.js](<tests/browser-smoke.js>) 中整段函数包在括号内并调用；接着执行 [browser-renumber.js](<tests/browser-renumber.js>)；刷新页面后执行 [browser-reload.js](<tests/browser-reload.js>)。每段返回通过断言名称和总数，最后阶段清除测试地点和 Key。若测试中途失败，手动清空测试浏览器的数据后再重跑。
