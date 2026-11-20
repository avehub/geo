# 站长数据获取路径选择（2026-11-06）

> 状态：**已选择路径 C（控制系统 Chrome）+ 每日拉取（GSC）**，2026-11-06。本文保留路径分析；AGENTS 规则 11 不改变。
> 目标：在已有 Google Search Console / Bing Webmaster / 百度搜索资源平台账号的前提下，确定每个平台“自动取数”的合法、可维护路径。

## 1. 先给结论

| 平台 | 官方读取 API | 推荐路径 | 浏览器自动化是否值得做 |
|---|---|---|---|
| Google Search Console | ✅ Search Console API（OAuth 2.0） | **OAuth 直连** | ❌ 不建议；API 已足够且更稳定 |
| Bing Webmaster | ✅ Webmaster API（API key / OAuth，按当前官方 REST 文档） | **官方 API** | ❌ 不建议；优先 API |
| 百度搜索资源平台（传统 / AI 流量分析） | ❌ 只有收录推送；没有公开读 API | **导出 / 粘贴 / 人工填报** | ⚠ 只有“用户在场浏览器助手”这一条灰区路径 |
| 百度统计 | ✅ 百度统计 OAuth API | **OAuth 直连** | ❌ 不建议 |
| 头条 / 搜狗 / 360 | ❌ 只有后台 / 推送 | 导出 / 粘贴；或经批准后浏览器助手 | ⚠ 灰区，二期再议 |

**默认建议**：官方 API + 导出/粘贴优先；浏览器自动化只作为“无 API 平台的用户在场补充”，不作为默认路径，也不用于 GSC/Bing/百度统计。

## 2. 四条实现路径

### 路径 A：官方 OAuth / API（推荐）

- GSC：OAuth 2.0 installed app + loopback redirect；scope `https://www.googleapis.com/auth/webmasters.readonly`；`searchAnalytics/query` 取 query/page 维度。
- Bing：官方 Webmaster API；若当前 REST 认证仍以 API key 为主，则用户在 Webmaster Tools 生成 key；若 OAuth 可用，则走 Entra OAuth。
- 百度统计：官方 OAuth API，取 sessions / landing page，进“站内分析”组。
- 百度搜索资源平台：**没有读 API**；只能走导出/粘贴/填报。AI 流量分析的关键词表与热门页面表有 xlsx 下载，继续用 `search_metric_import_csv` 导入。

优点：合规、稳定、可无人值守、可测试。  
代价：百度站长无法自动取；OAuth 应用注册/审核需要时间。

### 路径 B：用户在场的内置 Chromium 助手

- 应用打开一个独立 Chromium（独立 profile），导航到平台后台；
- 用户自己扫码/登录，应用不代输账号密码、不绕验证码；
- 应用只读**当前可见页面 DOM**（不抓私有 XHR / 不逆向接口），把表格行导入；
- 可选截图作为证据。

覆盖：百度搜索资源平台、头条、搜狗、360 等无读 API 平台。  
优点：能覆盖无 API 平台；登录发生在用户眼前。  
代价：平台 ToS 风险、DOM 维护、浏览器体积、会话 cookie 落盘、无法真正无人值守。  
**必须先有法务/产品书面确认，才可开启。**

### 路径 C：控制系统 Chrome（CDP）

- 启动用户已安装的 Chrome/Edge，带 `--remote-debugging-port`，复用用户现有 profile；
- 其余同路径 B。

优点：不用打包 Chromium；用户已有登录态。  
代价：端口/配置文件锁、跨平台差异、安全提示、支持成本高；仍然有 ToS 风险。  
建议：只作为高级模式，不默认开启。

### 路径 D：RPA / 截图 OCR

- 模拟点击 + 截图 OCR。
- 最脆弱、最容易被风控、维护成本最高；不推荐。

## 3. 合规边界（AGENTS 规则 11）

- 不实现“代客户登录”：不收集账号密码、不自动填登录表单、不绕验证码/风控。
- 不抓私有后台接口：只读用户当前可见页面 DOM；不逆向 XHR、不重放私有 API。
- 不把会话 cookie / 密码写进数据库；如使用浏览器助手，cookie 只存在本机浏览器 profile，并在界面明示。
- 外部研究数据仍按规则 11 标机构 + 年份 + 链接，默认不参与判定。

## 4. 已选择（2026-11-06）

- Google GSC：OAuth 已实现，每日拉取（启动即跑一次 + 每 24 小时）。
- Bing：API key 旧 JSON 端点实测 404；待 Bing OAuth client ID/secret 或当前 REST endpoint。
- 百度站长：**路径 C（控制系统 Chrome）** 已实现 `search_browser_open` / `search_browser_capture`；用户自行登录，只读可见 DOM 表格；接受 ToS 与维护风险。
- 百度统计：暂未接，需要单独 OAuth 应用。
- PDF/XLSX：报告导出已实现。

## 4.1 仍需补充的选择

1. **默认路线**：是否确认“GSC/Bing/百度统计走官方 OAuth/API；百度站长只做导出/粘贴/填报”？
2. **百度站长的自动化**：是否接受“用户在场的内置 Chromium 助手”（路径 B）？如果接受，需要法务/ToS 书面确认，并接受 DOM 维护成本。
3. **如果接受路径 B**：选内置 Chromium（路径 B）还是控制系统 Chrome（路径 C）？
4. **凭据**：请提供/注册 Google OAuth client（Desktop app）、Bing Webmaster API key（或 Entra OAuth 应用）、百度统计 OAuth 应用（如果做站内分析）。
5. **会话留存**：浏览器助手是否允许把登录态留在本机 profile？如果不允许，每次都要用户重新登录，自动化价值大幅下降。

## 5. 建议的落地顺序

1. GSC OAuth + Search Analytics 拉数（已开始）。
2. Bing 官方 API（API key 或 OAuth，按官方 REST 文档确认）。
3. 百度统计 OAuth（站内分析）。
4. 百度站长：先导出/粘贴；只有产品负责人选择路径 B/C 且法务确认后，再做浏览器助手。
5. 头条/搜狗/360：保持导出/粘贴；不提前投入浏览器自动化。

## 5.1 2026-11-06 实测补充：Bing API key

- 用现有的 Bing Webmaster API key 请求旧的 JSON 端点 `https://ssl.bing.com/webmaster/api.svc/json/GetSites`，返回 **404**（旧 SOAP/POX/JSON 通道已退役）。
- Bing 官方 OAuth 文档写明：
  - 在 Bing Webmaster Tools → Settings → API Access → OAuth Client 创建客户端；
  - 授权端点 `https://www.bing.com/webmasters/OAuth/authorize`；
  - token 端点 `https://www.bing.com/webmasters/oauth/token`；
  - scope 示例 `webmaster.manage`；
  - 需要 client ID + client secret + 已登记的 redirect URI。
- 结论：**API key 已不能直接用于旧接口**；要走 Bing 官方 OAuth，或拿到当前 REST API 的准确 base URL/scope。请提供 Bing OAuth client ID/secret（在 Bing 后台 API Access 创建），不要用旧 API key 硬接。
- 2026-11-06 已接 Bing OAuth：固定 loopback `http://127.0.0.1:17654/oauth2callback`、scope `Webmaster.read`；需要在 Bing 后台把 Redirect URI 改成这个值（原来的 `geo.gaodekuai.com` 当前 DNS 不解析）。拉数先走 `GetQueryStats`（Bearer），若该旧 JSON 端点已退役会在源状态写 `search_fetch_failed`，不伪造数据。
- 🔴 2026-11-06 追加：`geo.gaodekuai.com` 当前 **DNS 无法解析**，不能作为回调落点。桌面端 Bing OAuth 改用固定 loopback `http://127.0.0.1:17654/oauth2callback`；需要把 Bing OAuth Client 的 Redirect URI 改成这个值。若坚持用 `geo.gaodekuai.com`，需要先把该域名解析到一个能接收 code 并转发回客户端的服务。

## 6. 官方出处

- Google Search Console API：<https://developers.google.com/webmaster-tools/v1/searchanalytics/query>
- Google OAuth for installed apps（loopback）：<https://developers.google.com/identity/protocols/oauth2/native-app>
- Bing Webmaster API：<https://learn.microsoft.com/en-us/bingwebmaster/>
- 百度搜索资源平台：<https://ziyuan.baidu.com/>
- 百度统计 API：<https://tongji.baidu.com/>
