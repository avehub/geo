//! Article Studio 仓储：方向、模板、排期、文章四张表。
//!
//! 排序口径：方向 / 模板按 `created_at ASC, id ASC`；排期按 `enabled DESC, next_run_at ASC`；
//! 文章按 `generated_at DESC, id ASC`（评审队列最新在前）。

use geo_domain::{
    Article, ArticleDirection, ArticleFreq, ArticleSchedule, ArticleSlot, ArticleSource,
    ArticleStatus, ArticleTemplate, ArticleTemplateBindings, ProjectId,
};
use sqlx::{FromRow, SqlitePool};

use crate::codec;
use crate::error::StoreError;
use crate::repo::{not_found, require_found};

const SELECT_DIRECTIONS: &str = concat!(
    "SELECT id, project_id, title, summary, source, status, created_at ",
    "FROM article_directions WHERE project_id = ? ORDER BY created_at ASC, id ASC"
);
const SELECT_DIRECTION: &str = concat!(
    "SELECT id, project_id, title, summary, source, status, created_at ",
    "FROM article_directions WHERE id = ?"
);
const SELECT_TEMPLATES: &str = concat!(
    "SELECT id, project_id, direction_id, name, prompt_template, slots, bindings, kb_modules, ",
    "style, length, created_at, updated_at FROM article_templates WHERE project_id = ? ",
    "ORDER BY created_at ASC, id ASC"
);
const SELECT_TEMPLATE: &str = concat!(
    "SELECT id, project_id, direction_id, name, prompt_template, slots, bindings, kb_modules, ",
    "style, length, created_at, updated_at FROM article_templates WHERE id = ?"
);
const SELECT_SCHEDULES: &str = concat!(
    "SELECT id, project_id, template_id, freq, time, weekday, enabled, next_run_at, last_run_at, ",
    "run_count FROM article_schedules WHERE project_id = ? ",
    "ORDER BY enabled DESC, next_run_at ASC, id ASC"
);
const SELECT_SCHEDULE: &str = concat!(
    "SELECT id, project_id, template_id, freq, time, weekday, enabled, next_run_at, last_run_at, ",
    "run_count FROM article_schedules WHERE id = ?"
);
const SELECT_ARTICLES: &str = concat!(
    "SELECT id, project_id, direction_id, template_id, schedule_id, source, title, body_markdown, ",
    "status, word_count, generated_at FROM articles WHERE project_id = ? ",
    "ORDER BY generated_at DESC, id ASC"
);

#[derive(Debug, FromRow)]
struct DirectionRow {
    id: String,
    project_id: String,
    title: String,
    summary: String,
    source: String,
    status: String,
    created_at: String,
}

impl DirectionRow {
    fn into_direction(self) -> Result<ArticleDirection, StoreError> {
        Ok(ArticleDirection {
            id: self.id,
            project_id: self
                .project_id
                .parse()
                .map_err(|_| invalid_id("project_id"))?,
            title: self.title,
            summary: self.summary,
            source: codec::decode_scalar(&self.source)?,
            status: codec::decode_scalar(&self.status)?,
            created_at: codec::decode_time(&self.created_at)?,
        })
    }
}

#[derive(Debug, FromRow)]
struct TemplateRow {
    id: String,
    project_id: String,
    direction_id: String,
    name: String,
    prompt_template: String,
    slots: String,
    bindings: String,
    kb_modules: String,
    style: String,
    length: i32,
    created_at: String,
    updated_at: String,
}

impl TemplateRow {
    fn into_template(self) -> Result<ArticleTemplate, StoreError> {
        Ok(ArticleTemplate {
            id: self.id,
            project_id: self
                .project_id
                .parse()
                .map_err(|_| invalid_id("project_id"))?,
            direction_id: self.direction_id,
            name: self.name,
            prompt_template: self.prompt_template,
            slots: codec::decode_json::<Vec<ArticleSlot>>(&self.slots)?,
            bindings: codec::decode_json::<ArticleTemplateBindings>(&self.bindings)?,
            kb_modules: codec::decode_json(&self.kb_modules)?,
            style: self.style,
            length: self.length,
            created_at: codec::decode_time(&self.created_at)?,
            updated_at: codec::decode_time(&self.updated_at)?,
        })
    }
}

#[derive(Debug, FromRow)]
struct ScheduleRow {
    id: String,
    project_id: String,
    template_id: String,
    freq: String,
    time: String,
    weekday: Option<i32>,
    enabled: i64,
    next_run_at: Option<String>,
    last_run_at: Option<String>,
    run_count: i32,
}

impl ScheduleRow {
    fn into_schedule(self) -> Result<ArticleSchedule, StoreError> {
        Ok(ArticleSchedule {
            id: self.id,
            project_id: self
                .project_id
                .parse()
                .map_err(|_| invalid_id("project_id"))?,
            template_id: self.template_id,
            freq: codec::decode_scalar::<ArticleFreq>(&self.freq)?,
            time: self.time,
            weekday: self.weekday,
            enabled: self.enabled != 0,
            next_run_at: self
                .next_run_at
                .map(|value| codec::decode_time(&value))
                .transpose()?,
            last_run_at: self
                .last_run_at
                .map(|value| codec::decode_time(&value))
                .transpose()?,
            run_count: self.run_count,
        })
    }
}

#[derive(Debug, FromRow)]
struct ArticleRow {
    id: String,
    project_id: String,
    direction_id: String,
    template_id: String,
    schedule_id: Option<String>,
    source: String,
    title: String,
    body_markdown: String,
    status: String,
    word_count: i32,
    generated_at: String,
}

impl ArticleRow {
    fn into_article(self) -> Result<Article, StoreError> {
        Ok(Article {
            id: self.id,
            project_id: self
                .project_id
                .parse()
                .map_err(|_| invalid_id("project_id"))?,
            direction_id: self.direction_id,
            template_id: self.template_id,
            schedule_id: self.schedule_id,
            source: codec::decode_scalar::<ArticleSource>(&self.source)?,
            title: self.title,
            body_markdown: self.body_markdown,
            status: codec::decode_scalar::<ArticleStatus>(&self.status)?,
            word_count: self.word_count,
            generated_at: codec::decode_time(&self.generated_at)?,
        })
    }
}

fn invalid_id(field: &str) -> StoreError {
    StoreError::Serde(serde_json::Error::io(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        format!("invalid_{field}"),
    )))
}

#[derive(Debug, Clone)]
pub struct ArticleRepo {
    pool: SqlitePool,
}

impl ArticleRepo {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub async fn directions(
        &self,
        project_id: ProjectId,
    ) -> Result<Vec<ArticleDirection>, StoreError> {
        let rows = sqlx::query_as::<_, DirectionRow>(SELECT_DIRECTIONS)
            .bind(project_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(DirectionRow::into_direction).collect()
    }

    pub async fn direction(&self, id: &str) -> Result<ArticleDirection, StoreError> {
        let row = sqlx::query_as::<_, DirectionRow>(SELECT_DIRECTION)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| not_found("article_direction", id))?;
        row.into_direction()
    }

    pub async fn insert_direction(&self, direction: &ArticleDirection) -> Result<(), StoreError> {
        sqlx::query(concat!(
            "INSERT INTO article_directions (id, project_id, title, summary, source, status, ",
            "created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ))
        .bind(&direction.id)
        .bind(direction.project_id.to_string())
        .bind(&direction.title)
        .bind(&direction.summary)
        .bind(codec::encode_scalar(&direction.source)?)
        .bind(codec::encode_scalar(&direction.status)?)
        .bind(codec::encode_time(&direction.created_at))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// 只改标题 / 摘要 / 状态（来源与创建时间不随更新变）。
    pub async fn update_direction(&self, direction: &ArticleDirection) -> Result<(), StoreError> {
        let result = sqlx::query(
            "UPDATE article_directions SET title = ?, summary = ?, status = ? WHERE id = ?",
        )
        .bind(&direction.title)
        .bind(&direction.summary)
        .bind(codec::encode_scalar(&direction.status)?)
        .bind(&direction.id)
        .execute(&self.pool)
        .await?;
        require_found(result.rows_affected(), "article_direction", &direction.id)
    }

    pub async fn templates(
        &self,
        project_id: ProjectId,
    ) -> Result<Vec<ArticleTemplate>, StoreError> {
        let rows = sqlx::query_as::<_, TemplateRow>(SELECT_TEMPLATES)
            .bind(project_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(TemplateRow::into_template).collect()
    }

    pub async fn template(&self, id: &str) -> Result<ArticleTemplate, StoreError> {
        let row = sqlx::query_as::<_, TemplateRow>(SELECT_TEMPLATE)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| not_found("article_template", id))?;
        row.into_template()
    }

    pub async fn save_template(&self, template: &ArticleTemplate) -> Result<(), StoreError> {
        sqlx::query(concat!(
            "INSERT INTO article_templates (id, project_id, direction_id, name, prompt_template, ",
            "slots, bindings, kb_modules, style, length, created_at, updated_at) ",
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ",
            "ON CONFLICT(id) DO UPDATE SET direction_id = excluded.direction_id, ",
            "name = excluded.name, prompt_template = excluded.prompt_template, ",
            "slots = excluded.slots, bindings = excluded.bindings, ",
            "kb_modules = excluded.kb_modules, style = excluded.style, length = excluded.length, ",
            "updated_at = excluded.updated_at"
        ))
        .bind(&template.id)
        .bind(template.project_id.to_string())
        .bind(&template.direction_id)
        .bind(&template.name)
        .bind(&template.prompt_template)
        .bind(codec::encode_json(&template.slots)?)
        .bind(codec::encode_json(&template.bindings)?)
        .bind(codec::encode_json(&template.kb_modules)?)
        .bind(&template.style)
        .bind(template.length)
        .bind(codec::encode_time(&template.created_at))
        .bind(codec::encode_time(&template.updated_at))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// 批量删模板并连带删掉挂在这些模板上的排期；文章保留。返回剩余模板。
    pub async fn delete_templates(
        &self,
        project_id: ProjectId,
        ids: &[String],
    ) -> Result<Vec<ArticleTemplate>, StoreError> {
        let mut transaction = self.pool.begin().await?;
        for id in ids {
            sqlx::query("DELETE FROM article_schedules WHERE template_id = ? AND project_id = ?")
                .bind(id)
                .bind(project_id.to_string())
                .execute(&mut *transaction)
                .await?;
            sqlx::query("DELETE FROM article_templates WHERE id = ? AND project_id = ?")
                .bind(id)
                .bind(project_id.to_string())
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;
        self.templates(project_id).await
    }

    pub async fn schedules(
        &self,
        project_id: ProjectId,
    ) -> Result<Vec<ArticleSchedule>, StoreError> {
        let rows = sqlx::query_as::<_, ScheduleRow>(SELECT_SCHEDULES)
            .bind(project_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(ScheduleRow::into_schedule).collect()
    }

    pub async fn schedule(&self, id: &str) -> Result<ArticleSchedule, StoreError> {
        let row = sqlx::query_as::<_, ScheduleRow>(SELECT_SCHEDULE)
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or_else(|| not_found("article_schedule", id))?;
        row.into_schedule()
    }

    pub async fn save_schedule(&self, schedule: &ArticleSchedule) -> Result<(), StoreError> {
        sqlx::query(concat!(
            "INSERT INTO article_schedules (id, project_id, template_id, freq, time, weekday, ",
            "enabled, next_run_at, last_run_at, run_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ",
            "ON CONFLICT(id) DO UPDATE SET template_id = excluded.template_id, ",
            "freq = excluded.freq, time = excluded.time, weekday = excluded.weekday, ",
            "enabled = excluded.enabled, next_run_at = excluded.next_run_at, ",
            "last_run_at = excluded.last_run_at, run_count = excluded.run_count"
        ))
        .bind(&schedule.id)
        .bind(schedule.project_id.to_string())
        .bind(&schedule.template_id)
        .bind(codec::encode_scalar(&schedule.freq)?)
        .bind(&schedule.time)
        .bind(schedule.weekday)
        .bind(i64::from(schedule.enabled))
        .bind(schedule.next_run_at.as_ref().map(codec::encode_time))
        .bind(schedule.last_run_at.as_ref().map(codec::encode_time))
        .bind(schedule.run_count)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn articles(&self, project_id: ProjectId) -> Result<Vec<Article>, StoreError> {
        let rows = sqlx::query_as::<_, ArticleRow>(SELECT_ARTICLES)
            .bind(project_id.to_string())
            .fetch_all(&self.pool)
            .await?;
        rows.into_iter().map(ArticleRow::into_article).collect()
    }

    pub async fn insert_article(&self, article: &Article) -> Result<(), StoreError> {
        sqlx::query(concat!(
            "INSERT INTO articles (id, project_id, direction_id, template_id, schedule_id, source, ",
            "title, body_markdown, status, word_count, generated_at) ",
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ))
        .bind(&article.id)
        .bind(article.project_id.to_string())
        .bind(&article.direction_id)
        .bind(&article.template_id)
        .bind(&article.schedule_id)
        .bind(codec::encode_scalar(&article.source)?)
        .bind(&article.title)
        .bind(&article.body_markdown)
        .bind(codec::encode_scalar(&article.status)?)
        .bind(article.word_count)
        .bind(codec::encode_time(&article.generated_at))
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// 批量评审：只改本项目内的文章，返回受影响条数。
    pub async fn review_articles(
        &self,
        project_id: ProjectId,
        ids: &[String],
        status: ArticleStatus,
    ) -> Result<u64, StoreError> {
        let mut affected = 0;
        let mut transaction = self.pool.begin().await?;
        for id in ids {
            let result =
                sqlx::query("UPDATE articles SET status = ? WHERE id = ? AND project_id = ?")
                    .bind(codec::encode_scalar(&status)?)
                    .bind(id)
                    .bind(project_id.to_string())
                    .execute(&mut *transaction)
                    .await?;
            affected += result.rows_affected();
        }
        transaction.commit().await?;
        Ok(affected)
    }
}
