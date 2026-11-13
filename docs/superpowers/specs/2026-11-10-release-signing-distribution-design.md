# 发布工程：许可证 / 签名公证 / CI 打包 / 下载分发 设计

> 状态：设计定稿，Week 1–2 已落地到仓库（2026-11-10）；Week 3（自动更新）与「发布前」实测为待执行
> 关联：`AGENTS.md`（硬性规则 3 / 6 / 10 / 11）、`docs/superpowers/current-state.md` §分发、`docs/legal/`
> 上游事实核对时间：2026-11-10，依据 Tauri 官方文档 `distribute/sign/macos`、`distribute/sign/windows`（页面 Last updated: Oct 27, 2026）、`plugin/updater`，以及 `tauri-apps/tauri-action` v1 的 `action.yml`

## 0. 这份文档解决什么

产品功能已经能跑，但**不能交付给客户**：没有许可证、安装包没签名、macOS 会被 Gatekeeper 拦、
Windows 11 开了 Smart App Control 会**直接拒绝运行**、下载页与隐私政策缺失。
本文是发布工程的唯一裁定源，按「Week 1 / Week 2 / Week 3 / 发布前」四段推进。

**最小可发布集**（0.1 必须全绿）：LICENSE + 签名公证 + 隐私政策 + 干净的公开仓库。
自动更新与 Linux 推到 0.2。

## 1. 现状盘点（2026-11-10 实测）

| 项 | 现状 | 结论 |
|---|---|---|
| 仓库 | `git@github.com:avehub/geo.git`，3326 objects / 19.88 MiB | 可公开，无大文件问题 |
| LICENSE | **无** | 必须补（§2 DR-R1） |
| SECURITY.md / CONTRIBUTING.md | **无** | 必须补 |
| `.superpowers/` | 未跟踪，但**也没进 `.gitignore`** | 高风险：一次 `git add -A` 就入库（§7） |
| 版本号 | `tauri.conf.json` / `Cargo.toml` workspace / `ui/package.json` 三处各写一份 `0.1.0` | 需要单一真值源脚本（DR-R6） |
| CI | `.github/workflows/ci.yml`：rust + ui 两个门禁 job 跑在 docker 一致性镜像里；另有 `workflow_dispatch` 的 **未签名** bundle job | 门禁保留；发布产物改由 `release.yml` 出（DR-R5） |
| 更新器 | 未装 `tauri-plugin-updater`，`createUpdaterArtifacts` 未开 | 0.2（DR-R8） |
| bundle 产物目录 | **`<repo>/target/release/bundle/`**（workspace 根的 `target/`），不是 `apps/desktop/src-tauri/target/` | ⚠ `ci.yml` 的 bundle job 原本写错路径，配合 `if-no-files-found: error` 会**永远失败**；本轮已修正 |
| 历史密钥 | 1670 个历史 blob 全扫，只命中 3 个**测试哨兵串**（`sk-SENTINEL-DO-NOT-LEAK-0001` / `sk-demo-0123456789abcdef` / `sk-echoed-by-the-gateway-0123456789`，分别在 `prompt_service.rs:1175`、`llm-models.test.ts:24`、`secret.test.ts:22`） | 历史干净，无需 filter-repo |

## 2. 裁定（DR-R 系列）

### DR-R1 许可证：专有（All Rights Reserved）+ 仓库可公开阅读

`Cargo.toml` 的 `workspace.package.license` 本来就是 `"UNLICENSED"`，与之一致。
这是面向国内中小企业的**付费桌面工具**，公开源码只用于「客户可查看、可审计数据流向」，
不等于授予复制/分发/二次商用权利。

- `LICENSE` 写专有许可全文（© 2026 稿得快 / avehub，保留所有权利）。
- `Cargo.toml` 的 `license = "UNLICENSED"` **保持不变**（SPDX 里 `UNLICENSED` 就是「未授予开源许可」的正确表达）。
- **改主意的成本**：若日后要转开源，只需替换 `LICENSE` 全文 + 改 `Cargo.toml` 的 `license` 为 `Apache-2.0`/`MIT` + 改 README 许可证段。**注意**：一旦公开发布过专有版本，已分发出去的副本仍受原条款约束；转开源只影响之后的版本。
- 推荐 Apache-2.0 而非 MIT 的场景：想靠社区贡献获客，且在意**专利授权条款**（MIT 无明示专利授权）。

### DR-R2 首发平台：macOS（arm64 + x86_64）+ Windows（x64 NSIS）

- macOS 出**两个 DMG**（Apple Silicon / Intel），不出 universal。理由：universal 要求全部依赖对双架构都可编译，`headless_chrome` + `sqlx` bundled 组合风险高、构建时间翻倍；两个 DMG + 下载页一段 arch 探测 JS 更稳。要改 universal 只需把 `--target` 换成 `universal-apple-darwin`。
- Windows 只出 **NSIS（`-setup.exe`）**，不出 MSI。理由：NSIS 支持静默/被动安装、单文件、自动更新时体积更小；MSI 对企业 GPO 分发才有优势，0.1 不需要。
- **Linux 推到 0.2**：无签名门槛但要额外维护 AppImage/deb 与 glibc 兼容矩阵，0.1 不做。
- bundle targets 已是 `"all"`，由 `release.yml` 的 `--bundles` 参数收窄到实际要发的格式。

### DR-R3 Windows 签名：Store MSIX 主通道 + 直下载备通道（2026-11-13 修订）

**修订裁定（2026-11-13，推翻本节原裁定）**：Azure Artifact Signing 对本主体**不可用**；
Windows 改走 **Microsoft Store MSIX 主通道**（微软重签、免费、无 SmartScreen 警告、SAC 可装），
直下载 NSIS 通道短期不签名、后续补商业 CA 的 OV 云签名。

事实依据（2026-11-13 浏览器实测 + 微软现行文档）：

1. **地理资格**：Artifact Signing 公共信任仅适用于 **US / CA / EU / UK 的组织**与 **US / CA 的个人开发者**，
   组织还要求**三年或以上可验证税务记录**。本主体结算地为中国大陆 → 只能拿**专用信任**；
   专用信任的根不在客户机器上，对公开分发无意义（FAQ 原文："此限制不适用于专用信任证书"）。
2. **Azure 前置缺失**：两个 Microsoft 账号（501232866@qq.com / avework@outlook.com）均**无 Azure 订阅**，
   资源提供程序注册与账户创建都无从谈起；为不可达的资格绑卡开订阅是纯浪费。
3. **Store 通道反而更优**（微软官方代码签名对比表首推）：MSIX 认证通过后由 **Store 用微软证书重签**——
   免费、**无 SmartScreen 警告**、Smart App Control 开启的机器可装；开发者注册费已取消
   （2025 免个人、2026-05 免公司）；非游戏类应用可接**自有支付**并保留 100% 收入。
4. **帐户实测**：Partner Center 个人开发者帐户**状态=活动**（卖家 ID 97279770，发布者显示名"众友合"），
   `稿得快GEO` 名称已保留（Store ID 9MSXNS1VDQ50）。首版先用个人帐户跑通；公司帐户（邓白氏已备好）
   作为后续品牌升级——个人→公司**不可转换**，需新建帐户并重新保留名称。

落地形态：

- `release.yml` 新增 `msix` job：`tauri build --bundles none` → `scripts/msix-manifest.sh` 渲染清单 →
  `makeappx pack`（不签名）。清单 Identity 三要素钉死在
  `apps/desktop/src-tauri/msix/AppxManifest.xml`，由 `scripts/tests/msix-manifest.test.sh` 守护：
  Name=`F73A5A8D.GEO`、Publisher=`CN=CB52BB16-C062-4464-AAA0-CAEA878E6358`、PublisherDisplayName=`众友合`
  （与 Partner Center「产品标识」页逐字一致，错一个字符认证即失败）。
- MSIX 产物**只**进 workflow artifact（`store-msix-x64`），**不**进 Release asset：未自签 MSIX 在
  Store 之外装不了，放出去只会误导客户。上传 Store 目前手工（Partner Center → 程序包），
  0.2 再评估 Store Developer CLI / Submission API 自动化。
- 直下载 NSIS 通道当前**不签名**：下载页必须如实写明 SmartScreen 提示与绕过步骤（继承原裁定文案纪律）。
  补签方案＝商业 CA 的 **OV 代码签名 + 云签名 HSM**（GitHub Actions 插不了 UKey，UKey 款直接排除）；
  已取得的邓白氏编号即 CA 核身材料。单独立项，不阻塞 Store 首版。
- §7 的六个 `AZURE_*` 条目**作废**；Store 通道**不需要任何 secret / variable**。

已知容器化代价（干净机器实测后回填 `current-state.md`）：打包应用的 `%APPDATA%` 等已知文件夹被重定向到
`%LOCALAPPDATA%\Packages\<PFN>\LocalCache\…`（PFN=`F73A5A8D.GEO_hbxpqea2bc6ae`），Store 版与直装版
**数据不互通**、隐私政策的"彻底删除"指引需分通道写（叠加未决风险 #12）；Store 通道**禁用**
tauri-plugin-updater（更新走 Store，DR-R8 按通道拆分）；WebView2 缺失机器需启动检测或包内 fixed-version。

> **原裁定摘要（2026-11-10，已作废）**：曾选 Azure Artifact Signing（月费约 $9.99、Tauri `signCommand`
> 集成、无需 UKey），理由是 2024 年起 EV 证书不再有 SmartScreen 即时信誉。该裁定隐含
> "主体位于 US/CA/EU/UK" 的前提；前提不成立即整体作废。原六步推进清单见 §4.5 修订前版本（git 历史）。

### DR-R4 macOS 公证：走 App Store Connect API Key，不走 Apple ID + 专用密码

两条路 Tauri 都支持：

| 路线 | 环境变量 | 取舍 |
|---|---|---|
| App Store Connect API Key（**选这个**） | `APPLE_API_ISSUER` / `APPLE_API_KEY` / `APPLE_API_KEY_PATH` | 可细粒度授权、可轮换、可单独吊销；不受 Apple ID 改密码 / 双重认证影响 |
| Apple ID + 专用密码 | `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID` | 配置简单，但专用密码绑在个人 Apple ID 上，人员变动即失效 |

⚠ `APPLE_API_KEY_PATH` 要的是**文件路径**，不是内容。CI 里必须先把 secret 写成临时 `.p8` 文件再导出路径：

```bash
mkdir -p "$RUNNER_TEMP/appstoreconnect"
printf '%s' "$APPLE_API_KEY_CONTENT" > "$RUNNER_TEMP/appstoreconnect/AuthKey_$APPLE_API_KEY.p8"
chmod 600 "$RUNNER_TEMP/appstoreconnect/AuthKey_$APPLE_API_KEY.p8"
echo "APPLE_API_KEY_PATH=$RUNNER_TEMP/appstoreconnect/AuthKey_$APPLE_API_KEY.p8" >> "$GITHUB_ENV"
```

### DR-R5 CI：正式产物只由 `release.yml` 出，`ci.yml` 只做门禁

- 新增 `.github/workflows/release.yml`：`push: tags: ["v*"]` + `workflow_dispatch` 触发。
- `ci.yml` 里那个 `workflow_dispatch` 的未签名 bundle job **保留**但降级为「打包冒烟」——
  它验证的是「能不能打出来」，不是「能不能发」。`release.yml` 验证的是后者。
  两者不冲突，因为都不在 push/PR 上跑，不占门禁时间。
- `release.yml` 的 macOS job 分两步跑：先 `security` 建临时钥匙串导入 `.p12`，再交给
  `tauri-apps/tauri-action@v1` 构建。
  ⚠ Tauri 官方示例里那句 `grep "Apple Development"` **对我们是错的**——那是开发证书。
  站外分发必须用 **`Developer ID Application`**，过滤串要改成 `"Developer ID Application"`。
  用错证书的后果：签名能过，但公证失败 / Gatekeeper 仍拦。

### DR-R6 版本号单一真值源：`tauri.conf.json` 的 `version`

三处版本号必然漂移。`scripts/version.sh` 收口：

```bash
mise run version:get              # 打印当前版本（读 tauri.conf.json）
mise run version:set -- 0.1.1     # 同步写三处 + 刷新 Cargo.lock + 校验一致
mise run version:check            # 只校验三处是否一致，不一致退出非 0（CI 用）
```

写集：`apps/desktop/src-tauri/tauri.conf.json`、`Cargo.toml`（`[workspace.package].version`）、
`apps/desktop/ui/package.json`，然后 `cargo update --workspace` 让 `Cargo.lock` 跟上。

**纪律**：打 tag 前先 `version:set`，tag 名与 `version` 必须一致（`release-check.sh` 会校验）。

### DR-R7 产物完整性：`SHA256SUMS.txt` 作为 release asset

`release.yml` 在上传前对所有安装包算 SHA-256，生成一份 `SHA256SUMS.txt` 一起传。
下载页展示校验值。客户侧核验：

```bash
shasum -a 256 -c SHA256SUMS.txt        # macOS
certutil -hashfile gdk-geo_0.1.0_x64-setup.exe SHA256   # Windows
```

### DR-R8 自动更新推到 0.2，且必须一次性原子开启

**不要在 0.1 提前打开 `createUpdaterArtifacts`。** 一旦置 `true`，Tauri 构建就**强制要求**
`TAURI_SIGNING_PRIVATE_KEY` 存在，否则 `mise run dev` / `mise run build` / CI 门禁**全部失败**。
这是个会让所有人卡住的坑，所以 0.2 开启时必须一个提交里同时做完这五件事：

1. `pnpm --dir apps/desktop/ui add @tauri-apps/plugin-updater`（+ Rust 侧 `tauri-plugin-updater`，`lib.rs` 注册 `.plugin(tauri_plugin_updater::Builder::new().build())`）
2. `pnpm --dir apps/desktop/ui exec tauri signer generate -w ~/.tauri/gdk-geo-updater.key` 生成 minisign 密钥对；**私钥离线保存 + 进 GitHub Secret `TAURI_SIGNING_PRIVATE_KEY`**，公钥进配置
3. `tauri.conf.json`：`bundle.createUpdaterArtifacts: true` + `plugins.updater.pubkey`（**必须是公钥字符串本身，不能是文件路径**）+ `plugins.updater.endpoints`
4. `capabilities/default.json` 加 `updater:default` 权限
5. `release.yml` 的 tauri-action 步骤加 `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 环境变量

endpoint 用 GitHub Releases 静态 JSON 即可，无需自建服务：

```json
"endpoints": ["https://github.com/avehub/geo/releases/latest/download/latest.json"]
```

`tauri-action` 的 `uploadUpdaterJson` 输入**默认就是 `true`**，会自动生成并上传 `latest.json`。
Windows 侧再加 `"updaterJsonPreferNsis": true`，让 latest.json 指向 `-setup.exe` 而不是 `.msi`
（我们只发 NSIS，见 DR-R2）。

⚠ **前提**：仓库必须是 public，否则 `releases/latest/download/` 匿名拉不到，更新检查会 401/404。
若坚持 private，就得自建带鉴权的更新端点。

### DR-R9 密钥永不落仓库

延续 AGENTS 规则 3。发布工程新增的敏感物一律只进 GitHub Secrets，本地只进钥匙串：

- `.gitignore` 补 `*.p12` / `*.p8` / `*.mobileprovision` / `.tauri/` / `certificate-base64.txt`
- `scripts/release-check.sh` 在打包前扫工作区，命中即失败
- 更新器私钥（`~/.tauri/*.key`）放**仓库外**的家目录，永不入仓

### DR-R10 仓库公开范围

公开前必须逐项确认（`release-check.sh` 覆盖可自动化的部分，其余是人工走查）：

| 项 | 处置 |
|---|---|
| `.superpowers/` | 加 `.gitignore`（内部 SDD 任务简报/review/diff，含开发过程噪音，不该公开） |
| `docs/superpowers/` | **保留公开**。这是产品设计与裁定记录，公开反而是信任资产；但需人工通读一遍确认无客户真名 |
| `fixtures/` | **保留公开**（离线测试录制数据）。需人工确认录制的页面/LLM 响应里无真实客户品牌数据与真实 Key |
| `docs/GEO客户端-MVP产品定义-v1.md` | 产品定义真值源。确认是否愿意公开竞品分析与定价思路；不愿意就移到私有仓库 |
| `brand/icon-source.png` | 保留 |
| git 历史 | 已扫，干净（§1）。**注意**：公开后历史不可撤回，若日后发现敏感内容需 `git filter-repo` + force push，属规则 10 禁止的破坏性操作，须显式授权 |

### DR-R11 合规扫描覆盖新增文档

AGENTS 规则 6 的绝对化用语禁令同样适用于 `LICENSE` / `README` / `SECURITY.md` /
`CONTRIBUTING.md` / `docs/legal/*`。`release-check.sh` 内置扫描：
`保证排名|霸屏|排名第一|全网第一|guaranteed ranking|#1`。
否定式表述（「不承诺排名」「无法保证收录」）是**允许且必要**的，不在扫描范围内。

## 3. Week 1 落地清单（本轮已完成）

| 产出 | 路径 |
|---|---|
| 专有许可证 | `LICENSE` |
| 漏洞报告通道 | `SECURITY.md` |
| 贡献指南 | `CONTRIBUTING.md` |
| 文档分级索引 | `docs/README.md` |
| 版本单一真值源 | `scripts/version.sh` |
| 发布前门禁 | `scripts/release-check.sh` |
| 产物签名/公证核验 | `scripts/verify-bundle.sh` |
| 签名凭据向导 | `scripts/setup-signing.sh` |
| tag 触发发布流水线 | `.github/workflows/release.yml` |
| Release 正文模板（含安全提示与免责说明） | `.github/release-notes-template.md` |
| `.superpowers/` 与证书文件 ignore | `.gitignore` |
| mise 任务 | `.mise.toml`（`version:*` / `release:*`） |

## 4. Week 2：Apple Developer ID + 公证跑通

### 4.1 先确认账号等级（最容易踩空的一步）

Tauri 文档原文：**免费 Apple Developer 账号无法公证**，应用仍会显示「未验证」。
用户口语里的「iOS 开发者账号」需要确认是**付费 Apple Developer Program（99 美元/年）**：

```bash
open "https://developer.apple.com/account"        # 看 Membership 是否 Active、Expiration 日期
security find-identity -v -p codesigning            # 本地已有签名身份时会列出来
```

### 4.2 建 Developer ID Application 证书

⚠ **只有 Account Holder 角色能创建 `Developer ID Application` 证书**（Tauri 文档明确）。
如果你不是账号持有人，需要持有人操作，或请持有人把你提为 Admin 并由持有人授权。

1. 本机生成 CSR：钥匙串访问 → 证书助理 → **从证书颁发机构请求证书** → 存 `CertificateSigningRequest.certSigningRequest`
   （注意：Tauri 文档提到 CSR 可以用**另一个用户邮箱**生成，从而把证书绑到别的 Apple ID 上）
2. <https://developer.apple.com/account/resources/certificates/add> → 选 **Developer ID Application**（不是 Apple Distribution，那是 App Store 用的）→ 上传 CSR → 下载 `.cer`
3. 双击 `.cer` 装进 login 钥匙串
   ⚠ 下载时若没进对位置：确认「钥匙串访问 → 默认钥匙串」里 **login** 是被选中的
4. 证书只有**关联到你的 Apple ID** 才有效。无效证书**不会**出现在
   「钥匙串访问 → 我的证书」标签页，也不会出现在 `security find-identity -v -p codesigning` 输出里
   ——这是判断证书是否可用的权威方法

### 4.2b 实测补充：openssl-CSR 路线（2026-11-11 已跑通，推荐）与三个坑

§4.2 的「钥匙串访问 → 证书助理」是 Apple 文档路线，但**证书助理在菜单栏**
（`钥匙串访问` 菜单 → `证书助理`），不在左侧边栏，很容易找不到。
更稳的是 openssl 路线——私钥直接是文件，正好是 CI 需要的形态，全程可脚本化：

```bash
D="$HOME/.config/gdk-geo"; mkdir -p "$D"; chmod 700 "$D"; cd "$D"
openssl req -new -newkey rsa:2048 -nodes \
  -keyout developer-id.key -out developer-id.csr \
  -subj "/emailAddress=<Apple ID 邮箱>/CN=<姓名拼音>/OU=<TeamID>/C=CN"
chmod 600 developer-id.key
# 把 developer-id.csr 上传到 developer.apple.com/account/resources/certificates/add
# （类型选 Developer ID Application），下载 .cer 后：
openssl x509 -inform der -in <下载的>.cer -out developer-id.pem
```

CSR 的 CN 会被 Apple 覆盖（签发后 CN = `Developer ID Application: <实体名> (<TeamID>)`），
所以 CN 填什么都行；RSA 必须是 2048。

**三个实测坑**（都已在 `~/.config/gdk-geo/finish-cert.sh` 里处理）：

1. **OpenSSL 3 的 PKCS#12 默认算法 macOS 钥匙串读不了**。`openssl pkcs12 -export` 默认用
   AES-256/PBES2，`security import` 报 `MAC verification failed (wrong password?)`——密码没错，
   是算法不兼容。必须加 `-keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1`。
2. **新签发的 Developer ID 走 G2 中间证书**，而 macOS 系统钥匙串里通常只有 G1
   （`OU=Apple Certification Authority`，2027-02 到期）。缺 G2 时
   `security find-identity -v -p codesigning` **不会**把它列成有效身份。
   G2 的权威下载地址在**叶子证书的 AIA 扩展**里：
   `openssl x509 -in developer-id.pem -noout -text | grep -A1 "CA Issuers"`
   → `http://certs.apple.com/devidg2.der`。
   ⚠ `www.apple.com/certificateauthority/DeveloperIDG2CA.cer` 这个老 URL 现在返回 **403**。
   把 G2 作为 `-certfile` 打进 `.p12` 一起导入即可补齐链。
3. **`security import` 进来的私钥，codesign 不能免提示使用**：非 GUI 上下文直接报
   `errSecInternalComponent`。两条出路：
   - 本地日常构建：`security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "<登录密码>" ~/Library/Keychains/login.keychain-db`（要登录密码，**只能本人跑**）；
   - CI / 一次性验证：自建临时钥匙串（密码自己定），`set-key-partition-list` 用那个密码，
     再 `security list-keychains -d user -s <临时> <原列表>` 把它放搜索列表最前，用完删掉。
     2026-11-11 用这条验证通过：`Authority=Developer ID Application: …` +
     `flags=0x10000(runtime)` + `--verify --deep --strict` 全过。

### 4.3 本地跑通签名 + 公证

```bash
mise run signing:wizard                 # 交互式向导，逐步带你做 4.2/4.4 并写入 GitHub Secrets
export APPLE_SIGNING_IDENTITY="Developer ID Application: <你的名字> (<TEAMID>)"
export APPLE_API_ISSUER="..." APPLE_API_KEY="..." APPLE_API_KEY_PATH="/path/AuthKey_XXXX.p8"
cd apps/desktop && pnpm exec tauri build --bundles dmg --target aarch64-apple-darwin
cd - && mise run release:verify         # 核验签名 / 公证 / staple 票据
```

首次公证若想跳过 staple 单独验一遍：`pnpm exec tauri build --bundles dmg --skip-stapling`。
**Developer ID Application 证书必须公证**（Tauri 文档原文：Notarization is required when using a Developer ID Application certificate）。

### 4.4 App Store Connect API Key

1. <https://appstoreconnect.apple.com/access/integrations/api> → **Integrations** 标签 → Add → 名字随意 + 访问权限选 **Developer**
2. `APPLE_API_ISSUER` = 密钥表格**上方**显示的那串 Issuer ID
3. `APPLE_API_KEY` = 表格 **Key ID** 列
4. 下载 `.p8` 私钥 —— **只能下载一次**，且只在**页面刷新后**才出现下载按钮（在新建那一行）

### 4.5 Windows 侧：Store MSIX 主通道（2026-11-13 修订）

原"并行推进 Azure Artifact Signing"六步清单**作废**（资格不成立，见 DR-R3 修订）。现行序列：

1. ✅ Partner Center 个人开发者帐户已验证（卖家 ID 97279770，发布者显示名"众友合"）；`稿得快GEO` 名称已保留。
2. ✅ 仓库侧落地（2026-11-13）：`release.yml` 的 `msix` job + `msix/AppxManifest.xml` 模板 +
   `scripts/msix-manifest.sh` 渲染脚本 + `scripts/tests/msix-manifest.test.sh` 守护测试（已接 `mise run test`）。
3. 提交首版：补完商店一览 / 属性 / 年龄分级 / **AI 披露** → 下载 `store-msix-x64` artifact 上传 → 认证。
4. 干净 Windows 机实测：安装、启动、采集链路、数据落盘路径（`Packages\<PFN>\LocalCache\…`）、SAC 开启态。
5. 后续：公司开发者帐户（邓白氏）承接品牌；直下载通道补 OV 云签名；0.2 评估 Store CLI 自动上传。

⚠ 提交问卷中"是否使用生成式 AI"必须如实勾选并写清内容审核策略；采集链路属客户端行为、认证不会测，
但用户协议需保留速率与合规约束文案（第三方投诉的长尾风险）。

## 5. Week 3：SHA256SUMS + 下载页 + 法务文档

- `SHA256SUMS.txt`：`release.yml` 已自动生成并上传（DR-R7）
- 隐私政策 / 用户协议：`docs/legal/privacy-policy.zh-CN.md`、`docs/legal/terms-of-service.zh-CN.md`
  （草稿已产出，**发布前必须法务复核 + 补齐全部 `【待填：…】` 占位符**）
- 官网下载页要点（不在本仓库，属官网工程）：
  - macOS 按 `navigator.userAgent` 里的 `Macintosh` + `navigator.userAgentData`/UA 探测 Apple Silicon vs Intel，默认给 Apple Silicon 并**同时显式列出** Intel 链接（探测不可靠时用户能自己选）
  - 展示 `SHA256SUMS` 校验值与核验命令
  - **如实写明** Windows SmartScreen 可能仍会警告 + 绕过步骤；**不得**写「无警告」「完全信任」
  - 隐私政策 / 用户协议链接必须与安装包内展示的文本同源
  - 全站遵守 AGENTS 规则 6：不得出现「保证排名 / 霸屏 / 第一 / 最」
- 自动更新：见 DR-R8，**本轮不做**

## 6. 发布前：干净机器实测

| # | 场景 | 期望 |
|---|---|---|
| 1 | 干净 Mac（Apple Silicon，**从没装过 Xcode CLT**），Safari 下载 DMG → 双击挂载 → 拖进 Applications → 启动 | 无「已损坏」/「无法验证开发者」；Gatekeeper 放行 |
| 2 | 同上，Intel Mac | 同上 |
| 3 | 干净 Mac 终端核验 | `spctl -a -vvv -t install /Applications/gdk-geo.app` 返回 `accepted` + `source=Notarized Developer ID`；`codesign -dv --verbose=4` 显示 `Developer ID Application`；`stapler validate` 通过 |
| 4 | 干净 Windows 10/11，Edge 下载 `-setup.exe` → 运行 | SmartScreen 行为如实记录（首次发布**预期会**有警告）；点「更多信息 → 仍要运行」后能装完并启动 |
| 5 | Windows 11 **开启 Smart App Control** | 未签名会被完全阻止且无法单应用放行——用这条验证「已签名」确实生效 |
| 6 | 装完后功能冒烟 | 新建项目 → 存一个 LLM API Key（确认真的进了系统钥匙串 / Windows 凭据管理器，而非 SQLite）→ 跑一次采集 → 导出一份报告 |
| 7 | 卸载 | macOS 拖废纸篓 + 确认残留数据目录位置并告知用户；Windows 控制面板卸载干净 |
| 8 | 仓库公开范围 | 按 DR-R10 逐项人工走查 |

第 3 条可脚本化，其余必须真人 + 真机。自动化门禁（`mise run check`）**不含**「点开窗口看一眼」。

## 7. GitHub Secrets 清单（唯一权威表）

`release.yml` 引用的每一个 secret 都必须在这里登记；`scripts/setup-signing.sh` 写的每一个
secret 名都必须与这里一致。新增/改名时三处同步。

| Secret | 用于 | 来源 | 必需 |
|---|---|---|---|
| `APPLE_CERTIFICATE` | macOS 签名 | `.p12` 导出的 base64（`openssl base64 -A -in cert.p12`） | macOS 必需 |
| `APPLE_CERTIFICATE_PASSWORD` | macOS 签名 | 导出 `.p12` 时自定的密码 | macOS 必需 |
| `KEYCHAIN_PASSWORD` | macOS CI 临时钥匙串 | 任意随机串，CI 内部用 | macOS 必需 |
| `APPLE_SIGNING_IDENTITY` | macOS 签名 | `security find-identity -v -p codesigning` 里 **Developer ID Application** 那一行的完整名称 | macOS 必需 |
| `APPLE_API_ISSUER` | 公证 | App Store Connect → Integrations → Issuer ID | macOS 必需 |
| `APPLE_API_KEY` | 公证 | 同上，Key ID | macOS 必需 |
| `APPLE_API_KEY_CONTENT` | 公证 | `.p8` 私钥**文件内容**（CI 里落成临时文件后导出 `APPLE_API_KEY_PATH`，见 DR-R4） | macOS 必需 |
| `AZURE_TENANT_ID` | ~~Windows 签名~~ | — | **作废（2026-11-13，DR-R3 修订）** |
| `AZURE_CLIENT_ID` | ~~Windows 签名~~ | — | **作废（2026-11-13，DR-R3 修订）** |
| `AZURE_CLIENT_SECRET` | ~~Windows 签名~~ | — | **作废（2026-11-13，DR-R3 修订）** |
| `TAURI_SIGNING_PRIVATE_KEY` | 自动更新（0.2） | `tauri signer generate` 产出的私钥 | 0.2 才需要 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 自动更新（0.2） | 生成时自定密码 | 0.2 才需要 |

**非密**配置走 GitHub **Variables**（`vars.*`）——不是 Secret，可在仓库设置里明文查看：

| Variable | 用于 | 来源 | 必需 |
|---|---|---|---|
| `AZURE_CODESIGN_ENDPOINT` | ~~Windows 签名~~ | — | **作废（2026-11-13，DR-R3 修订）** |
| `AZURE_CODESIGN_ACCOUNT` | ~~Windows 签名~~ | — | **作废（2026-11-13，DR-R3 修订）** |
| `AZURE_CODESIGN_PROFILE` | ~~Windows 签名~~ | — | **作废（2026-11-13，DR-R3 修订）** |

⚠ **2026-11-13 修订（DR-R3）**：上表六个 `AZURE_*` 条目**整体作废**——中国大陆主体拿不到
Artifact Signing 公共信任，且两个 Microsoft 账号均无 Azure 订阅。Windows 主通道改走 Microsoft Store
MSIX（`release.yml` 的 `msix` job），**不需要任何 secret / variable**。直下载通道后续补商业 CA 的 OV
云签名时，新凭据按本表流程登记并三处同步（本表 / `release.yml` / `setup-signing.sh`）。

`release-check.sh` 会反向核对：`release.yml` 里出现的每一个 `secrets.X` 与 `vars.X`
都必须在上面两张表登记，否则 FAIL。改名时三处（本表 / release.yml / setup-signing.sh）同步。

## 8. 本轮已验证（2026-11-10，Apple Silicon 宿主机）

以下是**实际跑出来**的结果，不是推断：

| 验证项 | 命令 | 结果 |
|---|---|---|
| 三处版本号一致 | `mise run version:check` | PASS，均为 `0.1.0` |
| 版本同步可逆 | `version.sh set 0.1.1` → `set 0.1.0` | 往返后与原始 4 个文件（含 `Cargo.lock`）**逐字节相同**；`Cargo.lock` 里 5 个 workspace 成员版本同步更新 |
| 只改目标 version 键 | 同上 diff | `Cargo.toml` 仅第 12 行（`[workspace.package].version`）变化，依赖版本行未被误改 |
| 真实构建 | `cd apps/desktop && ./ui/node_modules/.bin/tauri build --bundles dmg,app` | `Finished release profile in 3m 51s`，产出 `target/release/bundle/dmg/gdk-geo_0.1.0_aarch64.dmg`（8.8 MB）+ `bundle/macos/gdk-geo.app` |
| 产物命名与发布正文模板一致 | `ls target/release/bundle/dmg` | `gdk-geo_0.1.0_aarch64.dmg` —— `.github/release-notes-template.md` 里的 `gdk-geo_{{VERSION}}_aarch64.dmg` 占位符替换后完全对得上 |
| `verify-bundle.sh` 能识别未签名产物 | `mise run release:verify` | **FAIL 7 项**：未签名 / hardened runtime 未启用 / TeamIdentifier 缺失 / codesign 校验失败 / 未见 Notarized Developer ID / staple 票据缺失 / DMG 票据缺失 |
| 全 git 历史无真实凭据 | 1670 个 blob 全扫 | 只命中 3 个测试哨兵串（§1） |

⚠ 两个**宿主机特有**的坑，写在这里避免下次重新踩：

1. **本机 `spctl --status` = `assessments disabled`**，所以本地任何 `spctl -a` 返回的 `accepted`
   都**不是证据**。`verify-bundle.sh` 现在会显式告警。真正的 Gatekeeper 判定只能在
   §6 的干净机器上做。
2. **`spctl --status` 在 disabled 时退出码是 1**。脚本开了 `pipefail`，
   所以 `spctl --status | grep -q …` 会被判成 false 而**静默跳过**告警。
   已改成先 `$(spctl --status || true)` 取值再 grep。

## 9. 未决风险

1. **Apple 账号等级未确认**：若注册的是免费账号，Week 2 全线阻塞，必须先升级到付费 Program。
2. **Account Holder 角色未确认**：不是持有人就建不了 Developer ID Application 证书。
3. **Azure Artifact Signing 组织验证周期未知**：可能几天。这是 Windows 侧唯一的外部依赖，越早提交越好。
4. **SmartScreen 信誉冷启动**：即使签了名，0.1 头几个版本仍可能弹警告。这是平台机制，
   只能靠「同一证书持续签名 + 提交 Microsoft 人工复核」缓解，**不能对客户承诺无警告**。
5. **`headless_chrome` 与公证的兼容性未实测**：该依赖会拉起本地 Chrome 做元宝采集。
   公证的自动化恶意代码扫描一般不管这个，但** hardened runtime 下派生子进程**可能受
   library validation 影响。Week 2 本地跑通后必须实测一次元宝采集链路（§6 第 6 条的扩展）。
6. **`fixtures/` 与 `docs/superpowers/` 的人工通读未做**：DR-R10 要求，目前只做了自动化密钥扫描。
7. **仓库转 public 的动作本身不可逆**（历史随之公开），属规则 10 的边界，需产品负责人显式确认。
8. **法务文档尚是草稿**：`docs/legal/*` 有 `【待填：…】` 占位符，未过法务不得对外发布。
9. **著作权主体名待确认**：`LICENSE` 抬头目前写 `稿得快（gdk_auto_article）`，
   与 `Cargo.toml` 的 `authors = ["稿得快 <dev@gaodekuai.local>"]` 保持一致。
   对外发布前应换成**登记的公司全称**（营业执照上的名称），`dev@gaodekuai.local`
   这个 `.local` 邮箱也是占位，须换成真实可达的域名邮箱。
10. **`SECURITY.md` 的安全联系邮箱是 `【待填】`**：`release-check.sh` 会因此 FAIL。
    漏洞报告通道必须在仓库公开前就可用，否则外部研究者无处可报。
11. **`release.yml` 尚未在真实凭据下跑通过**：本轮只做了**未签名**本地构建与脚本判定逻辑验证
    （见 §8）。签名 / 公证 / Azure Artifact Signing 三条链路的实际行为只能在 Week 2
    配好 Secrets 后验证。
12. **法务文档草稿已完成但含 24 处 `【待填】` 占位符**（跨两份文件去重后 **17 个不同项**：两份共用 7 + 隐私政策独有 3 + 用户协议独有 7）：
    `docs/legal/privacy-policy.zh-CN.md`（362 行）与 `terms-of-service.zh-CN.md`（302 行）。
    未过法务、未补齐占位符前不得对外发布；`release-check.sh` 会因此 FAIL（`--allow-draft-legal` 仅供内测）。

以下 12–18 项是**写隐私政策时顺带发现的代码 / 文案与文档不一致**，其中 12、13 是发布前必修：

12. **🔴 设置页「日志目录」显示的路径与实际写日志的路径不是同一个**（2026-11-10 复核确认）。
    `services/environment_service.rs:32` 用 `data_dir.join("logs")`，而 `lib.rs:71` 实际调
    `init_logging(&app.path().app_log_dir()?)`。macOS 上分别是
    `~/Library/Application Support/com.gaodekuai.geo/logs` 与 `~/Library/Logs/com.gaodekuai.geo`。
    **发布前必修**：否则隐私政策 §8.3「彻底删除」的指引对客户是不准确的（照界面路径删不干净）。
    修法：让桌面壳把 `app_log_dir()` 传给 `EnvironmentPaths`，而不是自己拼。需先写失败测试（规则 1）。
13. **🔴 设置页「数据外发」四个开关没有任何执行点**（2026-11-10 复核确认）。
    `PrivacyConfig { share_entity_card, share_prompts, share_crawled_text, share_diagnostics }`
    只出现在 `geo-store/src/settings.rs`（定义/读写）、`ui/src/api/types.ts`、
    `ui/src/test/fixtures.ts` 与 `GeneralSection.tsx`（渲染）里，**没有任何业务代码读取它们**；
    而词典文案写的是「控制哪些数据在**上报诊断**时允许离开本机」——**这条上报通道根本不存在**
    （全仓无遥测）。对外发布时这构成误导。
    **发布前二选一**：① 摘掉这组开关与文案；② 保留但把文案改成「预留设置，当前版本不生效」。
    走 i18n 词典、zh-CN 与 en-US 同步、demo 先定稿（规则 7 / 8）。
   **✅ 2026-11-13 产品裁定选 ①（摘除）**：开关组、`PrivacyConfig` DTO、demo seed、词典键
   （zh-CN / en-US）两侧全删；老库 JSON 仍带 `privacy` 段时 serde 忽略（前向兼容测试守护）；
   UI 测试改为断言不存在；隐私政策 §7.4 同步改写为「没有全局数据外发开关」。
14. **`repo` 通道文案过度承诺**：`i18n/locales/zh-CN/common.ts:133` 写「填仓库地址后可生成 diff
    与交接说明」，但 `api/site-compose.ts` 只实现 bundle / llms_txt / robots_txt / patches_json /
    edge_worker 五种产物，**没有 repo diff 生成器**。法务文档已按现状写（未把「可生成 diff」写进协议），
    但界面文案本身需修。
15. **`USER_AGENT` 里的联系 URL 不可解析**：`state.rs:24` 是
    `geo-desktop/0.1 (+https://gaodekuai.local/bot)`，`.local` 是保留后缀。注释说带联系方式是
    robots 礼仪，但一个解析不了的 URL 起不到该作用，反而可能被判为可疑爬虫。
    官网域名定下来后要同步改这里 + 隐私政策里两处逐字引用的 UA。
16. **`CollectionService::new` 的截图目录默认值指向 `std::env::temp_dir()`**，与 `state.rs:170`
    的 `<data_dir>/screenshots` 不一致。生产路径全走 `from_state`（已核实 6 处调用点），
    **当前不会真的写到临时目录**；但 `tauri.conf.json` 的 `assetProtocol` scope 里还留着
    `$TEMP/gdk-geo/**` 这条历史痕迹。建议清理死代码与 scope，以免将来误用。
17. **`services/article_service.rs:9` 的文件头注释已过期**：写「没有后台定时器」，
    但 `lib.rs:79-89` 确实起了 60 秒轮询的 `run_due`。法务文档按代码实际行为写。
18. **法务文档与 `LICENSE` 内容重叠**：用户协议 §2.6 约定「冲突时以用户协议为准，
    `LICENSE` 第 1–3 条继续有效」。需法务确认这个优先级安排；若要 `LICENSE` 只谈著作权许可，
    需另行改写。

