//! M4 解析与核查读路径服务（Plan C M3–M7 读路径第二段）。
//!
//! 两条命令：`insight_list` / `fact_check_list`。纠正与结办仍 demo-only。

use chrono::{DateTime, Utc};
use geo_domain::{
    AnswerInsight, FactCheckBoard, FactCheckIssue, FactIssueStatus, GeoError, InsightCorrection,
    InsightFilter, Sentiment,
};
use geo_store::{CollectionRepo, InsightRepo, StoreError};
use sqlx::SqlitePool;

use crate::error::IpcError;
use crate::state::AppState;

#[derive(Debug, Clone)]
pub struct InsightService {
    pool: SqlitePool,
}

impl InsightService {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn from_state(state: &AppState) -> Self {
        Self::new(state.pool.clone())
    }

    fn insights(&self) -> InsightRepo {
        InsightRepo::new(self.pool.clone())
    }

    fn collection(&self) -> CollectionRepo {
        CollectionRepo::new(self.pool.clone())
    }

    async fn require_round(&self, round_id: &str) -> Result<(), IpcError> {
        match self.collection().round(round_id).await? {
            Some(_) => Ok(()),
            None => Err(GeoError::validation("round_id", "invalid_id")
                .with_param("value", round_id)
                .into()),
        }
    }

    pub async fn insight_list(
        &self,
        round_id: String,
        filter: InsightFilter,
    ) -> Result<Vec<AnswerInsight>, IpcError> {
        self.require_round(&round_id).await?;
        Ok(self
            .insights()
            .insights(&round_id)
            .await?
            .into_iter()
            .filter(|insight| insight.matches(&filter))
            .collect())
    }

    pub async fn fact_check_list(&self, round_id: String) -> Result<FactCheckBoard, IpcError> {
        self.require_round(&round_id).await?;
        Ok(FactCheckBoard {
            issues: self.insights().fact_issues(&round_id).await?,
            summary: self.insights().fact_summary(&round_id).await?,
        })
    }
    /// 人工纠正：只改提及 / 位次 / 情感；同步证据投影与提及明细里的本品牌行。
    pub async fn correct_insight(
        &self,
        id: String,
        correction: InsightCorrection,
        now: DateTime<Utc>,
    ) -> Result<AnswerInsight, IpcError> {
        let mut insight = match self.insights().get_insight(&id).await? {
            Some(insight) => insight,
            None => {
                return Err(GeoError::validation("insight_id", "invalid_id")
                    .with_param("value", id)
                    .into());
            }
        };

        let mut corrected = Vec::new();
        if let Some(mentioned) = correction.self_mentioned {
            insight.self_mentioned = mentioned;
            corrected.push("self_mentioned".to_string());
            if !mentioned {
                insight.self_rank = None;
                insight.self_sentiment = None;
            }
        }
        if let Some(rank) = correction.self_rank {
            if let Some(value) = rank {
                if value < 1 {
                    return Err(GeoError::validation("self_rank", "out_of_range")
                        .with_param("expected", ">=1")
                        .with_param("value", value.to_string())
                        .into());
                }
            }
            if insight.self_mentioned {
                insight.self_rank = rank;
                corrected.push("self_rank".to_string());
            }
        }
        if insight.self_mentioned {
            if let Some(sentiment) = correction.self_sentiment {
                insight.self_sentiment = sentiment;
                corrected.push("self_sentiment".to_string());
            }
        }
        for field in corrected {
            if !insight.corrected_fields.contains(&field) {
                insight.corrected_fields.push(field);
            }
        }
        insight.needs_review = false;
        insight.reviewed_at = Some(now);
        if let Some(mention) = insight
            .mentions
            .iter_mut()
            .find(|mention| mention.role == geo_domain::BrandRole::Self_)
        {
            mention.rank = insight.self_rank;
            mention.sentiment = insight.self_sentiment.unwrap_or(Sentiment::Neutral);
        }
        self.insights().save_insight_correction(&insight).await?;
        Ok(insight)
    }

    /// 结办核查问题：`corrected` / `false_positive` 盖 resolved_at，`open` 清掉。
    /// 契约外的 status 收敛成 `open`（最保守：不声称已处理）。
    pub async fn resolve_fact_issue(
        &self,
        id: String,
        status: String,
        note: Option<String>,
        now: DateTime<Utc>,
    ) -> Result<FactCheckIssue, IpcError> {
        let status = match status.as_str() {
            "false_positive" => FactIssueStatus::FalsePositive,
            "corrected" => FactIssueStatus::Corrected,
            _ => FactIssueStatus::Open,
        };
        let note = note
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let resolved_at = if status == FactIssueStatus::Open {
            None
        } else {
            Some(now)
        };
        match self
            .insights()
            .save_issue_resolution(&id, status, note.as_deref(), resolved_at)
            .await
        {
            Ok(()) => {}
            Err(StoreError::NotFound { .. }) => {
                return Err(GeoError::validation("issue_id", "invalid_id")
                    .with_param("value", id)
                    .into());
            }
            Err(error) => return Err(error.into()),
        }
        Ok(self
            .insights()
            .get_issue(&id)
            .await?
            .expect("刚写入的核查问题必须可读"))
    }
}
