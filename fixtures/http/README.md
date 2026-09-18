# `fixtures/http/` 抓取测试夹具

虚构的中文 B2B 企业站「宏宇泵业」（上海宏宇水泵制造有限公司，工业水泵制造商）。
仅用于 `crates/geo-crawler` 的测试：测试通过 `wiremock` 在本地端口回放这些文件，
**任何测试都不得访问真实网络**（见 `AGENTS.md` 硬性规则 2）。

## 文件清单

| 文件 | 挂载路径 | 编码 | 用途 |
| --- | --- | --- | --- |
| `index.html` | `/` | UTF-8 | 首页。含品牌名/别名/成立年份/差异化/服务地域/案例，导航链接指向另外 4 页；含一条跨域链接 `https://example.com/partner`（必须被同域过滤丢弃）、一条 `/admin/secret`（必须被 robots 拦截进 `skipped`）、一个 `<script>` 块（含 canary `SCRIPT_CANARY_9f3a_must_not_leak`，正文提取结果中不得出现）。 |
| `about.html` | `/about.html` | UTF-8 | 关于我们/公司简介：成立年份 2006、注册资本、员工规模、资质（ISO9001:2015 / CCC / ISO14001 / CE / MA）、发展历程。 |
| `products.html` | `/products.html` | UTF-8 | 产品线：4 条产品线（HY-ISG 立式管道离心泵、HY-WQ 潜水排污泵、HY-XBD 消防恒压切线泵、HY-ZS 不锈钢化工泵），每条含型号、流量/扬程/功率参数与价格区间。 |
| `faq.html` | `/faq.html` | UTF-8 | 常见问题：7 组 Q&A，覆盖选型、交付周期、保修政策、售后响应、测试报告与资质文件、付款方式、非标定制。 |
| `contact.html` | `/contact.html` | UTF-8 | 联系我们：电话、邮箱、地址、邮编、4 个服务网点、服务地域与出口市场。 |
| `gbk-page.html` | `/gbk-page.html` | **GBK** | GBK 编码探测夹具：技术公告与服务承诺，含全角标点与 `℃ ± ① 《》` 等符号，`<meta charset="gbk">` 与 `<meta http-equiv="Content-Type" ... charset=gbk>` 双声明。**磁盘上的字节不是合法 UTF-8**（测试会断言这一点）。 |
| `robots.txt` | `/robots.txt` | ASCII | `User-agent: *` + `Disallow: /admin`；同时含 `Crawl-delay` 与 `Sitemap` 指令，用于验证解析时被忽略。 |
| `admin.html` | `/admin/secret` | UTF-8 | 必须永不被抓取的页面，含 canary `ADMIN_CANARY_7b2e`；由 `index.html` 链接。`site.rs::robots_blocked_page_lands_in_skipped_with_robots_reason` 断言：该 URL 落进 `skipped` 且 `reason` 含 `robots`、不出现在 `pages` 里、任何页面正文都不含该 canary，且 wiremock 收到 **0 条** `/admin/secret` 请求（robots 拦截必须发生在发请求之前，而不是抓回来再丢）。 |
| `README.md` | — | UTF-8 | 本文件。 |

## 实体卡字段覆盖

首页 + 4 个子页合计覆盖 `geo_domain::entity_card::REQUIRED_FIELDS` 的全部 10 项：
`standard_name`（宏宇泵业）、`aliases`（上海宏宇水泵/宏宇水泵/Hongyu Pump）、`founded_year`（2006）、
`qualifications`（ISO9001:2015、CCC、ISO14001、CE、MA）、`products`（4 条产品线含型号与参数）、
`price_range`（1,800–65,000 元/台）、`service_regions`（国内 26 个省级行政区 + 东南亚/中东）、
`cases`（3 个典型案例）、`differentiators`（逐台水力实测、非标定制、48 小时备件、工程师参与选型）、
`contact`（电话/邮箱/地址）。全部文案不含 `crates/geo-domain/data/adlaw_terms.txt` 中的绝对化用语
（有测试直接调用 `geo_domain::compliance::scan` 校验）。

## 页面互链

5 个页面的 `<nav>` 与正文均互相链接，BFS 从 `/` 出发即可发现全部 5 页（`/admin/secret` 被 robots 拦截，
`https://example.com/partner` 被同域过滤丢弃，`/gbk-page.html` 未被任何页面链接，仅供编码测试单独挂载）。

## 重新生成 GBK 夹具

`gbk-page.html` 必须是 GBK 字节。修改内容时先写 UTF-8 源文件，再转换：

```bash
iconv -f UTF-8 -t GBK /tmp/gbk-source.html > fixtures/http/gbk-page.html
# 校验：不是合法 UTF-8（退出码非 0 才正确）
iconv -f UTF-8 -t UTF-8 fixtures/http/gbk-page.html > /dev/null
```
