//! M1 项目全量导入导出：跨机器迁移、模板复用与人工备份。
//!
//! 导入的唯一纪律是 **ID 全部重新生成**：同一份导出可以反复导入成多个副本，
//! 绝不会覆盖已有项目；`format_version` 用于将来加字段时判断兼容性。

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use geo_domain::{
    assets_to_csv, competitors_to_csv, Competitor, CompetitorId, EntityCard, EntityCardRevision,
    GeoError, Project, ProjectAsset, ProjectId, PromptId, PromptSet, PromptSetId, RevisionId,
};
use serde::{Deserialize, Serialize};

use crate::error::IpcError;
use crate::services::project_service::{validate_project, ProjectService};

/// 导出文件的格式版本：导入时按它判断兼容性（P0-B 起新增字段要升版本）。
pub const EXPORT_FORMAT_VERSION: &str = "geo-project-export-v1";

/// 项目全量导出（JSON）。竞品、资产、实体卡、修订与题库快照一起走。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectExport {
    pub format_version: String,
    pub project: Project,
    pub entity_card: Option<EntityCard>,
    #[serde(default)]
    pub revisions: Vec<EntityCardRevision>,
    #[serde(default)]
    pub competitors: Vec<Competitor>,
    #[serde(default)]
    pub assets: Vec<ProjectAsset>,
    #[serde(default)]
    pub prompt_sets: Vec<PromptSet>,
    pub exported_at: DateTime<Utc>,
}

/// 导入结果：新项目 ID + 各类对象的落库条数（前端用来给「导入了什么」的反馈）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImportReport {
    pub project_id: ProjectId,
    pub counts: HashMap<String, usize>,
}

impl ProjectService {
    pub async fn export_json(
        &self,
        id: ProjectId,
        now: DateTime<Utc>,
    ) -> Result<ProjectExport, IpcError> {
        let detail = self.detail(id).await?;
        let revisions = self.cards().revisions(id).await?;
        let mut prompt_sets = Vec::new();
        for summary in self.prompt_sets().list_by_project(id).await? {
            prompt_sets.push(self.prompt_sets().get(summary.id).await?);
        }
        Ok(ProjectExport {
            format_version: EXPORT_FORMAT_VERSION.to_string(),
            project: detail.project,
            entity_card: detail.entity_card,
            revisions,
            competitors: detail.competitors,
            assets: detail.assets,
            prompt_sets,
            exported_at: now,
        })
    }

    /// 导入项目 JSON：**所有 ID 重新生成**，因此导入不会覆盖已有项目，
    /// 同一份导出可以反复导入成多个副本（跨机器迁移与模板复用都靠这一点）。
    pub async fn import_json(
        &self,
        payload: &str,
        now: DateTime<Utc>,
    ) -> Result<ImportReport, IpcError> {
        let exported: ProjectExport = serde_json::from_str(payload).map_err(|error| {
            GeoError::validation("payload", format!("不是合法的项目导出文件：{error}"))
        })?;
        if exported.format_version != EXPORT_FORMAT_VERSION {
            return Err(GeoError::validation(
                "format_version",
                format!(
                    "导出文件版本 {} 与当前 {} 不兼容",
                    exported.format_version, EXPORT_FORMAT_VERSION
                ),
            )
            .into());
        }

        let project_id = ProjectId::new();
        match self.write_import(&exported, project_id, now).await {
            Ok(report) => Ok(report),
            Err(error) => {
                // 导入是多张表顺序写，中途失败会留下半截项目（孤儿实体卡、残缺题库）。
                // 外键级联一次删干净：用户看到的要么是完整导入，要么什么都没有。
                // 真正的单事务要等仓储层支持传入 executor，已记入 P0-B 待办。
                if let Err(cleanup) = self.projects().delete(project_id).await {
                    tracing::error!(
                        project_id = %project_id,
                        error = %cleanup,
                        "回滚半截导入失败，请手动删除该项目"
                    );
                }
                Err(error)
            }
        }
    }

    /// 先构造并校验**全部**待写对象，再一次性写库：把失败窗口压到只剩真正的
    /// IO/SQL 错误（那部分由 `import_json` 的补偿删除兜底）。
    async fn write_import(
        &self,
        exported: &ProjectExport,
        project_id: ProjectId,
        now: DateTime<Utc>,
    ) -> Result<ImportReport, IpcError> {
        let mut project = exported.project.clone();
        let created_at = project.created_at;
        project.id = project_id;
        project.updated_at = now;
        validate_project(&project)?;

        let mut competitors = Vec::with_capacity(exported.competitors.len());
        let mut competitor_ids: HashMap<CompetitorId, CompetitorId> =
            HashMap::with_capacity(exported.competitors.len());
        for (position, old) in exported.competitors.iter().enumerate() {
            let mut competitor = old.clone();
            competitor.id = CompetitorId::new();
            competitor.project_id = project_id;
            competitor.position = position as i32;
            competitor.created_at = now;
            competitor_ids.insert(old.id, competitor.id);
            competitors.push(competitor);
        }

        let mut assets = Vec::with_capacity(exported.assets.len());
        for old in &exported.assets {
            assets.push(ProjectAsset::new(
                project_id,
                old.kind,
                old.url.clone(),
                old.title.clone(),
                old.note.clone(),
                now,
            )?);
        }

        let entity_card = exported.entity_card.as_ref().map(|old| {
            let mut card = old.clone();
            card.project_id = project_id;
            card.updated_at = now;
            card.created_at = created_at.min(now);
            card
        });

        let mut revisions = Vec::with_capacity(exported.revisions.len());
        for old in &exported.revisions {
            let mut revision = old.clone();
            revision.id = RevisionId::new();
            revision.project_id = project_id;
            revisions.push(revision);
        }

        let mut prompt_sets = Vec::with_capacity(exported.prompt_sets.len());
        let mut prompt_items = 0usize;
        for old in &exported.prompt_sets {
            let mut set = old.clone();
            set.id = PromptSetId::new();
            set.project_id = project_id;
            set.created_at = now;
            for item in &mut set.items {
                item.id = PromptId::new();
                // 竞品同框标记必须跟着竞品一起换 ID：`competitor_ids` 是 JSON 文本列、
                // 没有外键约束，不重映射就会留下指向旧项目竞品的悬挂 ID，
                // P0-C 的 SOV / 同框率会静默算错。映射不到的（跨项目手工拼接）直接丢弃。
                item.competitor_ids = item
                    .competitor_ids
                    .iter()
                    .filter_map(|old_id| competitor_ids.get(old_id).copied())
                    .collect();
            }
            // `reindex` 会把条目的 `set_id`/`position` 对齐到新快照
            set.reindex();
            set.refresh();
            set.validate()?;
            prompt_items += set.items.len();
            prompt_sets.push(set);
        }

        // ---- 校验全部通过，开始写库 ----
        self.projects().create(&project).await?;
        for competitor in &competitors {
            self.competitors().upsert(competitor).await?;
        }
        for asset in &assets {
            self.assets().add(asset).await?;
        }
        if let Some(card) = &entity_card {
            self.cards().upsert(card).await?;
        }
        for revision in &revisions {
            self.cards().save_revision(revision).await?;
        }
        for set in &prompt_sets {
            self.prompt_sets().create(set).await?;
        }

        let mut counts = HashMap::new();
        counts.insert("projects".to_string(), 1);
        counts.insert("competitors".to_string(), competitors.len());
        counts.insert("assets".to_string(), assets.len());
        counts.insert("entity_cards".to_string(), entity_card.map_or(0, |_| 1));
        counts.insert("revisions".to_string(), revisions.len());
        counts.insert("prompt_sets".to_string(), prompt_sets.len());
        counts.insert("prompt_items".to_string(), prompt_items);

        tracing::info!(project_id = %project_id, ?counts, "项目导入完成");
        Ok(ImportReport { project_id, counts })
    }

    /// 竞品 CSV 导出（spec FR-M1-6）。行序即 `position` 序，与列表页一致。
    pub async fn export_competitors_csv(&self, id: ProjectId) -> Result<String, IpcError> {
        let detail = self.detail(id).await?;
        Ok(without_bom(competitors_to_csv(&detail.competitors)?))
    }

    /// 资产 CSV 导出（spec FR-M1-6）。`kind` 用 snake_case，便于人工编辑后回读。
    pub async fn export_assets_csv(&self, id: ProjectId) -> Result<String, IpcError> {
        let detail = self.detail(id).await?;
        Ok(without_bom(assets_to_csv(&detail.assets)?))
    }
}

/// 导出内容**不带 BOM**：BOM 由前端下载时补（见 `ui/src/components/CsvToolbar.tsx`），
/// 与 `PromptService::export_csv` 保持同一口径，避免两处导出行为分叉。
fn without_bom(csv: String) -> String {
    csv.strip_prefix('\u{FEFF}').unwrap_or(&csv).to_string()
}
