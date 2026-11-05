//! M5 诊断快照与 M6 行动看板快照仓储（Plan C M3–M7 读路径）。
//!
//! 快照按轮次 / 项目整份存取；写路径落地时再决定是否拆关系表。

use geo_domain::ActionEvent;
use sqlx::SqlitePool;

use crate::codec;
use crate::error::StoreError;

#[derive(Debug, Clone)]
pub struct DiagnosisRepo {
    pool: SqlitePool,
}

impl DiagnosisRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn snapshot(&self, round_id: &str, kind: &str) -> Result<Option<String>, StoreError> {
        let row = sqlx::query_as::<_, (String,)>(
            "SELECT payload FROM diagnosis_snapshots WHERE round_id = ? AND kind = ?",
        )
        .bind(round_id)
        .bind(kind)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|(payload,)| payload))
    }

    pub async fn save_snapshot(
        &self,
        round_id: &str,
        kind: &str,
        payload: &str,
    ) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO diagnosis_snapshots (round_id, kind, payload) VALUES (?, ?, ?) \
             ON CONFLICT(round_id, kind) DO UPDATE SET payload = excluded.payload",
        )
        .bind(round_id)
        .bind(kind)
        .bind(payload)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn append_action_event(&self, event: &ActionEvent) -> Result<(), StoreError> {
        sqlx::query(concat!(
            "INSERT INTO action_events (id, project_id, action_id, round_id, category, title, ",
            "status, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ))
        .bind(&event.id)
        .bind(event.project_id.to_string())
        .bind(&event.action_id)
        .bind(&event.round_id)
        .bind(codec::encode_scalar(&event.category)?)
        .bind(&event.title)
        .bind(codec::encode_scalar(&event.status)?)
        .bind(codec::encode_time(&event.at))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// 取一个时间窗口内的处方事件（含边界），按时间升序。
    pub async fn action_events_between(
        &self,
        project_id: &str,
        from: &chrono::DateTime<chrono::Utc>,
        to: &chrono::DateTime<chrono::Utc>,
    ) -> Result<Vec<ActionEvent>, StoreError> {
        let rows = sqlx::query_as::<_, (String, String, String, String, String, String, String, String)>(
            "SELECT id, project_id, action_id, round_id, category, title, status, at \
             FROM action_events WHERE project_id = ? AND at >= ? AND at <= ? ORDER BY at ASC, id ASC",
        )
        .bind(project_id)
        .bind(codec::encode_time(from))
        .bind(codec::encode_time(to))
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(
                |(id, project_id, action_id, round_id, category, title, status, at)| {
                    Ok(ActionEvent {
                        id,
                        project_id: project_id.parse().map_err(|_| {
                            StoreError::Serde(serde_json::Error::io(std::io::Error::new(
                                std::io::ErrorKind::InvalidData,
                                "invalid_project_id",
                            )))
                        })?,
                        action_id,
                        round_id,
                        category: codec::decode_scalar(&category)?,
                        title,
                        status: codec::decode_scalar(&status)?,
                        at: codec::decode_time(&at)?,
                    })
                },
            )
            .collect()
    }

    pub async fn action_board(&self, project_id: &str) -> Result<Option<String>, StoreError> {
        let row = sqlx::query_as::<_, (String,)>(
            "SELECT payload FROM action_boards WHERE project_id = ?",
        )
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|(payload,)| payload))
    }

    pub async fn save_action_board(
        &self,
        project_id: &str,
        payload: &str,
        updated_at: &str,
    ) -> Result<(), StoreError> {
        sqlx::query(
            "INSERT INTO action_boards (project_id, payload, updated_at) VALUES (?, ?, ?) \
             ON CONFLICT(project_id) DO UPDATE SET payload = excluded.payload, \
             updated_at = excluded.updated_at",
        )
        .bind(project_id)
        .bind(payload)
        .bind(updated_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
    /// 所有轮次的某类快照（告警已读需要按 alert id 定位轮次）。
    pub async fn snapshots_of_kind(&self, kind: &str) -> Result<Vec<(String, String)>, StoreError> {
        let rows = sqlx::query_as::<_, (String, String)>(
            "SELECT round_id, payload FROM diagnosis_snapshots WHERE kind = ? ORDER BY round_id ASC",
        )
        .bind(kind)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    /// 所有项目的行动看板快照。
    pub async fn all_action_boards(&self) -> Result<Vec<(String, String)>, StoreError> {
        let rows = sqlx::query_as::<_, (String, String)>(
            "SELECT project_id, payload FROM action_boards ORDER BY project_id ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }
}
