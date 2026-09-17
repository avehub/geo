//! M2 题库服务：生成管线、版本化快照、去重、CSV 往返与条目编辑。
//!
//! 生成管线（spec FR-M2-1，六步固定顺序）：
//! 1. 行业 + 通用模板按项目资料展开（离线可用）；
//! 2. 模型按七类意图分层扩写（不可用则降级，降级原因写进 `notes`）；
//! 3. 中文口语化改写（本地规则始终跑，模型改写作为补充）；
//! 4. 竞品同框补足，保证每个竞品 ≥ `ceil(target × 0.2 / 竞品数)` 条；
//! 5. 字符 3-gram Jaccard 去重（阈值 0.85），并清理「没点到名」的竞品标记；
//! 6. 赋权分组 → 按目标条数选取 → 落库为版本化快照。
//!
//! 纪律：合规红线优先于样本量（命中绝对化用语的内容直接拦截）；
//! 样本量或意图覆盖不足时给补齐建议，绝不静默通过。

use std::collections::HashSet;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use geo_domain::{
    compliance, dedupe, prompts_from_csv, prompts_to_csv, CompetitorId, CsvImportResult,
    DedupeReport, GeoError, Industry, IntentCategory, Project, ProjectId, PromptId, PromptItem,
    PromptSet, PromptSetId, PromptSource, MAX_PROMPT_CHARS, MAX_REPEAT_COUNT,
};
use geo_llm::{chat_json, ChatMessage, ChatRequest, LlmClient};
use geo_store::{
    CompetitorRepo, EntityCardRepo, ProjectRepo, PromptSetRepo, PromptSetSummary, SecretStore,
    SettingsRepo,
};
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

use crate::error::{redact, IpcError};
use crate::services::templates::{
    co_mention_count, colloquial_variants, comparison_prompts, expand_with_context,
    item_from_model, prune_unnamed_competitors, select_items, templates_for, PromptContext,
};
use crate::state::{AppState, LlmFactory};

/// 目标条数下限：再低就连一轮意图分层都铺不开。
pub const MIN_TARGET_COUNT: u16 = 20;
/// 目标条数上限：超过 200 条，人工审核与采集成本都会失控。
pub const MAX_TARGET_COUNT: u16 = 200;
/// 默认目标条数（产品文档 M2 的 60–100 条区间取中偏上）。
pub const DEFAULT_TARGET_COUNT: u16 = 80;
/// 竞品同框题占比：保证每个竞品都有足够样本，SOV 才算得出来。
pub const CO_MENTION_SHARE: f64 = 0.2;

/// 竞品同框候选的安全余量：去重会合并掉一部分，多备几条才够配额。
const CO_MENTION_MARGIN: usize = 4;
/// 配额补足最多重试几轮（每轮换一批模板与槽位取值）。
const MAX_QUOTA_ROUNDS: usize = 3;
/// 单次向模型索取的扩写条数上限。
const MAX_MODEL_ITEMS: usize = 40;
/// 送去模型口语化改写的条目上限（控制提示词长度与成本）。
const MAX_REWRITE_INPUTS: usize = 40;
/// 生效条数下限：只选一两类意图时也不至于只出三五条。
const MIN_EFFECTIVE_TARGET: usize = 10;
/// 候选池相对目标条数的膨胀上限：防止配额补足把内存吃满。
const MAX_POOL_FACTOR: usize = 6;

/// 模型扩写的输出形态。
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct ExpansionItem {
    text: String,
    intent: IntentCategory,
}

/// 人工新增条目的入参（spec FR-M2-6「增」）。
///
/// 只收前端能填的字段：`id`/`position`/`set_id` 由服务端分配，`source` 固定为
/// `Manual`——来源是指标口径的一部分，不能让调用方自称「模板」或「AI 生成」。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PromptDraft {
    pub text: String,
    pub intent: IntentCategory,
    #[serde(default = "default_weight")]
    pub weight: u8,
    /// 留空则按意图归组，与生成管线保持一致。
    #[serde(default)]
    pub group_name: Option<String>,
    #[serde(default = "default_repeat_count")]
    pub repeat_count: u8,
    /// 人工标签（如「核心词」）。生成管线自己打的标签不受影响。
    #[serde(default)]
    pub tags: Vec<String>,
}

fn default_weight() -> u8 {
    3
}

fn default_repeat_count() -> u8 {
    1
}

impl PromptDraft {
    fn into_item(self, set_id: PromptSetId) -> PromptItem {
        let Self {
            text,
            intent,
            weight,
            group_name,
            repeat_count,
            tags,
        } = self;
        let mut item = PromptItem::new(set_id, text, intent)
            .with_weight(weight)
            .with_tags(tags);
        item.source = PromptSource::Manual;
        item.repeat_count = repeat_count;
        item.group_name = Some(
            group_name
                .map(|name| name.trim().to_string())
                .filter(|name| !name.is_empty())
                .unwrap_or_else(|| intent.label_zh().to_string()),
        );
        item
    }
}

/// 模型口语化改写的输出形态：`original` 必须原样回抄，才能对上号。
#[derive(Debug, Clone, PartialEq, Deserialize)]
struct RewritePair {
    original: String,
    rewritten: String,
}

/// 生成参数。前端可以只给一部分，缺省值取 [`GenerateOptions::default`]。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct GenerateOptions {
    /// 目标条数，20~200。
    pub target_count: u16,
    /// 用哪套行业模板。
    pub industry: Industry,
    /// 限定意图；`None` 或空表示七类全要。
    pub intents: Option<Vec<IntentCategory>>,
    /// 每条 prompt 的重复采样次数，1~3。
    pub repeat_count: u8,
}

impl Default for GenerateOptions {
    fn default() -> Self {
        Self {
            target_count: DEFAULT_TARGET_COUNT,
            industry: Industry::default(),
            intents: None,
            repeat_count: 1,
        }
    }
}

impl GenerateOptions {
    /// 参数体检：非法参数在写库之前就被挡下（`validation/failed`）。
    pub fn validate(&self) -> Result<(), IpcError> {
        if !(MIN_TARGET_COUNT..=MAX_TARGET_COUNT).contains(&self.target_count) {
            return Err(GeoError::validation(
                "target_count",
                format!(
                    "目标条数需在 {MIN_TARGET_COUNT}~{MAX_TARGET_COUNT} 之间，当前 {}",
                    self.target_count
                ),
            )
            .into());
        }
        if !(1..=MAX_REPEAT_COUNT).contains(&self.repeat_count) {
            return Err(GeoError::validation(
                "repeat_count",
                format!(
                    "重复采样次数需在 1~{MAX_REPEAT_COUNT} 之间，当前 {}",
                    self.repeat_count
                ),
            )
            .into());
        }
        if let Some(intents) = &self.intents {
            if intents.is_empty() {
                return Err(
                    GeoError::validation("intents", "至少要选择一类意图，或留空表示全部").into(),
                );
            }
            let unique: HashSet<IntentCategory> = intents.iter().copied().collect();
            if unique.len() != intents.len() {
                return Err(GeoError::validation("intents", "意图不能重复选择").into());
            }
        }
        Ok(())
    }

    /// 实际生效的意图清单。
    pub fn intent_list(&self) -> Vec<IntentCategory> {
        match &self.intents {
            Some(intents) if !intents.is_empty() => intents.clone(),
            _ => IntentCategory::all().to_vec(),
        }
    }

    /// 生效目标条数：按选定意图占七类的比例折算。
    ///
    /// 只选两类意图却要 80 条，等于逼着管线灌水（同义改写、无意义变体），
    /// 样本量看着够、实际区分度很差。所以宁可少出，并在 `notes` 里说明不足。
    pub fn effective_target(&self) -> usize {
        let intents = self.intent_list().len();
        let total = IntentCategory::all().len();
        let scaled = (self.target_count as f64 * intents as f64 / total as f64).round() as usize;
        scaled
            .max(MIN_EFFECTIVE_TARGET)
            .min(self.target_count as usize)
    }

    /// 每个竞品至少要有多少条同框 prompt。
    pub fn co_mention_quota(&self, competitor_count: usize) -> usize {
        co_mention_quota(self.effective_target(), competitor_count)
    }
}

fn co_mention_quota(target: usize, competitor_count: usize) -> usize {
    if competitor_count == 0 {
        return 0;
    }
    ((target as f64 * CO_MENTION_SHARE) / competitor_count as f64).ceil() as usize
}

/// 题库服务。与 `ProjectService` 一样不依赖 `tauri::*`，集成测试可直调。
#[derive(Clone)]
pub struct PromptService {
    pool: SqlitePool,
    llm: Arc<LlmFactory>,
    secrets: Arc<dyn SecretStore>,
}

impl PromptService {
    pub fn new(pool: SqlitePool, llm: Arc<LlmFactory>, secrets: Arc<dyn SecretStore>) -> Self {
        Self { pool, llm, secrets }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone(), state.llm.clone(), state.secrets.clone())
    }

    fn sets(&self) -> PromptSetRepo {
        PromptSetRepo::new(self.pool.clone())
    }

    // -----------------------------------------------------------------------
    // 生成
    // -----------------------------------------------------------------------

    /// 生成一版题库并落库为版本化快照。
    pub async fn generate(
        &self,
        project_id: ProjectId,
        options: GenerateOptions,
        now: DateTime<Utc>,
    ) -> Result<PromptSet, IpcError> {
        options.validate()?;

        let project = ProjectRepo::new(self.pool.clone()).get(project_id).await?;
        let competitors = CompetitorRepo::new(self.pool.clone())
            .list_by_project(project_id)
            .await?;
        let card = EntityCardRepo::new(self.pool.clone())
            .get(project_id)
            .await?;

        let intents = options.intent_list();
        let context = PromptContext::new(&project, &competitors).with_card(card.as_ref());
        let target = options.effective_target();
        let quota = co_mention_quota(target, context.competitors.len());

        let mut notes: Vec<String> = Vec::new();
        let templates = templates_for(options.industry, &intents);
        let mut candidates = expand_with_context(&context, &templates);

        // 第 2 步：模型按意图分层扩写（不可用即降级）
        match self
            .expand_with_model(&project, &context, &intents, &candidates)
            .await
        {
            Ok(items) => {
                tracing::info!(project_id = %project_id, added = items.len(), "模型扩写完成");
                candidates.extend(items);
            }
            Err(reason) => notes.push(degradation_note("模型意图扩写", &reason)),
        }

        // 第 3 步：口语化改写。本地规则始终跑，模型改写只是补充。
        let colloquial = colloquial_variants(&candidates, &context);
        candidates.extend(colloquial);
        match self.rewrite_with_model(&context, &candidates).await {
            Ok(items) => candidates.extend(items),
            Err(reason) => notes.push(degradation_note("模型口语化改写", &reason)),
        }

        // 第 4 步：竞品同框补足
        if quota > 0 {
            candidates.extend(comparison_prompts(&context, quota + CO_MENTION_MARGIN));
        }

        let (candidates, blocked) = drop_non_compliant(candidates);
        if blocked > 0 {
            notes.push(format!(
                "已拦截 {blocked} 条命中广告法红线词的内容（合规优先于样本量）。"
            ));
        }

        // 第 5 步：去重
        let mut pool = dedupe_pool(candidates, &context);
        pool = self.ensure_co_mention_quota(pool, &context, quota, target, &mut notes);

        // 第 6 步：赋权已在构造时完成，这里按目标条数选取并套用采样次数
        let mut items = select_items(pool, target, quota);
        for item in &mut items {
            item.repeat_count = options.repeat_count;
        }
        prune_unnamed_competitors(&mut items, &context);
        report_quota_shortfall(&items, &context, quota, &mut notes);

        let version = self.sets().next_version(project_id).await?;
        let mut set = PromptSet::new(
            project_id,
            version,
            format!("第 {version} 版题库"),
            items,
            now,
            None,
        );
        set.reindex();
        set.validate()?;

        let mut all_notes = notes;
        all_notes.extend(set.shortfall_advice(options.target_count as usize));
        set.notes = (!all_notes.is_empty()).then(|| all_notes.join("\n"));

        self.sets().create(&set).await?;
        tracing::info!(
            project_id = %project_id,
            set_id = %set.id,
            version,
            items = set.items.len(),
            degraded = set
                .notes
                .as_deref()
                .is_some_and(|notes| notes.contains("降级")),
            "题库生成完成"
        );
        Ok(set)
    }

    /// 竞品同框配额不足时，换一批模板与槽位取值再补，最多 [`MAX_QUOTA_ROUNDS`] 轮。
    fn ensure_co_mention_quota(
        &self,
        mut pool: Vec<PromptItem>,
        context: &PromptContext,
        quota: usize,
        target: usize,
        notes: &mut Vec<String>,
    ) -> Vec<PromptItem> {
        if quota == 0 || context.competitors.is_empty() {
            return pool;
        }
        let mut per_competitor = quota + CO_MENTION_MARGIN;
        for round in 0..MAX_QUOTA_ROUNDS {
            if quota_shortfall(&pool, context, quota).is_empty() {
                return pool;
            }
            per_competitor += CO_MENTION_MARGIN;
            pool.extend(comparison_prompts(context, per_competitor));
            let (clean, blocked) = drop_non_compliant(pool);
            if blocked > 0 && round == 0 {
                notes.push(format!("已拦截 {blocked} 条命中广告法红线词的内容。"));
            }
            pool = dedupe_pool(clean, context);
            if pool.len() >= target.saturating_mul(MAX_POOL_FACTOR) {
                break;
            }
        }
        pool
    }

    // -----------------------------------------------------------------------
    // 模型调用（全部可降级）
    // -----------------------------------------------------------------------

    /// 装配一次性的 LLM 客户端。任何一步不可用都返回中文原因，由调用方降级。
    async fn client(&self) -> Result<LlmClient, String> {
        let settings = SettingsRepo::new(self.pool.clone())
            .get()
            .await
            .map_err(|error| error.to_string())?;
        let config = LlmFactory::config_from_settings(&settings).map_err(|error| error.message)?;
        let api_key = self
            .secrets
            .get(&config.secret_ref)
            .await
            .map_err(|error| error.to_string())?
            .filter(|key| !key.trim().is_empty())
            .ok_or_else(|| "未配置 API Key".to_string())?;
        Ok(self.llm.client(config, &api_key))
    }

    async fn expand_with_model(
        &self,
        project: &Project,
        context: &PromptContext,
        intents: &[IntentCategory],
        existing: &[PromptItem],
    ) -> Result<Vec<PromptItem>, String> {
        let client = self.client().await?;
        let request = ChatRequest::new(vec![
            ChatMessage::system(EXPANSION_SYSTEM),
            ChatMessage::user(expansion_prompt(project, context, intents, existing)),
        ])
        .json();
        let parsed: Vec<ExpansionItem> =
            chat_json(&client, &request, |items: &Vec<ExpansionItem>| {
                if items.is_empty() {
                    return Err("模型没有返回任何 prompt".to_string());
                }
                Ok(())
            })
            .await
            .map_err(|error| redact(&error.user_message()))?;

        let allowed: HashSet<IntentCategory> = intents.iter().copied().collect();
        let items = parsed
            .into_iter()
            .filter(|item| allowed.contains(&item.intent))
            .map(|item| {
                item_from_model(
                    item.text.trim().to_string(),
                    item.intent,
                    context,
                    PromptSource::Generated,
                    vec!["模型扩写".to_string()],
                )
            })
            .filter(|item| !item.text.is_empty() && item.text.chars().count() <= MAX_PROMPT_CHARS)
            .take(MAX_MODEL_ITEMS)
            .collect();
        Ok(items)
    }

    async fn rewrite_with_model(
        &self,
        context: &PromptContext,
        candidates: &[PromptItem],
    ) -> Result<Vec<PromptItem>, String> {
        let inputs: Vec<&PromptItem> = candidates
            .iter()
            .filter(|item| item.source == PromptSource::Template)
            .take(MAX_REWRITE_INPUTS)
            .collect();
        if inputs.is_empty() {
            return Ok(Vec::new());
        }
        let client = self.client().await?;
        let request = ChatRequest::new(vec![
            ChatMessage::system(REWRITE_SYSTEM),
            ChatMessage::user(rewrite_prompt(&inputs)),
        ])
        .json();
        let pairs: Vec<RewritePair> = chat_json(&client, &request, |items: &Vec<RewritePair>| {
            if items.is_empty() {
                return Err("模型没有返回任何改写结果".to_string());
            }
            Ok(())
        })
        .await
        .map_err(|error| redact(&error.user_message()))?;

        // 只对得上号的改写才收：模型抄错原文时，宁可丢掉也不要来路不明的条目。
        let mut items = Vec::new();
        for pair in pairs {
            let rewritten = pair.rewritten.trim().to_string();
            if rewritten.is_empty() || rewritten.chars().count() > MAX_PROMPT_CHARS {
                continue;
            }
            let Some(source) = inputs.iter().find(|item| {
                geo_domain::dedupe::normalize(&item.text)
                    == geo_domain::dedupe::normalize(&pair.original)
            }) else {
                continue;
            };
            let mut tags = source.tags.clone();
            for tag in ["口语化", "模型改写"] {
                if !tags.iter().any(|existing| existing == tag) {
                    tags.push(tag.to_string());
                }
            }
            let mut item = item_from_model(
                rewritten,
                source.intent,
                context,
                PromptSource::Rewritten,
                tags,
            );
            item.competitor_ids = source.competitor_ids.clone();
            items.push(item);
        }
        Ok(items)
    }

    // -----------------------------------------------------------------------
    // 快照管理
    // -----------------------------------------------------------------------

    pub async fn list(&self, project_id: ProjectId) -> Result<Vec<PromptSetSummary>, IpcError> {
        Ok(self.sets().list_by_project(project_id).await?)
    }

    pub async fn get(&self, id: PromptSetId) -> Result<PromptSet, IpcError> {
        Ok(self.sets().get(id).await?)
    }

    pub async fn rename(&self, id: PromptSetId, label: &str) -> Result<PromptSetSummary, IpcError> {
        let label = label.trim();
        if label.is_empty() {
            return Err(GeoError::validation("label", "题库名称不能为空").into());
        }
        Ok(self.sets().rename(id, label).await?)
    }

    pub async fn delete(&self, id: PromptSetId) -> Result<(), IpcError> {
        // 幂等删除前仍然报一次 not_found：前端据此刷新列表，而不是静默无反应
        self.get(id).await?;
        Ok(self.sets().delete(id).await?)
    }

    /// 单条编辑（权重、分组、标签、文本、采样次数）。改完重算内容指纹。
    pub async fn update_item(&self, item: PromptItem) -> Result<PromptItem, IpcError> {
        let set_id = item.set_id;
        self.apply_edits(set_id, std::slice::from_ref(&item)).await
    }

    /// 批量编辑：一次事务写完，只重算一次指纹。
    pub async fn update_items_bulk(&self, edits: Vec<PromptItem>) -> Result<PromptSet, IpcError> {
        let Some(first) = edits.first() else {
            return Err(GeoError::validation("items", "没有要更新的条目").into());
        };
        let set_id = first.set_id;
        self.apply_edits(set_id, &edits).await?;
        self.get(set_id).await
    }

    /// 编辑的公共骨架：校验 → 替换 → 重算指纹落库。返回最后一条改完的条目。
    async fn apply_edits(
        &self,
        set_id: PromptSetId,
        edits: &[PromptItem],
    ) -> Result<PromptItem, IpcError> {
        let set = self.get(set_id).await?;
        let mut items = set.items.clone();
        let mut last: Option<PromptItem> = None;

        for edit in edits {
            edit.validate()?;
            if !compliance::is_clean(&edit.text) {
                return Err(IpcError::new(
                    "compliance/violation",
                    format!("内容命中广告法红线词：{}", violation_terms(&edit.text)),
                ));
            }
            if edit.set_id != set_id {
                return Err(GeoError::validation("set_id", "不能把条目改到别的题库快照里").into());
            }
            let Some(position) = items.iter().position(|existing| existing.id == edit.id) else {
                return Err(GeoError::not_found("prompt_item", edit.id).into());
            };
            let mut next = edit.clone();
            next.position = position as i32;
            if next.group_name.as_deref().unwrap_or("").trim().is_empty() {
                next.group_name = Some(next.intent.label_zh().to_string());
            }
            items[position] = next.clone();
            last = Some(next);
        }

        reindex(&mut items, set_id);
        self.sets()
            .replace_items(set_id, items, set.created_at)
            .await?;
        last.ok_or_else(|| GeoError::validation("items", "没有要更新的条目").into())
    }

    /// 人工新增条目（spec FR-M2-6「增」）。
    ///
    /// 红线校验与 `validate` 都在写库之前跑完：一批里有一条不合格就整批不落库，
    /// 免得用户看到「新增成功」却少了几条。
    pub async fn add_items(
        &self,
        set_id: PromptSetId,
        drafts: Vec<PromptDraft>,
        now: DateTime<Utc>,
    ) -> Result<PromptSet, IpcError> {
        if drafts.is_empty() {
            return Err(GeoError::validation("items", "没有要新增的条目").into());
        }
        let set = self.get(set_id).await?;
        let mut items = set.items.clone();
        for draft in drafts {
            let item = draft.into_item(set_id);
            item.validate()?;
            if !compliance::is_clean(&item.text) {
                return Err(IpcError::new(
                    "compliance/violation",
                    format!("内容命中广告法红线词：{}", violation_terms(&item.text)),
                ));
            }
            items.push(item);
        }
        reindex(&mut items, set_id);
        Ok(self.sets().replace_items(set_id, items, now).await?)
    }

    /// 批量删除条目（spec FR-M2-6「删」+ 批量选择）。
    ///
    /// 不允许把快照删空：空题库还会留在版本列表里，看起来像数据丢了；
    /// 要清空请显式删除整个快照（与 CSV 空导入同一条纪律）。
    pub async fn delete_items(
        &self,
        set_id: PromptSetId,
        ids: &[PromptId],
        now: DateTime<Utc>,
    ) -> Result<PromptSet, IpcError> {
        if ids.is_empty() {
            return Err(GeoError::validation("ids", "没有要删除的条目").into());
        }
        let set = self.get(set_id).await?;
        for id in ids {
            if !set.items.iter().any(|item| item.id == *id) {
                return Err(GeoError::not_found("prompt_item", id).into());
            }
        }
        if ids.len() >= set.items.len() {
            return Err(
                GeoError::validation("ids", "不能把题库删空：要清空请删除整个题库快照").into(),
            );
        }
        let mut items: Vec<PromptItem> = set
            .items
            .into_iter()
            .filter(|item| !ids.contains(&item.id))
            .collect();
        reindex(&mut items, set_id);
        Ok(self.sets().replace_items(set_id, items, now).await?)
    }

    /// 对已落库的快照再跑一次去重（人工导入后常用）。
    pub async fn dedupe_set(
        &self,
        id: PromptSetId,
        now: DateTime<Utc>,
    ) -> Result<DedupeReport, IpcError> {
        let set = self.get(id).await?;
        let mut report = dedupe(set.items.clone());
        let context = self.context_of(set.project_id).await?;
        let mut kept = std::mem::take(&mut report.kept);
        prune_unnamed_competitors(&mut kept, &context);
        reindex(&mut kept, id);
        let stored = self.sets().replace_items(id, kept, now).await?;
        // 报告描述「落库后的样子」：竞品 ID 清理与 position 重排都发生在 dedupe 之后，
        // 回填库里的条目，前端才不会按报告展示出已被清掉的竞品 ID。
        report.kept = stored.items;
        tracing::info!(
            set_id = %id,
            removed = report.removed_count(),
            pairs = report.duplicate_pairs,
            "题库去重完成"
        );
        Ok(report)
    }

    /// 导出 CSV。**不带 BOM**：BOM 由落盘命令统一补（见 `ipc/export.rs::export_body`），
    /// 两边都加会变成两个不可见字符，Excel 反而识别不了。
    pub async fn export_csv(&self, id: PromptSetId) -> Result<String, IpcError> {
        let set = self.get(id).await?;
        let csv = prompts_to_csv(&set.items)?;
        Ok(csv.strip_prefix('\u{FEFF}').unwrap_or(&csv).to_string())
    }

    /// 导入 CSV：整包替换条目。表头不符整批拒绝，行级错误允许部分成功
    /// （含广告法红线行，见 `csv_io::prompts_from_csv`）。
    ///
    /// 一条有效条目都没有时**拒绝**：替换语义下一次误粘贴就能清空整个题库，
    /// 而用户只会看到「导入 0 条」的成功提示。要清空请显式删除题库。
    pub async fn import_csv(
        &self,
        id: PromptSetId,
        payload: &str,
        now: DateTime<Utc>,
    ) -> Result<CsvImportResult, IpcError> {
        let set = self.get(id).await?;
        let result = prompts_from_csv(payload, id)?;
        if result.items.is_empty() && !set.items.is_empty() {
            tracing::warn!(set_id = %id, errors = result.error_count(), "CSV 导入没有有效条目，已保留原题库");
            return Err(IpcError::new(
                "prompt_set/empty_import",
                "导入内容里没有任何有效条目，原题库保持不变（要清空请直接删除题库）",
            )
            .with_detail(serde_json::to_value(&result.errors).unwrap_or(serde_json::Value::Null)));
        }
        let mut items = result.items.clone();
        reindex(&mut items, id);
        self.sets().replace_items(id, items, now).await?;
        tracing::info!(
            set_id = %id,
            imported = result.imported_count(),
            errors = result.error_count(),
            previous = set.items.len(),
            "CSV 导入完成"
        );
        Ok(result)
    }

    /// 装配占位符上下文（去重后清理竞品标记时要用）。
    async fn context_of(&self, project_id: ProjectId) -> Result<PromptContext, IpcError> {
        let project = ProjectRepo::new(self.pool.clone()).get(project_id).await?;
        let competitors = CompetitorRepo::new(self.pool.clone())
            .list_by_project(project_id)
            .await?;
        let card = EntityCardRepo::new(self.pool.clone())
            .get(project_id)
            .await?;
        Ok(PromptContext::new(&project, &competitors).with_card(card.as_ref()))
    }
}

// ---------------------------------------------------------------------------
// 纯函数辅助
// ---------------------------------------------------------------------------

/// 拦截命中广告法红线词的内容，返回（保留条目, 拦截条数）。
fn drop_non_compliant(items: Vec<PromptItem>) -> (Vec<PromptItem>, usize) {
    let mut kept = Vec::with_capacity(items.len());
    let mut blocked = 0;
    for item in items {
        let text = item.text.trim();
        if text.is_empty() || text.chars().count() > MAX_PROMPT_CHARS {
            blocked += 1;
            continue;
        }
        if !compliance::is_clean(text) {
            tracing::warn!(terms = %violation_terms(text), "拦截命中红线词的生成内容");
            blocked += 1;
            continue;
        }
        kept.push(item);
    }
    (kept, blocked)
}

/// 去重 + 清理没点到名的竞品标记（两步必须连着做：合并会把竞品 ID 并进来）。
fn dedupe_pool(candidates: Vec<PromptItem>, context: &PromptContext) -> Vec<PromptItem> {
    let mut kept = dedupe(candidates).kept;
    prune_unnamed_competitors(&mut kept, context);
    kept
}

/// 配额还差多少：返回同框条数不足的竞品 ID。
fn quota_shortfall(
    pool: &[PromptItem],
    context: &PromptContext,
    quota: usize,
) -> Vec<CompetitorId> {
    context
        .competitors
        .iter()
        .filter(|competitor| co_mention_count(pool, competitor) < quota)
        .map(|competitor| competitor.id)
        .collect()
}

/// 配额最终没补齐时写进 `notes`：宁可告诉用户，也不要让 SOV 悄悄失真。
fn report_quota_shortfall(
    items: &[PromptItem],
    context: &PromptContext,
    quota: usize,
    notes: &mut Vec<String>,
) {
    for competitor in &context.competitors {
        let count = co_mention_count(items, competitor);
        if count < quota {
            notes.push(format!(
                "竞品「{}」的同框 prompt 只有 {} 条，低于配额 {} 条，其 SOV 仅供参考。",
                competitor.name, count, quota
            ));
        }
    }
}

fn reindex(items: &mut [PromptItem], set_id: PromptSetId) {
    for (index, item) in items.iter_mut().enumerate() {
        item.position = index as i32;
        item.set_id = set_id;
    }
}

fn violation_terms(text: &str) -> String {
    let mut terms: Vec<String> = compliance::scan(text)
        .into_iter()
        .map(|violation| violation.term)
        .collect();
    terms.sort();
    terms.dedup();
    terms.join("、")
}

/// 降级说明：一定要出现「降级」二字，前端据此提示用户当前题库不含模型贡献。
fn degradation_note(step: &str, reason: &str) -> String {
    format!("{step}已降级（原因：{reason}）：本轮题目改由行业模板与本地口语化改写补足。")
}

const EXPANSION_SYSTEM: &str =
    "你是中国企业内容营销团队的搜索意图专家，熟悉用户在 AI 问答与搜索里的真实问法。\
用户会给你一个品牌档案与已经生成的一部分 prompt，你要按意图分层补充新的中文 prompt。\
规则：1) 只输出 JSON 数组本体，不要 Markdown 代码块、不要解释文字；\
2) 数组每项是 {\"text\": \"...\", \"intent\": \"...\"}，intent 只能取 \
category_awareness、purchase_recommendation、brand_comparison、pricing_plan、\
local_service、after_sales_reputation、professional_long_tail；\
3) text 是真实用户会敲进搜索框的问法，口语、具体、带场景或参数，长度 12~40 字；\
4) 不要重复已经给出的 prompt，也不要只改标点或换一个近义词；\
5) 不得出现「保证排名/霸屏/第一/最佳/最优/唯一/顶级/100%/永久」等绝对化用语；\
6) 只写问法，不要写答案，也不要编造该品牌没有的资质、案例或数据。";

const REWRITE_SYSTEM: &str = "你是中文口语化改写助手。\
用户会给你一批书面化的 prompt，你要把它们改写成真实用户在群里、在搜索框里会问的说法。\
规则：1) 只输出 JSON 数组本体，不要 Markdown 代码块、不要解释文字；\
2) 数组每项是 {\"original\": \"...\", \"rewritten\": \"...\"}，original 必须原样回抄输入句子；\
3) 改写后保留品牌名、竞品名、型号、数字与地域，不得改变原意；\
4) 允许使用「哪个好、靠谱吗、多少钱、是不是智商税、怎么选」这类口语，长度 12~40 字；\
5) 不得出现「保证排名/霸屏/第一/最佳/最优/唯一/顶级/100%/永久」等绝对化用语。";

fn expansion_prompt(
    project: &Project,
    context: &PromptContext,
    intents: &[IntentCategory],
    existing: &[PromptItem],
) -> String {
    let per_intent = (MAX_MODEL_ITEMS / intents.len().max(1)).max(3);
    let intent_lines: Vec<String> = intents
        .iter()
        .map(|intent| {
            format!(
                "- {}（{}）：{} 条",
                intent.label_zh(),
                intent.as_str(),
                per_intent
            )
        })
        .collect();
    let samples: Vec<String> = existing
        .iter()
        .take(MAX_REWRITE_INPUTS)
        .map(|item| format!("- {}", item.text))
        .collect();
    format!(
        "品牌：{brand}\n别名：{aliases}\n品类：{category}\n代表产品：{product}\n\
         行业：{industry}\n服务地域：{region}\n竞品：{competitors}\n\n\
         请按下面的意图分层各补充 prompt：\n{intent_lines}\n\n\
         已有的 prompt（不要重复）：\n{samples}\n\n\
         只输出 JSON 数组。",
        brand = project.brand_name,
        aliases = if project.aliases.is_empty() {
            "（无）".to_string()
        } else {
            project.aliases.join("、")
        },
        category = context.category,
        product = context.product,
        industry = project.industry.label_zh(),
        region = if project.region.trim().is_empty() {
            "（未填写）".to_string()
        } else {
            project.region.clone()
        },
        competitors = if context.competitors.is_empty() {
            "（未填写）".to_string()
        } else {
            context.competitor_names().join("、")
        },
        intent_lines = intent_lines.join("\n"),
        samples = if samples.is_empty() {
            "（无）".to_string()
        } else {
            samples.join("\n")
        },
    )
}

fn rewrite_prompt(inputs: &[&PromptItem]) -> String {
    let lines: Vec<String> = inputs
        .iter()
        .map(|item| format!("- {}", item.text))
        .collect();
    format!(
        "请把下面 {} 条 prompt 改写成口语化问法，只输出 JSON 数组：\n{}",
        inputs.len(),
        lines.join("\n")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_options_match_the_documented_target() {
        let options = GenerateOptions::default();
        assert_eq!(options.target_count, DEFAULT_TARGET_COUNT);
        assert_eq!(options.repeat_count, 1);
        assert_eq!(options.intent_list().len(), 7);
        assert_eq!(options.effective_target(), 80);
        assert_eq!(options.co_mention_quota(3), 6);
        options.validate().expect("默认参数合法");
    }

    #[test]
    fn effective_target_shrinks_with_the_intent_selection() {
        let two = GenerateOptions {
            intents: Some(vec![
                IntentCategory::BrandComparison,
                IntentCategory::PricingPlan,
            ]),
            ..Default::default()
        };
        assert_eq!(two.effective_target(), 23);
        assert_eq!(two.co_mention_quota(3), 2);

        let one = GenerateOptions {
            intents: Some(vec![IntentCategory::LocalService]),
            target_count: MIN_TARGET_COUNT,
            ..Default::default()
        };
        assert_eq!(one.effective_target(), MIN_EFFECTIVE_TARGET);
    }

    #[test]
    fn options_outside_the_documented_range_are_rejected() {
        for options in [
            GenerateOptions {
                target_count: 19,
                ..Default::default()
            },
            GenerateOptions {
                target_count: 201,
                ..Default::default()
            },
            GenerateOptions {
                repeat_count: 0,
                ..Default::default()
            },
            GenerateOptions {
                repeat_count: 4,
                ..Default::default()
            },
            GenerateOptions {
                intents: Some(vec![]),
                ..Default::default()
            },
            GenerateOptions {
                intents: Some(vec![
                    IntentCategory::LocalService,
                    IntentCategory::LocalService,
                ]),
                ..Default::default()
            },
        ] {
            let error = options.validate().expect_err("应被拒绝");
            assert_eq!(error.code, "validation/failed");
        }
    }

    #[test]
    fn quota_matches_the_spec_formula() {
        assert_eq!(co_mention_quota(80, 3), 6);
        assert_eq!(co_mention_quota(80, 5), 4);
        assert_eq!(co_mention_quota(80, 0), 0);
        assert_eq!(co_mention_quota(60, 4), 3);
    }

    #[test]
    fn non_compliant_candidates_are_blocked_not_silently_kept() {
        let clean = PromptItem::new(
            PromptSetId::default(),
            "宏宇泵业靠谱吗",
            IntentCategory::PurchaseRecommendation,
        );
        let blocked = PromptItem::new(
            PromptSetId::default(),
            "宏宇泵业是行业第一，保证排名首页",
            IntentCategory::PurchaseRecommendation,
        );
        let too_long = PromptItem::new(
            PromptSetId::default(),
            "长".repeat(MAX_PROMPT_CHARS + 1),
            IntentCategory::CategoryAwareness,
        );
        let (kept, count) = drop_non_compliant(vec![clean.clone(), blocked, too_long]);
        assert_eq!(kept, vec![clean]);
        assert_eq!(count, 2);
    }

    #[test]
    fn degradation_note_states_the_degradation_and_the_reason() {
        let note = degradation_note("模型意图扩写", "未配置 API Key");
        assert!(note.contains("降级"));
        assert!(note.contains("未配置 API Key"));
    }

    #[test]
    fn violation_terms_are_deduped_and_sorted() {
        assert_eq!(
            violation_terms("保证排名第一，全网第一"),
            "保证排名、全网第一、排名第一"
        );
    }

    #[test]
    fn csv_export_has_no_bom_because_the_frontend_adds_one() {
        let items = vec![PromptItem::new(
            PromptSetId::default(),
            "宏宇泵业的水泵多少钱",
            IntentCategory::PricingPlan,
        )];
        let csv = prompts_to_csv(&items).expect("可导出");
        let stripped = csv.strip_prefix('\u{FEFF}').unwrap_or(&csv).to_string();
        assert!(stripped.starts_with("text,intent,"));
        assert!(prompts_to_csv(&items)
            .expect("可导出")
            .starts_with('\u{FEFF}'));
    }
}
