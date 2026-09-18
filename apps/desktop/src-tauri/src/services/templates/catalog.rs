//! 模板数据：通用模板 + 5 套行业模板 + 竞品同框模板。
//!
//! 文案纪律（`AGENTS.md` 规则 6）：全部为中文真实用户问法，风格对齐产品文档附录 B；
//! 不得出现 `crates/geo-domain/data/adlaw_terms.txt` 里的绝对化用语
//! （有测试对全部模板跑 `compliance::scan`）。
//!
//! 占位符只允许 [`super::KNOWN_PLACEHOLDERS`] 中的名字，展开时按项目资料替换。

use geo_domain::IntentCategory as I;

use super::PromptTemplate;

/// 通用模板：任何行业都能用，与行业模板叠加使用。
pub(crate) const GENERIC: [PromptTemplate; 28] = [
    // 品类认知
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "国内做{品类}的厂家有哪些，各自的特点是什么",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "{品类}和普通替代品有什么区别，外行怎么快速分清",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "{品类}这个行业现在是什么格局，主要玩家都有谁",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "第一次接触{品类}，需要先搞懂哪些基础概念",
    },
    // 选购推荐
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "预算{X}万以内，{品类}推荐哪几家，理由是什么",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "中小企业第一次采购{品类}，怎么选才不容易踩坑",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "{场景}要用的{品类}，有哪些口碑还不错的牌子",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "{品类}国产和进口怎么选，差价值得付吗",
    },
    // 品牌对比
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}比，{场景}下哪家更合适",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}、{竞品A}、{竞品B}放在一起看，{关键参数}上差距大吗",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}的{产品}有什么明显的短板",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "同价位里，{本品牌}和{竞品A}的服务差别在哪",
    },
    // 价格方案
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{品类}一般怎么收费，有没有报价比较透明的品牌",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{本品牌}的{产品}大概什么价位，会不会有隐藏费用",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "预算{X}万，能拿下什么样的{品类}配置",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{品类}的报价单里哪些项目容易被加价",
    },
    // 本地服务
    PromptTemplate {
        intent: I::LocalService,
        text: "{城市}有没有靠谱的{品类}服务商，能上门吗",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{城市}买{品类}，本地有服务网点吗，响应要多久",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{本品牌}在{城市}有代理或办事处吗",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{品类}的上门勘测和安装一般怎么安排",
    },
    // 售后口碑
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{本品牌}售后怎么样，有没有投诉或维权的案例",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{品类}行业常见的售后纠纷有哪些，怎么提前避开",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{本品牌}的用户评价里，吐槽比较多的是什么",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{品类}的质保期一般是多久，出了问题谁负责",
    },
    // 专业长尾
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{品类}的{关键参数}国家标准是什么，哪些厂商能达标",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{场景}下{品类}的选型计算公式和注意事项有哪些",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{品类}的{关键参数}不达标会有什么后果，怎么验收",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{品类}要做哪些认证才能进招投标",
    },
];

/// B2B 制造与工业品。
pub(crate) const B2B_MANUFACTURING: [PromptTemplate; 28] = [
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "工业{品类}都有哪些技术路线，各自的适用工况是什么",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "{品类}的关键部件是谁在做，国产替代进展如何",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "做{品类}的厂家一般分几类，贸易商和工厂怎么区分",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "{品类}的国标和行标有哪些，采购时要看哪几份",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "工厂技改要采购{品类}，怎么筛选供应商比较稳妥",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "预算{X}万的{品类}采购，配置上该怎么取舍",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "{场景}用的{品类}，选国产还是进口，看哪几个指标",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "第一次和{品类}厂家合作，样品和小批量试单怎么谈",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}在{关键参数}上的实测数据差多少",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}、{竞品A}、{竞品B}的交期和售后响应谁更稳",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{场景}这种工况，{本品牌}和{竞品A}哪家案例更多",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}的{产品}和{竞品A}的同级型号比，用料差别在哪",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{品类}的出厂价和经销价差多少，直接找厂家划算吗",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{本品牌}的{产品}报价包含安装调试和运费吗",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "批量采购{品类}，一般能谈到什么样的账期和折扣",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{品类}的非标定制一般怎么加价，模具费谁承担",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{城市}周边有{品类}的生产厂家吗，能不能去看车间",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{本品牌}在{城市}有服务工程师吗，故障多久能到场",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{品类}在{城市}的备件库充足吗，易损件几天能到",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "外地厂家卖到{城市}的{品类}，安装是谁负责",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{本品牌}的{品类}用久了常见问题有哪些，厂家怎么处理",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{品类}的质保一般几年，易损件保不保",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "用过{本品牌}的工厂怎么评价，返修率高不高",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{品类}出了质量争议，检测和责任划分一般怎么走",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{场景}下{品类}的{关键参数}该怎么算，有公式吗",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{品类}的{关键参数}超出范围会有什么风险",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{品类}出厂前的性能试验报告应该包含哪些数据",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{品类}安装时管道和基础要注意哪些公差要求",
    },
];

/// 企业服务 / SaaS。
pub(crate) const ENTERPRISE_SAAS: [PromptTemplate; 28] = [
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "{品类}这类系统一般分哪几种形态，SaaS 和私有化差别大吗",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "国内做{品类}的厂商大概什么梯队，各自主打哪类客户",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "{品类}和传统表格、自建系统比，值不值得换",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "上{品类}之前，企业内部要先理顺哪些流程",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "20 人左右的团队选{品类}，怎么选才不浪费预算",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "预算{X}万一年的{品类}，哪些功能必须有，哪些可以后补",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "{场景}想上{品类}，有没有落地案例可以参考",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "{品类}选型要看哪几个硬指标，试用期内怎么验证",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}在{关键参数}上的差距体现在哪",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}、{竞品A}、{竞品B}的开放接口和集成能力谁更强",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的实施周期比，哪个更快上线",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "同样价位下{本品牌}和{竞品A}的服务内容差别在哪",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{品类}一般按人头还是按模块收费，续费会涨价吗",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{本品牌}的报价里实施费和培训费是分开算的吗",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "预算{X}万，能覆盖{品类}的哪些版本和席位",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{品类}合同里哪些收费项目容易被忽略",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{城市}有{品类}的实施团队吗，能不能驻场",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{本品牌}在{城市}有服务商或代理吗，本地支持怎么算",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{品类}的上门培训和现场调研一般怎么安排",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "异地团队用{品类}，{城市}这边能有专人对接吗",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{本品牌}的客服响应速度怎么样，工单要等多久",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{品类}上线后常见的坑有哪些，厂商会不会兜底",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "用过{本品牌}的企业怎么评价，续约的多不多",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{品类}数据出问题或要迁出时，厂商配合度如何",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{品类}的数据安全合规要满足哪些要求，过等保了吗",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{品类}的开放接口限流和调用配额一般怎么算",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{场景}要打通{品类}和现有系统，接口方案怎么选",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{品类}的可用性承诺一般写到多少，赔偿怎么算",
    },
];

/// 本地生活与专业服务。
pub(crate) const LOCAL_SERVICE: [PromptTemplate; 28] = [
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "{品类}这项服务一般都包含哪些环节，怎么计费",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "做{品类}的机构分哪几种，连锁和个体差别在哪",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "普通人第一次找{品类}服务，容易被忽略的细节有哪些",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "{品类}的从业资格和资质要求是什么",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "{城市}找{品类}服务，怎么挑到靠谱的师傅或团队",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "预算{X}万的{品类}服务，怎么谈才不被临时加价",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "{场景}需要{品类}，选连锁品牌还是本地工作室",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "{品类}的报价差别很大，贵的和便宜的差在哪",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}在{城市}的服务口碑谁更好",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}、{竞品A}、{竞品B}的上门速度和保修期怎么比",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的师傅资质与用料差别在哪",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{场景}找{本品牌}还是{竞品A}，价格和服务哪个更值",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{品类}是按次收费还是按面积、按项目收费",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{本品牌}的报价里含不含材料费和上门费",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "预算{X}万做{品类}，能覆盖哪些内容",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{品类}常见的增项有哪些，怎么提前问清楚",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{城市}哪些区域能上门做{品类}，郊区收不收远程费",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{本品牌}在{城市}有几家门店，周末营业吗",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{品类}的上门服务一般要多久能约到",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{城市}做{品类}的师傅是自有员工还是外包",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{本品牌}做完{品类}之后返工怎么处理，有没有保修",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{品类}常见的投诉集中在哪些方面，怎么留证据",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "在{城市}用过{本品牌}的人怎么评价",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{品类}出现纠纷时，找平台还是找门店更有用",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{品类}用到的材料和设备有哪些验收标准",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{场景}做{品类}要注意哪些安全和规范问题",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{品类}的服务合同里哪些条款要重点看",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{品类}完工后怎么验收，有哪些检查项",
    },
];

/// 跨境电商。
pub(crate) const CROSS_BORDER: [PromptTemplate; 28] = [
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "{品类}出海主要看哪些市场，不同市场的偏好差别大吗",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "做{品类}的供应链集中在哪些产业带",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "{品类}在海外平台上的合规要求有哪些",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "{品类}这类产品的海外买家一般怎么找货源",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "跨境卖家找{品类}供应商，怎么筛才不被坑",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "预算{X}万备货{品类}，起订量和账期怎么谈",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "{场景}要卖{品类}，选哪家工厂的货更稳",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "{品类}的样品和小单试产一般怎么安排",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}在{关键参数}与认证上谁更齐全",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}、{竞品A}、{竞品B}的海外仓和发货时效怎么比",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的定制能力和起订量差别在哪",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{场景}选{本品牌}还是{竞品A}，退换和理赔谁更好谈",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{品类}的出厂价、含税价和到岸价一般差多少",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{本品牌}的报价含不含国际运费和清关费用",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "批量订{品类}，阶梯价一般怎么算",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{品类}的付款方式和账期有哪些常见组合",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{城市}有{品类}的工厂或展厅吗，能不能验厂",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{本品牌}在{城市}有对接团队吗，时差怎么协调",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{品类}从{城市}发货，到港时效一般多久",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{本品牌}在主要出口市场有海外仓或售后点吗",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{本品牌}的货出现质量问题时，理赔和补发怎么处理",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "跨境卖家怎么评价{本品牌}的配合度和响应速度",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{品类}常见的售后纠纷有哪些，合同里怎么写清楚",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{本品牌}的退换率和客诉情况能查到吗",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{品类}出口需要哪些认证，{关键参数}要不要检测报告",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{品类}的包装和标签在目标市场有哪些强制要求",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{场景}下{品类}的物流方案怎么选，成本差多少",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{品类}的知识产权和专利风险怎么排查",
    },
];

/// 招商加盟。
pub(crate) const FRANCHISE: [PromptTemplate; 28] = [
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "{品类}这个赛道的加盟模式一般怎么运作",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "做{品类}加盟的门槛有哪些，除了钱还要准备什么",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "{品类}的门店盈利主要靠哪几块收入",
    },
    PromptTemplate {
        intent: I::CategoryAwareness,
        text: "{品类}行业现在的开店密度和竞争情况怎么样",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "预算{X}万想开{品类}的店，选哪个品牌更稳",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "第一次创业做{品类}，怎么挑加盟品牌不踩坑",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "{城市}开{品类}门店，哪些品牌的扶持政策更实用",
    },
    PromptTemplate {
        intent: I::PurchaseRecommendation,
        text: "{品类}加盟和自创品牌比，哪种更适合新手",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的加盟费和保证金差多少",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}、{竞品A}、{竞品B}的供货价格和毛利空间怎么比",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的选址支持与培训体系差别在哪",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{城市}开{品类}，选{本品牌}还是{竞品A}回本更快",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{品类}加盟一共要投多少，除了加盟费还有哪些开支",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{本品牌}的加盟费里含不含设备、首批物料和装修",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "预算{X}万够不够开一家{品类}的标准店",
    },
    PromptTemplate {
        intent: I::PricingPlan,
        text: "{品类}加盟的分成和管理费一般怎么收",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{城市}还有{品类}的加盟名额吗，区域保护怎么划",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{本品牌}在{城市}有几家店，能不能实地去看",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{品类}开业时总部会派人驻店带教多久",
    },
    PromptTemplate {
        intent: I::LocalService,
        text: "{本品牌}在{城市}的仓储和配送怎么安排",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{本品牌}的加盟商后来经营得怎么样，续约的多吗",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{品类}加盟常见的纠纷有哪些，合同里要重点看什么",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "总部对{品类}门店的运营支持是不是真能落地",
    },
    PromptTemplate {
        intent: I::AfterSalesReputation,
        text: "{本品牌}的加盟商退出时，设备和物料怎么处理",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "开{品类}门店需要办哪些证照，{关键参数}有硬性要求吗",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{品类}的选址评估一般看哪些数据和指标",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{场景}下{品类}门店的人员配置和排班怎么算",
    },
    PromptTemplate {
        intent: I::ProfessionalLongTail,
        text: "{品类}加盟合同里的排他条款和违约金怎么约定",
    },
];

/// 竞品同框模板：为「每竞品 ≥N 条」的补足步骤准备。
///
/// 数量刻意多于单个竞品可能需要的配额，这样多个竞品各占一段互不重叠的模板区间，
/// 不同竞品的同框 prompt 在句式上就不同，不会在去重阶段被合并掉
/// （一旦被合并，`competitor_ids` 会指向文本里没有点名的竞品，SOV 就会算错）。
pub(crate) const COMPARISON: [PromptTemplate; 30] = [
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}比，{关键参数}上的差距有多大",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{竞品A}和{本品牌}在{城市}的服务网点谁更多",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{场景}用{本品牌}还是{竞品A}，交期上谁更稳",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的用户口碑差别主要在哪",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "同样的预算，{本品牌}和{竞品A}能给的配置差多少",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的售后响应速度对比过吗",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{竞品A}的{产品}和{本品牌}的同级款比，用料怎么样",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}在{场景}的落地案例谁更多",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的报价口径一致吗，怎么横着比",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{竞品A}比{本品牌}贵还是便宜，差价花在哪",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的资质认证谁更全",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{城市}本地做{品类}，{本品牌}和{竞品A}哪个更方便",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的定制能力差别大吗",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "选{本品牌}还是{竞品A}，{关键参数}不达标谁来兜底",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的合同条款里，验收标准谁写得更细",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{竞品A}和{本品牌}的备件供应周期差几天",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}在{场景}的运行成本谁更省",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的团队规模和项目经验怎么比",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{竞品A}的老客户回头率高吗，和{本品牌}比呢",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的交付流程与培训支持差别在哪",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的样品或小试政策谁更灵活",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{竞品A}和{本品牌}在{城市}的项目验收通过率怎么比",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的技术支持是原厂做还是外包",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的选型资料和计算工具哪个更好用",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{场景}里{竞品A}和{本品牌}的故障率有数据可比吗",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的付款条件与开票方式差别在哪",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}在{关键参数}上的检测口径一致吗",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{竞品A}和{本品牌}的老客户转介绍情况怎么样",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{本品牌}和{竞品A}的现场交底和培训做得细不细",
    },
    PromptTemplate {
        intent: I::BrandComparison,
        text: "{城市}买{品类}，{本品牌}和{竞品A}的到货周期差多少",
    },
];
