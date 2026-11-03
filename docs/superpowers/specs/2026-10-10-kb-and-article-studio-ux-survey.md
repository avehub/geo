# 知识库重构 & 文章管理（Article Studio）UX 市场调研

> **日期**：2026-10-10 · **性质**：纯调研文档，不含代码改动。
> **服务对象**：`2026-10-10-kb-redesign-and-article-studio-design.md`（知识库 M1.2b 重构 + 文章管理 M6）。
> **范围**：① 知识库产品 ② 销售赋能 / 客服知识 ③ 定时·模板化 AI 内容生成 ④ 可采纳交互模式排序。

## 0. 取证方法与边界（先读这段再看结论）

- **一手来源优先**：厂商帮助中心 / 官方产品页 / 官方 changelog / 官方博客；通用 UX 原则引 Nielsen Norman Group。
  本轮直读核对：Guru、Notion、Atlassian（Confluence）、Slite、Document360、Bloomfire、Highspot、Seismic、Klue、Arcade、
  Intercom、Help Scout、Jasper、Copy.ai、HubSpot、Sprout Social、NN/g。
- **取证受限处一律写 unverified，不编造**：
  - G2 / Capterra / TrustRadius / GetApp / SoftwareAdvice 正文全部 **403**（反爬）⇒ "用户抱怨"主题不引评测站，
    改用厂商自述的失败模式（Slite 行业文章，含其转引的 Reddit 用户原话）。
  - `help.showpad.com` / `help.highspot.com` 被 **Cloudflare 挑战页**拦截 ⇒ Showpad 全部 UI 细节、
    Highspot 的 play/item 编辑级 UI 标 unverified。
  - 语雀 / Writesonic / 飞书帮助中心正文 **JS 渲染**（curl 只拿到标题）⇒ 细节取自官方域名页面的搜索索引摘要并逐条注明。
  - 秘塔 / 笔灵：无可核实的官方 UI 文档 ⇒ 整节 unverified。

## 1. 知识库产品

### 1.1 Guru —— 核实（verification）工作流的标杆
- **信任态长在卡片上，不藏在详情页**：打开卡片，**左上角**即显示核实状态；徽标三态 **✅ Verified / ❔ Unverified / 无徽标**
  （[Guru Help](https://help.getguru.com/docs/verifying-and-unverifying-cards)）。
- **卡片头部四项信任元数据**：Verification / Expiration date（何时变成 unverified，或 "Does not expire"）、
  Last verified（**谁**在**何时**核实）、Verifier（个人或 Group）、Verification Interval（30 / 60 / 90 天、6 个月、1 年、Does not expire）
  （[同上](https://help.getguru.com/docs/verifying-and-unverifying-cards)）。
- **改核实属性是"就地两下"**：打开卡片 → 点左上角 Verified/Unverified → Verifier 或 Interval 下拉选择 → **自动保存**，无确认弹窗
  （[同上](https://help.getguru.com/docs/verifying-and-unverifying-cards)）。
- **信任态在所有消费面复现**：搜索结果、AI 生成的答案、AI Agent Center、浏览卡片时都带状态
  （[同上](https://help.getguru.com/docs/verifying-and-unverifying-cards)）。
- **外部来源默认"无状态"**：接入的 Google Drive / Confluence / SharePoint 文档默认没有核实态，
  开启 Knowledge Agent 的 auto-verify 后按**被使用的情况**自动获得状态（[同上](https://help.getguru.com/docs/verifying-and-unverifying-cards)）。
- **默认值是"不过期"**：2026 年 1 月后创建的 Collection 默认 Does not expire，官方明确建议"多数内容用 Does not expire，
  把持续质检交给 agent"，即**降低无谓的到期提醒噪音**（[同上](https://help.getguru.com/docs/verifying-and-unverifying-cards)）。
- **Card Manager = 批量治理台**：先 Filter by Attribute 过滤 → 复选框选择（**顶部复选框全选**）→ 工具栏批量
  Change Verifier / Change Interval / 改共享与隐私 → Save changes（[Guru Help](https://help.getguru.com/docs/performing-bulk-actions-in-the-card-manager)）。
- **"Top Performers"过滤**：给所有卡片打分排序，分值 = **收藏数 + 浏览数 + 复制数**——把"被复制"当成内容有用度的一等指标
  （[同上](https://help.getguru.com/docs/performing-bulk-actions-in-the-card-manager)）；已归档卡片必须先恢复才能导出（同上）。

### 1.2 Notion —— 一个数据库多视图 + peek（侧滑）编辑
- **同一份数据多视图切换**：Table / Board / Timeline / Calendar / List / Gallery / Chart / Form；新建数据库默认 Table，
  之后点数据库名或已有视图旁的 **+** 新建并切换视图（[Notion Help](https://www.notion.com/help/views-filters-and-sorts)）。
- **"Open pages in" 三档，且按布局给默认值**：**Side peek**（页面在右侧打开，**左侧数据库仍可交互**）/ **Center peek**（居中模态）/
  **Full page**；Table·Board·List·Timeline 默认 side peek，Gallery·Calendar 默认 center peek
  （[同上](https://www.notion.com/help/views-filters-and-sorts)）——这是"编辑不丢上下文"的标准答案。
- **Gallery 卡片预览可配**：Card preview 选 Page cover / Page content / Files & media 属性；**Fit image** 开关；
  hover 图片可 **Reposition** 拖动构图（[Notion Help](https://www.notion.com/help/galleries)）。
- **Board 按属性分组**：可按 status / assignee / priority 等任意属性分列，并叠加 filters、sorts 与自定义属性
  （[Notion Help](https://www.notion.com/help/boards)）——看板不只用于状态流转，也用于任意维度分组。
- **Filter 是视图级而非全局级**：视图只显示满足条件的条目，可简单可复杂（[Notion Help](https://www.notion.com/help/views-filters-and-sorts)）。

### 1.3 Confluence —— 层级页面树作为常驻导航
- **Space sidebar 三件套**：page tree（空间内页面的**层级列表**）+ 可自定义 space shortcuts + 空间博客链接；新建页面
  **默认出现在 sidebar**；用某些模板（如会议记录）会自动插入索引页
  （[Atlassian Documentation](https://confluence.atlassian.com/spaces/DOC/pages/777010845/The+space+sidebar)）。
- **树可被宏引用**：Confluence Cloud 提供 content tree 宏、page tree search 宏、TOC 宏与 content tree 内 Smart Links
  （[Atlassian Support](https://support.atlassian.com/confluence-cloud/docs/what-is-confluence-cloud/)）⇒ 树是**可复用组件**，不只是导航。
  单篇文档的 inline 编辑细节：**unverified**（对应 Cloud 帮助页本轮 404）。

### 1.4 Slite —— 核实生命周期 + AI 改动走"分诊（Triage）"
- **Doc Verification 五态生命周期**：**Verified / Verification expired / Outdated / Verification requested / No status**；
  owner 可设 review cadence，避免页面"永远被信任"（[Slite](https://slite.com/learn/why-knowledge-bases-fail)）。
- **AI 提议 ≠ AI 落地**：Slite Agent 检测漂移、起草修改，把提议送进 **Triage**；owner 看到 diff（与当前文档逐处对比），
  **accept 或 dismiss**，最终决定权在人（[同上](https://slite.com/learn/why-knowledge-bases-fail)）。
- **搜索把新鲜度当排序信号**：搜索与 AI 答案使用 **freshness / ownership / verification** 作为可信度信号，且是权限感知的
  （permission-aware）（[同上](https://slite.com/learn/why-knowledge-bases-fail)）。
- **知识库失败的四条机制（可直接当我们的设计约束）**：维护是"隐形工作"、所有权衰减成"orphan things"、
  一次错答案就崩塌信任（可用答案转移到 Slack / 私信 / 工单 / 人脑）、**搜索会让陈旧知识看起来可信**
  （[同上](https://slite.com/learn/why-knowledge-bases-fail)）。文中转引 Reddit 用户原话："随着越来越少人访问知识库，
  越来越少人注意到什么已经过期"（同上）。
- **对照表式叙事**：官方给出"传统 wiki vs 自维护知识库"逐项对照（季度评审没人做完 ↔ 主动所有权周期 + 自动新鲜度追踪）
  （[同上](https://slite.com/learn/why-knowledge-bases-fail)）。

### 1.5 Document360 —— 工作流状态 + 发布前"体检对话框"
- **状态推进有两个入口**：文章编辑器内（单篇、in-context）或 **Tasks 页**（多篇批量）；官方用一张 quick-reference 表把
  "改一篇状态 / 指派 reviewer + due date + 留言 / 看完整状态历史 / 批量改状态"分别对应到编辑器按钮、Workflow 对话框、
  Workflow status 里的 History 图标、Tasks 页多选（[Document360 Docs](https://docs.document360.com/docs/managing-workflow-status)）。
- **状态机配置与实例分离**：状态在 Workflow designer 里定义；文章级的指派改动只作用于该篇，不回写 designer（同上）。
- **Publish 是 Workflow 按钮下拉里的一项**，不是独立按钮（[Document360 Docs](https://docs.document360.com/docs/publishing-an-article)）。
- **发布确认对话框 = 多面板体检**：缺失内容时 Overview 面板出现 "Fix with Eddy AI" 卡片，点 **Auto Fix!** 一次补齐所有面板
  （tags / GEO-SEO description / related articles）；每补完一个面板就从列表消失、左侧面板图标变**绿勾**；全齐则确认"已补齐"，
  仍缺则显示 warning（[同上](https://docs.document360.com/docs/publishing-an-article)）。
- **排期发布就地展开**：Schedule publish 选 Immediately 或 Later；选 Later 就地出现 **Timezone / Date / Time** 三个字段，
  按钮文案从 **Publish 变成 Schedule**（[同上](https://docs.document360.com/docs/publishing-an-article)）。
- **发布后状态标签**：Published article status 可选 None / New / Updated / 自定义标签，选非 None 会出现 "Show status for" 天数
  （[同上](https://docs.document360.com/docs/publishing-an-article)）。
- **批量发布要先过滤**：在 All articles 页用 **Status 过滤**隔离 Draft / New 再批量发布，否则会混入已发布文章导致 Publish 按钮消失
  （[同上](https://docs.document360.com/docs/publishing-an-article)）——一条很实在的"批量操作前置过滤"教训。

### 1.6 Bloomfire —— AI 答案必须回链"已批准内容"
- Synapse 的对话式问答**每个回答都 grounded in approved content 且链接到来源**
  （[Bloomfire Platform](https://www.bloomfire.com/platform/)）⇒ 我们的 AI 生成/引用必须带出处链接，不能只给结论。

### 1.7 飞书知识库 / 语雀（中文语境）
- **飞书：层级式页面树 + 明确内容分类**；支持**快速迁移 Confluence**、**批量导入 Word / Excel / CSV / XMind** 本地文件；
  管理员可为文档统一设置阅读、编辑、复制、打印等权限（[飞书知识库产品页](http://feishu.cn/product/wiki)，
  正文 JS 渲染，细节取自该官方页的索引摘要）。
- **飞书：知识库三角色**——管理员 / 可编辑的成员 / 可阅读的成员；创建人默认管理员；权限分**知识库维度**与**单页面维度**两层
  （[飞书帮助中心](https://www.feishu.cn/hc/zh-CN/articles/758901371147-%E7%9F%A5%E8%AF%86%E5%BA%93%E4%B8%8D%E5%90%8C%E8%A7%92%E8%89%B2%E6%9D%83%E9%99%90%E8%AF%B4%E6%98%8E)，同上标注）。
- **飞书：权限即视图**——"每个人仅能看到自己拥有权限的内容"，所以不同人看到的知识库不同；可设置**仅管理员能新建一级页面**
  （[飞书帮助中心](https://www.feishu.cn/hc/zh-CN/articles/582922484818-%E7%9F%A5%E8%AF%86%E5%BA%93%E6%88%90%E5%91%98%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97)，同上标注）。
- **语雀**：知识库 → 目录 → 文档三级结构为业界共识（[语雀官网](https://www.yuque.com/)）；
  "管理文档"页可多选后批量**转移 / 删除（二次确认、不可逆）/ 复制（标题加"副本"后缀）**、目录树拖拽排序、
  文档"历史记录"可回看并恢复版本 —— 以上三项**unverified**（官方帮助中心 JS 渲染，本轮只有二手教程来源，不作为设计依据）。

### 1.8 用户口碑主题（取证受限，谨慎使用）
- 评测站正文全部 403，**本轮不引 G2 / Capterra 的具体评价**；能确证的痛点来自厂商自述：Slite 的"维护隐形、所有权衰减、
  一次错答案崩塌信任、搜索让陈旧内容显得可信"（[Slite](https://slite.com/learn/why-knowledge-bases-fail)）；Guru 承认到期提醒
  可能造成噪音因而把默认值改为不过期（[Guru Help](https://help.getguru.com/docs/verifying-and-unverifying-cards)）；Help Scout 直接写明
  saved replies **没有手动重排能力**、只能靠命名与数字前缀控制顺序（[Help Scout Docs](https://docs.helpscout.com/article/18-create-saved-replies-for-fast-answers)）。
- 结论：可信的抱怨都指向同一处——**治理动作（核实 / 排序 / 归属）的摩擦**，而不是"功能不够多"。

## 2. 销售赋能 / 客服知识

### 2.1 Highspot —— playbook 按"deal stage"组织，给下一步动作
- 官方对好 playbook 的定义："**在每个 deal stage 明确告诉销售该做什么、说什么、分享什么**"，提供 in-the-moment 指导以替代猜测；
  并强调围绕 buyer stage / winning actions / shared metrics 对齐，用 AI 引导 **next-best actions**、按 buyer signals 调整、
  把 top performer 的做法快速复制（[Highspot blog](https://www.highspot.com/blog/sales-playbooks/)）。
- 产品能力被切成场景化条目：AI Role Play / Sales Content Management / **Sales Plays and Playbooks** / Buyer Engagement /
  Sales Training / Sales Coaching / AutoDocs / Digital Sales Rooms（[Highspot 产品页](https://www.highspot.com/product/sales-playbook-software/)）；
  该页同时注明 **Highspot is part of Seismic**（同上）。
- play / item 的编辑级 UI（如何改一个 talk track、如何管版本）：**unverified**（help.highspot.com 被 Cloudflare 拦截）。

### 2.2 Seismic —— 库 = 逻辑层级 + 自定义属性 + 三级权限
- **自定义内容属性（tags / metadata）用于精确过滤与检索**，官方建议统一命名规范，因为它既影响内部搜索也影响对外分享时的品牌观感
  （[Seismic blog](https://www.seismic.com/blog/how-to-organize-and-manage-content-in-seismic/)）。
- **权限三级：View / Edit / Manage**（使用者 / 内容 owner / 管理员），官方建议按用户组授权而不是逐人授权（同上）。
- **库的目标是"内容 owner 只看到与自己职责相关的资料"**，用层级 + 属性 + 权限共同降噪（同上）。
- 库不只是存放位置，还要有 **workflow management and governance**（同上）。

### 2.3 Showpad
- **unverified**：help.showpad.com 全站 403（Cloudflare 挑战页），Asset Library / Channels / Tags 的任何 UI 细节本轮无法核实；
  仅能确认对外产品叙事为 "Powerful Content Management"（[Showpad 官网](https://www.showpad.com/)）。**不作为设计依据。**

### 2.4 Klue —— battlecard 的四类分工与三条写作铁律
- **四类 battlecard，各有固定卡型**：BDR（Quick Dismiss）、Objection（Trap Setting Questions、Objection Handling）、
  Product（Feature Comparison、Pricing）、Executive（Company Overview、Approach to Market）
  （[Klue blog](https://klue.com/blog/competitive-battlecards-101/)）⇒ 竞品对照不是"一张大表"，而是**按使用者与阶段切成多张卡**。
- **三条内容铁律**：Context（不要孤立罗列竞品事实，必须给出"so what?"，把竞品优势接到我方优势上）、
  Charge（**避免中性语言**，给内容正/负电荷）、Specificity（用具体数字对比，而不是"性能更好"）
  （[同上](https://klue.com/blog/competitive-battlecards-101/)）。
- **使用场景**：新销售把 battlecard 当**通话中的实时参考**，随手拉出竞品信息或异议处理（[同上](https://klue.com/blog/competitive-battlecards-101/)）。

### 2.5 Arcade —— battlecard 的格式硬约束与采用率数据
- **三层结构**：**Know（情报）/ Say（话术）/ Show（证据）**，其中 Show 层链接到可交互演示来"视觉化证明"对比结论
  （[Arcade blog](https://www.arcade.software/post/competitive-battlecard-template)）。
- **采用率是真问题**：71% 的团队在用 battlecard，但**只有 26% 的销售在通话中真的打开**；官方结论是"**先解决采用，再解决内容**"
  （[同上](https://www.arcade.software/post/competitive-battlecard-template)）。
- **格式硬约束**：**最多一屏、10 秒内可扫读、嵌进 CRM 与销售触达工具**（[同上](https://www.arcade.software/post/competitive-battlecard-template)）。

### 2.6 Intercom Macros —— 标题即检索键，动作可绑定
- **macro 的存在理由**：把重复动作（分诊后指派、打标签、回复并 snooze）压成**一次点击**
  （[Intercom Help](https://www.intercom.com/help/en/articles/6433193-creating-and-managing-macros)）。
- **两处创建**：Inbox 内用 **⌘/Ctrl+K** 或 composer 的 action 图标搜 "Create new macro"；或在 workspace Settings 里管理（同上）。
- **标题是第一检索手段**：官方原话"这是团队搜索、分享、使用 macro 的**第一位方式**"，所以要求清晰简洁；标题对客户不可见；
  目前**不支持**给 macro 加 subject line（[同上](https://www.intercom.com/help/en/articles/6433193-creating-and-managing-macros)）。
- **内容可选、动作可加**：内容可含文章 / emoji / GIF / 图片 / 附件；**macro 可以只应用动作而不产生回复**；
  **+ Add actions** 可指派给 team inbox 或同事、打标签、snooze、close、re-open 等（[同上](https://www.intercom.com/help/en/articles/6433193-creating-and-managing-macros)）。

### 2.7 Help Scout Saved Replies —— 从会话里"顺手存"，插入前可预览
- **就地沉淀**：在会话编辑器里选中文字 → 打 **"/"** 或点 Insert → **Saved Reply > Save this reply** → 命名 → Save Reply
  （[Help Scout Docs](https://docs.helpscout.com/article/18-create-saved-replies-for-fast-answers)）；
  也可在 Settings > Inboxes > 选 inbox > Saved Replies > New Saved Reply 建（同上）。
- **AI Assist 用于清洗沉淀物**（Plus/Pro）：修拼写语法、改语气或长度、翻译成其他语言（同上）。
- **插入前预览**：在 saved reply 菜单里 **Mac 按住 Option / Windows 按住 Alt 点击**，或高亮时按**右方向键**即可预览正文
  （[Help Scout Docs](https://docs.helpscout.com/article/69-respond-to-conversations)）；可搜索或滚动选择（同上）。
- **发送前可改状态**：reply 编辑器底部可覆盖 Status / Assignment，可 snooze，也可 **Schedule a Reply to Send Later**（同上）。
- **明确的排序缺陷（反面教材）**：saved replies **只按字母数字排序**，官方明说"没有手动重排的选项"，
  建议用数字前缀控制顺序、用命名约定把同类聚在一起、用搜索框过滤该组（[同上](https://docs.helpscout.com/article/18-create-saved-replies-for-fast-answers)）。
- 可从 inbox 右下角的 **Copy** 按钮把 saved reply 复制到另一个 inbox（同上）。

### 2.8 对本项目的直接启发
- 话术类条目要**按场景 / 阶段分组**（Highspot deal stage、Klue 四类卡），而不是按"内容形式"平铺。
- 竞品对照要**表格化 + 一屏可扫读**（Klue Feature Comparison、Arcade ≤1 屏 / <10 秒），每条对照都要给"so what?"。
- 话术的第一交互是**取用**（复制 / 预览 / 快速插入）而非编辑（Intercom 标题即检索键、Help Scout Option+点击预览）。
- 素材库靠**自定义属性 + 三级权限 + 命名规范**降噪（Seismic），不是靠更深的文件夹。

## 3. 定时 / 模板化 AI 内容生成

### 3.1 Jasper Campaigns —— 一份 brief 生成多渠道资产
- Campaigns 的定位是"把 **brief、insights、渠道要求**转成 on-brand 的 campaign 内容"
  （[Jasper blog](https://www.jasper.ai/blog/introducing-campaigns)）。
- **一份 brief 复用给多渠道**：Wistia 上传一份含 webinar 信息、语气、目标受众的 brief 生成全部资产，
  **每个成员用同一份 brief 生成自己渠道的资产**（[同上](https://www.jasper.ai/blog/introducing-campaigns)）。
- **Instant Magic 追加内容类型**：不重跑整个 campaign，点想要的内容类型即可增量追加资产（[同上](https://www.jasper.ai/blog/introducing-campaigns)）。
- 价值主张是"围绕统一语气**异步协作**"，替代多人各自写 brief、各自维护 brand voice（[同上](https://www.jasper.ai/blog/introducing-campaigns)）。
- 生成草稿的状态标签 / 评审队列细节：**unverified**（本轮未在直读页面中确认）。
- 附带情报：Jasper 已把 "GEO & AI Optimization / 衡量品牌在各 AI 答案引擎中的表现" 作为一级产品能力
  （[同上](https://www.jasper.ai/blog/introducing-campaigns)）——与本产品同一赛道，值得持续盯。

### 3.2 Copy.ai Workflows —— 槽位用 "#" 引用，每步可独立配参
- **Workflow = 一串 Actions**；点任一 action 可自定义三处：**Prompt / Background / Advanced settings**
  （[Copy.ai blog](https://www.copy.ai/blog/workflows-101)）。
- **槽位引用机制**：Prompt 里可用高亮文本引入前序步骤的上下文；**输入 "#" 即可引用 workflow inputs、其他 actions 或 infobase 条目**
  （官方示例：想在提纲里带出相关关键词就写 `#related keywords`）（[同上](https://www.copy.ai/blog/workflows-101)）。
- **Background = 角色设定**：告诉 AI 在这个任务里是什么专家（角色 + 技能），并可给示例与期望的输出结构
  （例：博客要按"提出概念 → 说明重要性 → 痛点 → AI 如何解决"的叙事）（[同上](https://www.copy.ai/blog/workflows-101)）。
- **Advanced settings 三项**：选语言模型、设 temperature（创造力）、设 max/min 字数（[同上](https://www.copy.ai/blog/workflows-101)）。
- **自然语言搭流程**：直接输入 "draft an email" 这类描述即可增删 action（[同上](https://www.copy.ai/blog/workflows-101)）；
  Infobase 作为具名上下文，用于让输出更贴合（同上）。
- 平台组件被拆成 Tables / Actions / Infobase / Brand Voice（[Copy.ai](https://www.copy.ai/platform/what-are-workflows)，
  正文 JS 渲染，仅索引到导航层级）。

### 3.3 HubSpot AI 博客生成 —— "先定想法、再审提纲、后出稿"
- **三段式流程**：Content > Blog > **Start with AI** → **Describe the blog post**（选 topic、填关键词）→ **Review outline** → 生成草稿
  （[HubSpot Knowledge Base](https://knowledge.hubspot.com/blog/generate-blog-posts-using-ai-assistants)）。
- **Define 阶段的可绑定对象**：推荐 topic（可 Show more）、SEO 关键词、Country、目标 Blog、Industry，
  并可 Browse 上传文件或引用 HubSpot 托管内容（[同上](https://knowledge.hubspot.com/blog/generate-blog-posts-using-ai-assistants)）。
- **Outline 阶段是"结构化可编辑草稿"**：Blog post description 既参与生成又会成为 **meta description**；默认生成配图，
  可用复选框关掉；**Paragraph headers** 支持 hover 点 Regenerate 重生、Add（**最多 10 个**）、拖拽排序、X 删除，
  还能 "+ Add talking point"（[同上](https://knowledge.hubspot.com/blog/generate-blog-posts-using-ai-assistants)）。
- **brand voice 前置生效**：若已配置 brand voice，稿件按其生成（[同上](https://knowledge.hubspot.com/blog/generate-blog-posts-using-ai-assistants)）。
- **权限与合规面**：需要 Marketing **Edit + Publish** 权限，且要开启 "Give users access to generative AI tools"；
  可在 AI settings 管理 AI 功能访问与数据共享；官方把细节指向 **AI Trust FAQs 与 AI Model Cards**
  （[同上](https://knowledge.hubspot.com/blog/generate-blog-posts-using-ai-assistants)）。

### 3.4 Sprout Social —— 内容处置四态（最值得直接搬到评审队列）
- 编辑并批准后可 **Schedule** 进日历；此外还有三种处置：**Draft**（未定稿或备选内容先"停放"）、
  **Queue**（内容已可上线但不确定何时发 ⇒ 系统在**你指定的时间窗口内挑最佳发布时间**）、
  **Submit for Approval**（**指定具体审批人**，上线前评审）
  （[Sprout Social Insights](https://sproutsocial.com/insights/how-to-schedule-instagram-posts/)）。
- 这四态把"生成完 → 人来看 → 决定何时发"拆成了可操作的状态机，而不是一个 pending 标志位（同上）。

### 3.5 排期表单的参照：Document360 的就地展开
- Schedule publish 选 **Immediately / Later**；选 Later **就地**出现 Timezone / Date / Time，按钮文案由 Publish 变 Schedule
  （[Document360 Docs](https://docs.document360.com/docs/publishing-an-article)）⇒ 排期参数应**由选择结果触发显示**，而非一开始摊开全部字段
  （与 NN/g "尽量少字段、可选字段明确标注"一致，见 §4C）。

### 3.6 Writesonic / 秘塔 / 笔灵
- **Writesonic**：官方 Docs 站 JS 渲染（curl 取不到正文），"Article Writer 6 十步流程"与"CSV 批量生成（含 brand voice）"
  两项 **unverified**，仅留入口备查：[Article Writer 6](https://docs.writesonic.com/docs/aritcle-writer6-10-step-article)、
  [批量生成](https://docs.writesonic.com/docs/generate-articles-in-bulk-with-ai-article-writer-6)。
- **秘塔 / 笔灵**：无可核实的官方 UI 文档 ⇒ 整节 **unverified**，不作为设计依据。

### 3.7 合规与免责声明模式
- **发布前 AI 补齐 + 体检**：Document360 的发布确认对话框把缺失项集中成 "Fix with Eddy AI"，并**一键 Auto Fix**，
  面板图标逐项变绿勾（[Document360 Docs](https://docs.document360.com/docs/publishing-an-article)）。
- **AI 治理面单独成页**：HubSpot 把 AI 安全控制、数据使用、合规集中在 **AI Trust FAQs / AI Model Cards**，并提供 AI settings 开关
  （[HubSpot Knowledge Base](https://knowledge.hubspot.com/blog/generate-blog-posts-using-ai-assistants)）。
- **答案必须回链已批准内容**：Bloomfire Synapse 每个回答都 grounded in approved content 且链接到来源（[Bloomfire](https://www.bloomfire.com/platform/)）。
- **人在环里是默认值**：Slite 的 Triage（AI 起草 → owner 看 diff → accept/dismiss，[Slite](https://slite.com/learn/why-knowledge-bases-fail)）；
  Sprout 的 Submit for Approval（[Sprout Social](https://sproutsocial.com/insights/how-to-schedule-instagram-posts/)）。
- 延伸阅读（**本轮网络不可达，未直读**）：Google Search Central 的 AI 生成内容与披露声明指引
  <https://developers.google.com/search/blog/2023/02/google-search-and-ai-content>。
- 与仓库硬规则的关系：AGENTS 规则 6（禁绝对化用语、生成内容默认 `PendingReview`）与"人在环里 + 明示 AI 出处"是同一件事。

## 4. 综合建议：可采纳交互模式排序

排序依据：**对本产品当前问题的杀伤力**（知识库"展现单一、不易操作"；文章管理尚无 UI）× **实现代价** × **来源可信度**。
每条给出出处与"为什么评价好"。归属列：KB = 知识库页，AS = 文章管理，两者 = 共用。

| # | 模式 | 出处 | 为什么评价好 | 归属 |
|---|---|---|---|---|
| P1 | **视图切换：分组卡片 ⇄ 密集表格**（同一份数据两种布局，顶部 + / tab 切换，过滤条视图级生效） | [Notion](https://www.notion.com/help/views-filters-and-sorts) | 用户按任务切布局（浏览用画廊、盘点用表格），而不是被迫接受一种展现 | KB |
| P2 | **编辑改侧滑（side peek）**：条目在右侧抽屉打开，**左侧列表仍可交互** | [Notion](https://www.notion.com/help/views-filters-and-sorts) + [NN/g 模态 vs 非模态](https://www.nngroup.com/articles/modal-nonmodal-dialog/) | 不打断上下文；NN/g 指出模态会强行中断用户，只应用于必须聚焦的重要信息 | 两者 |
| P3 | **卡片上直接显示信任态四要素**：状态徽标 + 到期/核实时间 + 上次核实人与时间 + 核实人 | [Guru](https://help.getguru.com/docs/verifying-and-unverifying-cards) | 读者在"要不要用这条"之前就知道能不能信，不必点进去 | KB |
| P4 | **核实属性就地改、自动保存**：点徽标 → 下拉选核实人 / 间隔 → 立即生效，无确认弹窗 | [Guru](https://help.getguru.com/docs/verifying-and-unverifying-cards) | 把治理动作的摩擦降到两下点击，是"核实真的会被做"的前提 | KB |
| P5 | **批量核实台**：先按属性过滤 → 复选框多选（顶部框全选）→ 工具栏批量核实 / 改核实人 / 改间隔 → Save changes | [Guru Card Manager](https://help.getguru.com/docs/performing-bulk-actions-in-the-card-manager) | 治理是批量活；一条一条点是知识库荒废的主因 | KB |
| P6 | **"Top Performers"排序 = 收藏 + 浏览 + 复制**（把复制当有用度信号） | [Guru](https://help.getguru.com/docs/performing-bulk-actions-in-the-card-manager) | 让"真的被拿去用"的内容浮上来，比人工排序客观 | KB |
| P7 | **话术条目按场景分组**（销售阶段 / 客服环节作为一级分组维度） | [Highspot](https://www.highspot.com/blog/sales-playbooks/) | 官方定义好 playbook 就是"在每个 deal stage 说明该做什么、说什么、分享什么" | KB |
| P8 | **竞品对照 = 一屏对照表 + 每条给 so what?**（Know / Say / Show 三层；≤1 屏、10 秒可扫读） | [Klue](https://klue.com/blog/competitive-battlecards-101/) + [Arcade](https://www.arcade.software/post/competitive-battlecard-template) | 26% 的通话中打开率意味着**格式**决定采用：不是一屏就不用 | KB |
| P9 | **话术卡引文体渲染 + 一键复制**，标题即检索键 | [Intercom](https://www.intercom.com/help/en/articles/6433193-creating-and-managing-macros) + [Help Scout](https://docs.helpscout.com/article/69-respond-to-conversations) | 取用是主交互；Intercom 明确说标题是搜索/分享/使用的第一手段 | KB |
| P10 | **插入前预览**（Option/Alt + 点击，或高亮后按右方向键看全文再决定插入） | [Help Scout](https://docs.helpscout.com/article/69-respond-to-conversations) | 避免"复制错一条"这种低成本高频率的失误 | KB |
| P11 | **素材库画廊格 + 卡片预览可配 + Fit image**（预览源可选封面 / 正文首块 / 文件属性） | [Notion Galleries](https://www.notion.com/help/galleries) | 媒体资产必须看到缩略图才有浏览价值；预览源可配适应不同条目 | KB |
| P12 | **一次性显式导入 + 来源标签**（而非活镜像卡片），导入后写明"源头再改不跟随" | [飞书批量导入](http://feishu.cn/product/wiki) + [Guru 外部来源默认无核实态](https://help.getguru.com/docs/verifying-and-unverifying-cards) | 消除"第二活现面"的重复卡片；Guru 对外部内容也是先无状态、按使用情况再赋状态 | KB |
| P13 | **发布/定稿前多面板体检 + 一键 AI 补齐**（缺失项集中列出，Auto Fix 后逐项变绿勾） | [Document360](https://docs.document360.com/docs/publishing-an-article) | 把"发布前该补什么"从人脑清单变成界面清单，且给出一步补救 | AS |
| P14 | **模板槽位用 "#" 引用上下文**（引用输入、前序步骤、具名知识库），每步单独配 Background（角色）+ 模型 / 温度 / 字数 | [Copy.ai](https://www.copy.ai/blog/workflows-101) | 槽位是模板可复用的核心；把角色与参数放到步骤级，用户不必写长 prompt | AS |
| P15 | **"先定想法 → 再审结构化提纲 → 后出稿"三段式**，提纲里的小节可重生 / 增（上限）/ 拖拽排序 / 删 / 加 talking point | [HubSpot](https://knowledge.hubspot.com/blog/generate-blog-posts-using-ai-assistants) | 在便宜的阶段（提纲）纠错，比在成稿上返工省得多 | AS |
| P16 | **排期表单就地展开**：选"稍后"才出现时区 / 日期 / 时间，按钮文案随之从"发布"变"排期" | [Document360](https://docs.document360.com/docs/publishing-an-article) + [NN/g 表单设计](https://www.nngroup.com/articles/web-form-design/) | NN/g 主张尽可能减少字段、把可选字段明确标注；按需展开正是渐进式披露 | AS |
| P17 | **生成物处置四态：Draft / Queue / Submit for Approval / Scheduled**（Queue = 在指定窗口内择时） | [Sprout Social](https://sproutsocial.com/insights/how-to-schedule-instagram-posts/) | 把 PendingReview 一个标志位拆成可操作的状态机，人审与择时解耦 | AS |
| P18 | **AI 提议走 Triage：起草 → owner 看 diff → accept / dismiss** | [Slite](https://slite.com/learn/why-knowledge-bases-fail) | 保留人的最终决定权，同时把 AI 用在"找漂移 + 起草"这些烦人环节 | 两者 |
| P19 | **AI 治理与免责单独成面**（AI settings 开关 + Trust FAQ / Model Card 入口 + 回答回链已批准内容） | [HubSpot](https://knowledge.hubspot.com/blog/generate-blog-posts-using-ai-assistants) + [Bloomfire](https://www.bloomfire.com/platform/) | 合规话术集中一处，比散落在每个按钮旁更可信也更易维护 | 两者 |
| P20 | **批量操作前先按状态过滤**（隔离 Draft / New 再批量发布） | [Document360](https://docs.document360.com/docs/publishing-an-article) | 官方明确记录：混入已发布项会让批量按钮直接消失，是真实踩坑结论 | 两者 |

### 4A 落地映射：知识库页（P1–P12）
- **头部**：视图切换（P1）+ 过滤条 + "从实体卡/项目导入"按钮（P12，一次性导入并打来源标签）。
- **列表**：分组视图按模块 → 话术模块内再按场景出子标题（P7）；表格视图列 = 模块 / 形式 / 标题 / 场景 / 状态 / 来源 /
  核实时间 / 更新时间 / 操作，行多选接批量核实（P5）。
- **条目卡**：按形式渲染——话术引文体 + 复制（P9）、长文折叠、链接 chip、素材画廊格（P11）；卡片右上常驻信任态四要素（P3），
  点徽标就地改（P4）；hover 出预览（P10）。
- **竞品模块**：表格视图即一屏对照表，每行含"对方说法 / 我方回应 / 证据"三段（P8 的 Know/Say/Show）。
- **排序**：默认更新时间倒序，另给"最常被复制"排序（P6）。
- **编辑器**：560px 右侧抽屉，左侧列表不锁（P2）。

### 4B 落地映射：文章管理 Article Studio（P13–P20）
- **方向卡**：手动新建 + AI 生成一批；卡片上显示"已绑定模板数 / 排期数 / 累计产出"。
- **模板编辑器（抽屉）**：正文区内输入 `#` 唤起槽位选择器（项目 / 产品 / 关键词 / 前序输出）（P14）；
  侧栏 Background（角色）+ 模型 / 温度 / 字数；右侧**实时预览**用示例值填充槽位。
- **排期表单**：频率 + "立即 / 稍后"，选稍后就地展开日期 / 时间 / 时区，按钮文案变"保存排期"（P16）；
  绑定对象（项目 / 产品 / 关键词）用多选 chips；演示模式明示"到点不自动跑"。
- **立即运行（run now）**：给出进度反馈（超过 10 秒的操作必须有进度指示，见
  [NN/g 响应时间三限](https://www.nngroup.com/articles/response-times-3-important-limits/)），产物直接落进评审队列。
- **评审队列**：四态 Draft / Queue / Submit for Approval / Scheduled（P17）；
  评审详情用"提纲 → 正文"两段式，提纲小节可重生 / 增删 / 拖拽（P15）；
  定稿前弹多面板体检 + 一键 AI 补齐（P13），面板含合规扫描（绝对化用语）与 AI 声明。
- **合规面**：AI 设置与免责文案集中一处（P19）；批量发布前默认按状态过滤（P20）。
- **AI 修订**：对已发布文章提出修改建议时走 Triage（P18），diff + accept / dismiss。

### 4C 明确不采纳（含理由）
- **分类树 / 三级目录**（Confluence page tree、飞书层级树、语雀目录）：11 个固定模块 + 视图切换已覆盖导航需求；
  再引入树等于第三套导航，中小客户维护成本高（[Confluence](https://confluence.atlassian.com/spaces/DOC/pages/777010845/The+space+sidebar)）。
- **搜索 facets**（Bloomfire 式多维分面）：在数十条量级属于过度设计，保留"关键词 + 模块 + 状态 + 形式"四过滤即可
  （参见 [NN/g filters vs facets](https://www.nngroup.com/articles/filters-vs-facets/)）。
- **saved reply 的"仅字母序、不能手动排序"**：Help Scout 官方承认的限制，我们用场景分组 + 拖拽规避（[Help Scout](https://docs.helpscout.com/article/18-create-saved-replies-for-fast-answers)）。
- **到期提醒驱动的核实**：Guru 已把默认值改为 "Does not expire" 并建议交给 agent 质检；我们默认不做周期性到期打扰，
  只提供"按需核实 + 批量核实"（[Guru](https://help.getguru.com/docs/verifying-and-unverifying-cards)）。
- **渐进式披露总原则**：高级设置 / 排期细节 / 合规面板默认折叠，按需展开（[NN/g](https://www.nngroup.com/articles/progressive-disclosure/)）。

## 参考链接

**知识库产品**
- Guru · How Content is Verified in Guru：<https://help.getguru.com/docs/verifying-and-unverifying-cards>
- Guru · Performing bulk actions in the Card Manager：<https://help.getguru.com/docs/performing-bulk-actions-in-the-card-manager>
- Notion · Database views, filters, sorts & groups（含 side peek / center peek / full page）：<https://www.notion.com/help/views-filters-and-sorts>
- Notion · Galleries：<https://www.notion.com/help/galleries> ｜ Notion · Boards：<https://www.notion.com/help/boards>
- Confluence · The space sidebar（page tree / space shortcuts）：<https://confluence.atlassian.com/spaces/DOC/pages/777010845/The+space+sidebar>
- Confluence Cloud · What is Confluence Cloud（content tree / page tree search / TOC 宏）：<https://support.atlassian.com/confluence-cloud/docs/what-is-confluence-cloud/>
- Slite · Why knowledge bases fail（Doc Verification 五态 / Triage / 失败机制）：<https://slite.com/learn/why-knowledge-bases-fail>
- Document360 · Managing workflow status：<https://docs.document360.com/docs/managing-workflow-status>
- Document360 · Publishing an article（发布确认对话框 / Auto Fix / Schedule publish）：<https://docs.document360.com/docs/publishing-an-article>
- Bloomfire · Platform（Synapse 回答回链已批准内容）：<https://www.bloomfire.com/platform/>
- 飞书知识库产品页（层级页面树 / 批量导入 / Confluence 迁移 / 权限管控）：<http://feishu.cn/product/wiki>
- 飞书帮助中心 · 知识库不同角色权限说明：<https://www.feishu.cn/hc/zh-CN/articles/758901371147-%E7%9F%A5%E8%AF%86%E5%BA%93%E4%B8%8D%E5%90%8C%E8%A7%92%E8%89%B2%E6%9D%83%E9%99%90%E8%AF%B4%E6%98%8E>
- 飞书帮助中心 · 知识库成员使用指南：<https://www.feishu.cn/hc/zh-CN/articles/582922484818-%E7%9F%A5%E8%AF%86%E5%BA%93%E6%88%90%E5%91%98%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97>
- 语雀官网（知识库 / 目录 / 文档）：<https://www.yuque.com/>

**销售赋能 / 客服知识**
- Highspot · Sales playbook software：<https://www.highspot.com/product/sales-playbook-software/>
- Highspot · Sales playbooks（按 deal stage 组织）：<https://www.highspot.com/blog/sales-playbooks/>
- Seismic · How to organize and manage content（自定义属性 / View-Edit-Manage）：<https://www.seismic.com/blog/how-to-organize-and-manage-content-in-seismic/>
- Showpad 官网（UI 细节 unverified）：<https://www.showpad.com/>
- Klue · Competitive battlecards 101：<https://klue.com/blog/competitive-battlecards-101/>
- Arcade · Competitive battlecard template（Know/Say/Show、71% vs 26%）：<https://www.arcade.software/post/competitive-battlecard-template>
- Intercom · Creating and managing macros：<https://www.intercom.com/help/en/articles/6433193-creating-and-managing-macros>
- Help Scout · Create saved replies for fast answers：<https://docs.helpscout.com/article/18-create-saved-replies-for-fast-answers>
- Help Scout · Respond to conversations（预览 / 稍后发送）：<https://docs.helpscout.com/article/69-respond-to-conversations>

**AI 内容生成 / 排期**
- Jasper · Introducing Campaigns：<https://www.jasper.ai/blog/introducing-campaigns>
- Copy.ai · Workflows 101（"#" 槽位引用 / Background / Advanced settings）：<https://www.copy.ai/blog/workflows-101>
- Copy.ai · What are Workflows（平台组件）：<https://www.copy.ai/platform/what-are-workflows>
- HubSpot · Generate blog posts using AI assistants：<https://knowledge.hubspot.com/blog/generate-blog-posts-using-ai-assistants>
- Sprout Social · How to schedule Instagram posts（Draft / Queue / Submit for Approval）：<https://sproutsocial.com/insights/how-to-schedule-instagram-posts/>
- Writesonic（均 unverified）· Article Writer 6：<https://docs.writesonic.com/docs/aritcle-writer6-10-step-article> ｜ 批量生成：<https://docs.writesonic.com/docs/generate-articles-in-bulk-with-ai-article-writer-6>
- Google Search Central · AI 生成内容指引（本轮不可达，未直读）：<https://developers.google.com/search/blog/2023/02/google-search-and-ai-content>

**UX 通用原则（NN/g）**
- Progressive disclosure：<https://www.nngroup.com/articles/progressive-disclosure/>
- Modal & nonmodal dialogs：<https://www.nngroup.com/articles/modal-nonmodal-dialog/>
- Filters vs facets：<https://www.nngroup.com/articles/filters-vs-facets/>
- Web form design：<https://www.nngroup.com/articles/web-form-design/>
- Response times: the 3 important limits：<https://www.nngroup.com/articles/response-times-3-important-limits/>
