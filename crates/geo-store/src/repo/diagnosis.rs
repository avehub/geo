//! M5 诊断快照与 M6 行动看板快照仓储（Plan C M3–M7 读路径）。
//!
//! 快照按轮次 / 项目整份存取；写路径落地时再决定是否拆关系表。

use sqlx::SqlitePool;

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
}
