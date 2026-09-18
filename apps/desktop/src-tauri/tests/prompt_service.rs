//! M2 题库生成集成测试：离线跑出 ≥60 条、7 类意图、零重复对、版本化快照。
//!
//! 验收口径来自 spec FR-M2-1..FR-M2-6，全部在离线状态下验证
//! （`fixtures/llm/prompt_expand.json` + `prompt_rewrite.json` 回放）。

mod support;

use geo_domain::{
    compliance, dedupe, sample_size_grade, IntentCategory, PromptItem, PromptSource,
    SampleSizeGrade, DUPLICATE_THRESHOLD, METRIC_SPEC_VERSION, SUFFICIENT_SAMPLE_SIZE,
};
use geo_llm::LlmProvider;
use support::{
    now, offline_state, prompt_state, seeded_project, state_with_transport, test_state,
    KeyEchoingTransport, OfflineTransport, ScriptedTransport, TEST_API_KEY,
};

use geo_desktop_lib::services::templates::{industry_templates, PromptTemplate, GENERIC_TEMPLATES};
use geo_desktop_lib::services::{GenerateOptions, PromptDraft, PromptService};

fn service(state: &geo_desktop_lib::state::AppState) -> PromptService {
    PromptService::from_state(state)
}

/// 从 `notes` 里取出降级**机器行**的载荷（裁定 §H-1：`degraded ` + 紧凑 JSON）。
///
/// 前端契约（Task 8/9 实现）：按 `\n` 切行，`degraded ` 前缀的行 `JSON.parse` 后走词典，
/// 其余行原样渲染（兼容既有的中文散文行与老数据）。这里就是那份契约的可执行版本。
fn degraded_records(notes: &str) -> Vec<serde_json::Value> {
    notes
        .lines()
        .filter_map(|line| line.strip_prefix("degraded "))
        .map(|payload| serde_json::from_str(payload).expect("机器行必须是合法紧凑 JSON"))
        .collect()
}

/// 机器行必须纯 ASCII（notes 是落库数据，「这一行是数据不是文案」要在任何 locale 下成立）。
fn assert_degradation_lines_are_machine_lines(notes: &str) {
    for line in notes.lines() {
        if line.starts_with("degraded ") {
            assert!(line.is_ascii(), "降级行必须纯 ASCII：{line}");
            assert!(!line.contains('\n'));
        }
    }
}

#[tokio::test]
async fn generate_hits_the_p0a_acceptance_bar() {
    let (state, _server, _secrets) = prompt_state().await;
    let project = seeded_project(&state).await;

    let set = service(&state)
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .expect("生成题库成功");

    assert!(
        set.items.len() >= SUFFICIENT_SAMPLE_SIZE,
        "验收要求 ≥60 条，实际 {}",
        set.items.len()
    );
    assert!(
        set.items.len() <= GenerateOptions::default().target_count as usize,
        "不得超过目标条数 {}",
        set.items.len()
    );
    assert_eq!(set.intent_coverage().len(), 7, "必须覆盖 7 类意图");
    assert_eq!(set.sample_size_grade, SampleSizeGrade::Sufficient);
    assert!(!set.content_hash.is_empty());
    assert_eq!(set.metric_spec_version, METRIC_SPEC_VERSION);
    assert_eq!(set.version, 1);
    assert_eq!(set.project_id, project.id);

    let report = dedupe(set.items.clone());
    assert_eq!(report.duplicate_pairs, 0, "去重后不得仍有近义条目对");
    assert_eq!(report.removed_count(), 0, "落库前就应已去重");

    for item in &set.items {
        item.validate()
            .unwrap_or_else(|err| panic!("条目非法：{err}"));
        assert_eq!(item.set_id, set.id);
        assert!(
            compliance::is_clean(&item.text),
            "命中绝对化用语：{}",
            item.text
        );
        assert!(item.weight >= 1 && item.weight <= 5);
        assert_eq!(item.group_name.as_deref(), Some(item.intent.label_zh()));
    }
    // position 连续且唯一，前端表格与 CSV 导出都依赖它
    let positions: Vec<i32> = set.items.iter().map(|item| item.position).collect();
    assert_eq!(positions, (0..positions.len() as i32).collect::<Vec<_>>());
}

#[tokio::test]
async fn generated_set_is_persisted_and_listed_as_a_version() {
    let (state, _server, _secrets) = prompt_state().await;
    let project = seeded_project(&state).await;
    let svc = service(&state);

    let first = svc
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();
    let stored = svc.get(first.id).await.expect("快照可读");
    assert_eq!(stored.items.len(), first.items.len());
    assert_eq!(stored.content_hash, first.content_hash);

    let summaries = svc.list(project.id).await.unwrap();
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].item_count, first.items.len());
    assert_eq!(summaries[0].id, first.id);

    let second = svc
        .generate(
            project.id,
            GenerateOptions::default(),
            now() + chrono::Duration::days(1),
        )
        .await
        .unwrap();
    assert_eq!(second.version, 2, "二次生成必须是新版本，可环比");
    assert_eq!(second.metric_spec_version, first.metric_spec_version);
    assert_ne!(second.id, first.id);
    assert_eq!(svc.list(project.id).await.unwrap().len(), 2);
    assert_eq!(svc.list(project.id).await.unwrap()[0].version, 2);
}

#[tokio::test]
async fn offline_generation_still_reaches_sixty_and_records_the_degradation() {
    let (state, _server, _secrets) = offline_state().await;
    let project = seeded_project(&state).await;

    let set = service(&state)
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .expect("离线也必须能出题");

    assert!(
        set.items.len() >= SUFFICIENT_SAMPLE_SIZE,
        "降级路径同样要 ≥60 条，实际 {}",
        set.items.len()
    );
    assert_eq!(set.intent_coverage().len(), 7);
    assert_eq!(dedupe(set.items.clone()).duplicate_pairs, 0);
    let notes = set.notes.clone().expect("降级必须写进 notes");
    assert_degradation_lines_are_machine_lines(&notes);
    // `offline_state()` 预置了 Key，但 transport 每次都失败（`TransportError::Other`），
    // 所以扩写与口语化改写两步各降级一行机器行，`code` 是 `llm/transport`。
    // 「没配 Key」那条走 `state_without_secret()`，由
    // `generation_without_an_api_key_degrades_instead_of_failing` 钉 `llm/missing_secret`。
    let records = degraded_records(&notes);
    assert_eq!(records.len(), 2, "两步各一行机器行：{notes}");
    let stages: Vec<&str> = records
        .iter()
        .map(|record| record["stage"].as_str().expect("stage"))
        .collect();
    assert_eq!(stages, ["expansion", "rewrite"], "{stages:?}");
    for record in &records {
        assert_eq!(record["code"], "llm/transport", "{record}");
        assert_eq!(
            record["params"],
            serde_json::json!({ "reason": "other" }),
            "{record}"
        );
    }
    // 文案（「本轮题目改由行业模板与本地口语化改写补足」）不再进数据行，
    // 由 Task 8/9 的词典模板给；老散文行（配额/合规）照旧保留（裁定 §H-2）。
    assert!(
        !notes.contains("已降级"),
        "降级说明不得再是中文散文：{notes}"
    );
    assert!(
        set.items
            .iter()
            .all(|item| item.source != PromptSource::Generated),
        "没有模型参与就不该出现 generated 来源"
    );
    assert!(
        set.items
            .iter()
            .any(|item| item.source == PromptSource::Rewritten),
        "本地口语化改写仍应生效"
    );
}

/// 降级原因会落进 `prompt_sets.notes` 并在 UI 展示，因此上游回显的 Key
/// 必须在这里就被抹掉（AGENTS 规则 3：日志与错误信息不得出现 Key）。
#[tokio::test]
async fn degradation_notes_redact_a_key_echoed_by_the_gateway() {
    let (state, _server, _secrets) = state_with_transport(KeyEchoingTransport::new()).await;
    let project = seeded_project(&state).await;

    let set = PromptService::from_state(&state)
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .expect("上游失败时降级为纯模板");

    let notes = set.notes.clone().expect("降级要写原因");
    assert_degradation_lines_are_machine_lines(&notes);
    assert!(!notes.contains(TEST_API_KEY), "notes 泄漏了 Key：{notes}");

    // 裁定 §H-1：机器行的 `code` + `params` 直接取自错误本身，不再把
    // `user_message()` 的紧凑串拼进文案。Task 4 之后 `llm/transport` 只发
    // `reason=other`，上游回显的原文根本不进 params（泄漏面被结构性关闭），
    // `redact` 仍在 `degradation_note` 里逐值兜着（裁定 §H-3）。
    let records = degraded_records(&notes);
    assert!(!records.is_empty(), "至少要有一行降级机器行：{notes}");
    for record in &records {
        assert_eq!(record["code"], "llm/transport", "{record}");
        assert_eq!(
            record["params"],
            serde_json::json!({ "reason": "other" }),
            "{record}"
        );
    }
}

#[tokio::test]
async fn generation_without_an_api_key_degrades_instead_of_failing() {
    let (state, _server, _secrets) =
        test_state(ScriptedTransport::new(support::llm_bodies("prompt_expand"))).await;
    let project = seeded_project(&state).await;

    let set = service(&state)
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .expect("没配 Key 也要出题");
    assert!(set.items.len() >= SUFFICIENT_SAMPLE_SIZE);
    let notes = set.notes.unwrap_or_default();
    assert_degradation_lines_are_machine_lines(&notes);
    // 「未配置 API Key」是文案，改由词典按 `llm/missing_secret` 渲染；数据行只发记号
    assert!(
        degraded_records(&notes)
            .iter()
            .all(|record| record["code"] == "llm/missing_secret"),
        "降级原因应是稳定记号：{notes}"
    );
    assert!(!notes.contains("未配置 API Key"), "{notes}");
}

#[tokio::test]
async fn every_competitor_gets_enough_co_mention_prompts() {
    let (state, _server, _secrets) = prompt_state().await;
    let project = seeded_project(&state).await;
    let svc = service(&state);

    let set = svc
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();
    let competitors = geo_desktop_lib::services::ProjectService::new(state.pool.clone())
        .list_competitors(project.id)
        .await
        .unwrap();
    assert_eq!(competitors.len(), 3);

    // spec FR-M2-1 第 4 步：每竞品 ≥ ceil(target × 0.2 / 竞品数) 条同框 prompt
    let quota = ((GenerateOptions::default().target_count as f64 * 0.2) / competitors.len() as f64)
        .ceil() as usize;
    for competitor in &competitors {
        let count = set
            .items
            .iter()
            .filter(|item| item.competitor_ids.contains(&competitor.id))
            .count();
        assert!(
            count >= quota,
            "竞品 {} 的同框 prompt 只有 {count} 条，低于配额 {quota}",
            competitor.name
        );
        let named = set
            .items
            .iter()
            .filter(|item| item.competitor_ids.contains(&competitor.id))
            .filter(|item| item.text.contains(&competitor.name))
            .count();
        assert_eq!(
            named, count,
            "标记了竞品的条目必须在文本里真的点到它，否则 SOV 会算错"
        );
    }
}

#[tokio::test]
async fn intent_selection_narrows_the_set_and_reports_the_shortfall() {
    let (state, _server, _secrets) = offline_state().await;
    let project = seeded_project(&state).await;
    let options = GenerateOptions {
        intents: Some(vec![
            IntentCategory::BrandComparison,
            IntentCategory::PricingPlan,
        ]),
        ..Default::default()
    };

    let set = service(&state)
        .generate(project.id, options, now())
        .await
        .unwrap();

    assert_eq!(set.intent_coverage().len(), 2);
    assert!(set.items.iter().all(|item| matches!(
        item.intent,
        IntentCategory::BrandComparison | IntentCategory::PricingPlan
    )));
    // 只选 2 类意图必然不足 60 条：必须给补齐建议，不能静默通过
    assert!(set.items.len() < SUFFICIENT_SAMPLE_SIZE);
    assert_eq!(set.sample_size_grade, sample_size_grade(set.items.len()));
    let notes = set.notes.expect("不足时要写建议");
    assert!(notes.contains("样本不足"), "{notes}");
    assert!(notes.contains("缺少"), "{notes}");
}

#[tokio::test]
async fn options_are_validated_before_anything_is_written() {
    let (state, _server, _secrets) = offline_state().await;
    let project = seeded_project(&state).await;
    let svc = service(&state);

    for options in [
        GenerateOptions {
            target_count: 5,
            ..Default::default()
        },
        GenerateOptions {
            target_count: 500,
            ..Default::default()
        },
        GenerateOptions {
            repeat_count: 9,
            ..Default::default()
        },
        GenerateOptions {
            intents: Some(vec![]),
            ..Default::default()
        },
    ] {
        let error = svc
            .generate(project.id, options, now())
            .await
            .expect_err("非法参数必须被拒绝");
        assert_eq!(error.code, "validation/failed");
    }
    assert!(svc.list(project.id).await.unwrap().is_empty());
}

#[tokio::test]
async fn repeat_count_is_applied_to_every_item() {
    let (state, _server, _secrets) = offline_state().await;
    let project = seeded_project(&state).await;

    let set = service(&state)
        .generate(
            project.id,
            GenerateOptions {
                repeat_count: 3,
                ..Default::default()
            },
            now(),
        )
        .await
        .unwrap();

    assert!(!set.items.is_empty());
    assert!(set.items.iter().all(|item| item.repeat_count == 3));
}

#[tokio::test]
async fn model_expansion_is_attributed_and_uses_the_configured_provider() {
    let transport = ScriptedTransport::new(support::llm_bodies("prompt_expand"));
    let (state, _server, _secrets) = state_with_transport(transport.clone()).await;
    let project = seeded_project(&state).await;

    let set = service(&state)
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();

    assert!(transport.request_count() >= 1);
    let body: serde_json::Value =
        serde_json::from_str(&transport.requests()[0].body).expect("请求体是 JSON");
    assert_eq!(body["model"], LlmProvider::DeepSeek.default_model());
    let generated = set
        .items
        .iter()
        .filter(|item| item.source == PromptSource::Generated)
        .count();
    assert!(generated > 0, "模型扩写的条目要能追溯到来源");
    assert!(generated <= 31, "夹具只有 31 条扩写结果");
}

#[tokio::test]
async fn csv_round_trip_preserves_items() {
    let (state, _server, _secrets) = offline_state().await;
    let project = seeded_project(&state).await;
    let svc = service(&state);
    let set = svc
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();

    let csv = svc.export_csv(set.id).await.unwrap();
    assert!(csv.starts_with("text,intent,weight,group_name,tags,source,repeat_count"));
    assert_eq!(csv.trim().lines().count(), set.items.len() + 1);

    let result = svc.import_csv(set.id, &csv, now()).await.unwrap();
    assert!(result.errors.is_empty(), "{:?}", result.errors);
    assert_eq!(result.imported_count(), set.items.len());

    let reloaded = svc.get(set.id).await.unwrap();
    assert_eq!(reloaded.items.len(), set.items.len());
    assert_eq!(
        texts(&reloaded.items),
        texts(&set.items),
        "导入后文本与顺序都应一致"
    );
    assert_eq!(
        reloaded.content_hash, set.content_hash,
        "内容没变则哈希不变"
    );
}

#[tokio::test]
async fn csv_import_reports_bad_rows_and_keeps_the_good_ones() {
    let (state, _server, _secrets) = offline_state().await;
    let project = seeded_project(&state).await;
    let svc = service(&state);
    let set = svc
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();

    let payload = "text,intent,weight,group_name,tags,source,repeat_count\n\
                   宏宇泵业的水泵多少钱一台,pricing_plan,3,价格方案,,manual,1\n\
                   意图写错的一条,not_an_intent,3,品类认知,,manual,1\n\
                   ,category_awareness,3,品类认知,,manual,1\n";
    let result = svc.import_csv(set.id, payload, now()).await.unwrap();

    assert_eq!(result.imported_count(), 1);
    assert_eq!(result.error_count(), 2);
    assert_eq!(result.errors[0].row, 3);
    // `CsvRowError` 已升级为 `{row, reason:<目录 key>, params}`（裁定 R-B / R-D）
    assert_eq!(result.errors[0].reason, "invalid_format");
    assert_eq!(result.errors[0].params["value"], "not_an_intent");
    assert_eq!(result.errors[1].row, 4);
    assert_eq!(result.errors[1].reason, "required");
    assert!(result.errors[1].params.is_empty(), "{:?}", result.errors[1]);

    let reloaded = svc.get(set.id).await.unwrap();
    assert_eq!(reloaded.items.len(), 1, "部分成功：只落库合法行");
    assert_ne!(reloaded.content_hash, set.content_hash);
}

/// 只有表头的 CSV 会解析出 0 条，而 `import_csv` 是「整包替换」语义——
/// 一次误粘贴就能把 60+ 条题库清空，还弹「导入 0 条，失败 0 行」的成功提示。
#[tokio::test]
async fn csv_import_with_only_a_header_refuses_to_wipe_the_set() {
    let (state, _server, _secrets) = offline_state().await;
    let project = seeded_project(&state).await;
    let svc = service(&state);
    let set = svc
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();
    assert!(set.items.len() >= 60);

    let error = svc
        .import_csv(
            set.id,
            "text,intent,weight,group_name,tags,source,repeat_count\n",
            now(),
        )
        .await
        .expect_err("只有表头的导入必须被拒绝");
    assert_eq!(error.code, "prompt_set/empty_import");
    // 契约给该 code 登记的 params 是 `[]`：逐行错误明细走 `detail`，不进 params。
    // `message` 只留英文兜底短句（裁定 R-J），中文文案由词典渲染。
    assert!(error.params.is_empty(), "{:?}", error.params);
    assert!(error.message.is_ascii(), "{}", error.message);
    let detail = error.detail.expect("逐行明细走 detail");
    assert_eq!(detail.as_array().expect("数组").len(), 0);

    let reloaded = svc.get(set.id).await.unwrap();
    assert_eq!(reloaded.items.len(), set.items.len(), "原题库必须原样保留");
    assert_eq!(reloaded.content_hash, set.content_hash);
}

#[tokio::test]
async fn csv_import_rejects_a_payload_without_the_expected_header() {
    let (state, _server, _secrets) = offline_state().await;
    let project = seeded_project(&state).await;
    let svc = service(&state);
    let set = svc
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();

    let error = svc
        .import_csv(
            set.id,
            "text,intent\n宏宇泵业靠谱吗,purchase_recommendation",
            now(),
        )
        .await
        .expect_err("表头不符必须整批拒绝");
    assert_eq!(error.code, "validation/failed");
    assert_eq!(svc.get(set.id).await.unwrap().items.len(), set.items.len());
}

#[tokio::test]
async fn updating_an_item_recomputes_the_content_hash() {
    let (state, _server, _secrets) = offline_state().await;
    let project = seeded_project(&state).await;
    let svc = service(&state);
    let set = svc
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();

    let mut item = set.items[0].clone();
    // 换个一定不同的权重：首条本来就可能是 5 分（竞品同框 + 命中核心参数）
    item.weight = if item.weight == 5 { 1 } else { item.weight + 1 };
    let expected_weight = item.weight;
    let updated = svc.update_item(item.clone()).await.unwrap();
    assert_eq!(updated.weight, expected_weight);

    let reloaded = svc.get(set.id).await.unwrap();
    assert_ne!(reloaded.content_hash, set.content_hash, "权重参与内容指纹");
    assert_eq!(reloaded.items.len(), set.items.len());
    assert_eq!(reloaded.items[0].weight, expected_weight);

    let invalid = PromptItem {
        weight: 9,
        ..set.items[1].clone()
    };
    let error = svc.update_item(invalid).await.expect_err("权重越界要拒绝");
    assert_eq!(error.code, "validation/failed");
}

#[tokio::test]
async fn bulk_update_applies_weights_and_tags_at_once() {
    let (state, _server, _secrets) = offline_state().await;
    let project = seeded_project(&state).await;
    let svc = service(&state);
    let set = svc
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();

    let mut edits = set.items[..3].to_vec();
    for item in &mut edits {
        item.weight = 4;
        item.tags = vec!["核心词".to_string()];
    }
    let updated = svc.update_items_bulk(edits).await.unwrap();
    assert_eq!(updated.items.len(), set.items.len());
    assert!(updated.items[..3].iter().all(|item| item.weight == 4));
    assert!(updated.items[..3]
        .iter()
        .all(|item| item.tags == vec!["核心词".to_string()]));
    assert_ne!(updated.content_hash, set.content_hash);
}

#[tokio::test]
async fn dedupe_command_merges_near_duplicates_and_reports_them() {
    let (state, _server, _secrets) = offline_state().await;
    let project = seeded_project(&state).await;
    let svc = service(&state);
    let set = svc
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();

    // 通过 CSV 导入制造一条与现有条目几乎相同的 prompt
    let mut csv = svc.export_csv(set.id).await.unwrap();
    let victim = set.items[0].text.clone();
    csv.push_str(&format!(
        "{},category_awareness,1,品类认知,,manual,1\n",
        victim.replace('？', "?")
    ));
    let imported = svc.import_csv(set.id, &csv, now()).await.unwrap();
    assert_eq!(imported.imported_count(), set.items.len() + 1);

    let report = svc.dedupe_set(set.id, now()).await.unwrap();
    assert!(report.removed_count() >= 1, "近义条目应被合并");
    assert_eq!(report.duplicate_pairs, 0);
    let after = svc.get(set.id).await.unwrap();
    assert_eq!(after.items.len(), report.kept_count());
    assert_eq!(
        dedupe(after.items.clone()).duplicate_pairs,
        0,
        "去重后阈值 {DUPLICATE_THRESHOLD} 内不得再有重复对"
    );
}

#[tokio::test]
async fn dedupe_set_report_matches_what_is_actually_stored() {
    let (state, _server, _secrets) = prompt_state().await;
    let project = seeded_project(&state).await;
    let svc = service(&state);
    let set = svc
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();
    let competitors = geo_desktop_lib::services::ProjectService::new(state.pool.clone())
        .list_competitors(project.id)
        .await
        .unwrap();

    // 人工编辑/导入的常见遗留：文本只点名首个竞品，competitor_ids 里却多挂了一个
    let victim = set
        .items
        .iter()
        .find(|item| item.text.contains(&competitors[0].name))
        .expect("生成结果里应有点名首个竞品的条目")
        .clone();
    let mut stale = victim.clone();
    stale.competitor_ids.push(competitors[1].id);
    svc.update_items_bulk(vec![stale]).await.unwrap();

    let report = svc.dedupe_set(set.id, now()).await.unwrap();
    let stored = svc.get(set.id).await.unwrap();

    assert_eq!(
        report.kept, stored.items,
        "去重报告必须与实际落库结果一致，否则前端按报告展示会带出没点名的竞品 ID"
    );
    assert!(
        !report
            .kept
            .iter()
            .any(|item| item.id == victim.id && item.competitor_ids.contains(&competitors[1].id)),
        "报告里不得残留未点名的竞品 ID"
    );
}

fn draft(text: &str) -> PromptDraft {
    PromptDraft {
        text: text.to_string(),
        intent: IntentCategory::ProfessionalLongTail,
        weight: 4,
        group_name: None,
        repeat_count: 2,
        tags: vec!["核心词".to_string()],
    }
}

#[tokio::test]
async fn add_items_appends_manual_prompts_and_refreshes_the_snapshot() {
    let (state, _server, _secrets) = prompt_state().await;
    let project = seeded_project(&state).await;
    let svc = service(&state);
    let set = svc
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();

    let updated = svc
        .add_items(
            set.id,
            vec![draft("宏宇泵业的潜水排污泵适合化粪池改造吗")],
            now(),
        )
        .await
        .unwrap();

    assert_eq!(updated.items.len(), set.items.len() + 1);
    let added = updated.items.last().expect("新条目应追加在末尾");
    assert_eq!(
        added.source,
        PromptSource::Manual,
        "人工新增必须标成 manual"
    );
    assert_eq!(added.weight, 4);
    assert_eq!(added.repeat_count, 2);
    assert_eq!(added.tags, vec!["核心词".to_string()], "人工标签要原样保留");
    assert_eq!(
        added.group_name.as_deref(),
        Some(added.intent.label_zh()),
        "没填分组时按意图归组，与生成管线一致"
    );
    assert_eq!(added.set_id, set.id);
    let positions: Vec<i32> = updated.items.iter().map(|item| item.position).collect();
    assert_eq!(positions, (0..positions.len() as i32).collect::<Vec<_>>());
    assert_ne!(updated.content_hash, set.content_hash, "条目变了哈希必须变");

    let stored = svc.get(set.id).await.unwrap();
    assert_eq!(stored.items, updated.items, "新增必须落库");
    assert_eq!(stored.content_hash, updated.content_hash);
}

#[tokio::test]
async fn add_items_rejects_adlaw_violations_without_touching_the_set() {
    let (state, _server, _secrets) = prompt_state().await;
    let project = seeded_project(&state).await;
    let svc = service(&state);
    let set = svc
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();

    let error = svc
        .add_items(set.id, vec![draft("全网销量第一的水泵，保证排名")], now())
        .await
        .expect_err("命中红线词的新增必须被拒");

    assert_eq!(error.code, "compliance/violation");
    // 契约给该 code 登记的键只有 `terms`，装命中的红线词（**数据**，不是文案）。
    // 词典文案不得复述红线词本身（AGENTS 规则 6 / 裁定 §J：渲不渲染是词典的决定）。
    assert_eq!(error.params.len(), 1, "{:?}", error.params);
    let terms = &error.params["terms"];
    assert!(terms.contains("保证排名"), "terms 应是命中词本身：{terms}");
    let stored = svc.get(set.id).await.unwrap();
    assert_eq!(
        stored.items.len(),
        set.items.len(),
        "被拒后不得留下半截数据"
    );
    assert_eq!(stored.content_hash, set.content_hash);
}

#[tokio::test]
async fn delete_items_removes_the_selection_and_reindexes() {
    let (state, _server, _secrets) = prompt_state().await;
    let project = seeded_project(&state).await;
    let svc = service(&state);
    let set = svc
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();
    let victims = vec![set.items[0].id, set.items[3].id];

    let updated = svc.delete_items(set.id, &victims, now()).await.unwrap();

    assert_eq!(updated.items.len(), set.items.len() - 2);
    assert!(
        !updated.items.iter().any(|item| victims.contains(&item.id)),
        "选中的条目必须消失"
    );
    let positions: Vec<i32> = updated.items.iter().map(|item| item.position).collect();
    assert_eq!(positions, (0..positions.len() as i32).collect::<Vec<_>>());
    assert_ne!(updated.content_hash, set.content_hash);

    let stored = svc.get(set.id).await.unwrap();
    assert_eq!(stored.items, updated.items, "删除必须落库");
}

#[tokio::test]
async fn delete_items_rejects_unknown_ids_and_refuses_to_empty_the_set() {
    let (state, _server, _secrets) = prompt_state().await;
    let project = seeded_project(&state).await;
    let svc = service(&state);
    let set = svc
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();

    let unknown = svc
        .delete_items(set.id, &[geo_domain::PromptId::new()], now())
        .await
        .expect_err("不存在的条目要报 not_found");
    assert_eq!(unknown.code, "prompt_item/not_found");

    let everything: Vec<geo_domain::PromptId> = set.items.iter().map(|item| item.id).collect();
    let emptied = svc
        .delete_items(set.id, &everything, now())
        .await
        .expect_err("删光条目应当被拒");
    assert_eq!(emptied.code, "validation/failed");
    // 「不许删空」表达成数量区间：一次最多删 `条目总数 - 1` 条。
    // 「要清空请删除整个题库快照」是**建议**，属文案，由词典模板给（AGENTS 规则 7）。
    assert_eq!(emptied.params["field"], "ids");
    assert_eq!(emptied.params["reason"], "out_of_range");
    assert_eq!(
        emptied.params["expected"],
        format!("<{}", set.items.len()),
        "{:?}",
        emptied.params
    );
    assert_eq!(emptied.params["value"], set.items.len().to_string());

    let stored = svc.get(set.id).await.unwrap();
    assert_eq!(
        stored.items.len(),
        set.items.len(),
        "两次拒绝都不得改动数据"
    );
}

/// 编辑路径的 `(field, reason)` 组合（裁定 R-H 第二档：存量没覆盖的每个组合补一条）。
/// 纯函数那批（`GenerateOptions::validate`）由 `prompt_service.rs` 的表驱动用例覆盖。
#[tokio::test]
async fn edits_reject_blank_labels_empty_batches_and_foreign_items() {
    let (state, _server, _secrets) = offline_state().await;
    let project = seeded_project(&state).await;
    let svc = service(&state);
    let set = svc
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();

    let label = svc.rename(set.id, "   ").await.expect_err("空名称必须拒绝");
    assert_eq!(label.code, "validation/failed");
    assert_eq!(label.params["field"], "label");
    assert_eq!(label.params["reason"], "required");
    assert_eq!(label.params.len(), 2, "{:?}", label.params);

    // 空批次：集合整体为空 → `empty`（不是表单字段缺失的 `required`，目录语义规则 1）
    let bulk = svc
        .update_items_bulk(Vec::new())
        .await
        .expect_err("空批次必须拒绝");
    assert_eq!(bulk.params["field"], "items");
    assert_eq!(bulk.params["reason"], "empty");
    assert_eq!(bulk.params.len(), 2, "{:?}", bulk.params);

    let added = svc
        .add_items(set.id, Vec::new(), now())
        .await
        .expect_err("空新增必须拒绝");
    assert_eq!(added.params["field"], "items");
    assert_eq!(added.params["reason"], "empty");

    let deleted = svc
        .delete_items(set.id, &[], now())
        .await
        .expect_err("空删除必须拒绝");
    assert_eq!(deleted.params["field"], "ids");
    assert_eq!(deleted.params["reason"], "empty");

    // 跨快照搬条目：`update_items_bulk` 以第一条的 `set_id` 为目标，
    // 后面混进别的快照的条目就发 `not_allowed` + `value`=那个外来快照的 id。
    let foreign_set = svc
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();
    assert_ne!(foreign_set.id, set.id);
    let error = svc
        .update_items_bulk(vec![set.items[0].clone(), foreign_set.items[0].clone()])
        .await
        .expect_err("跨快照必须拒绝");
    assert_eq!(error.code, "validation/failed");
    assert_eq!(error.params["field"], "set_id");
    assert_eq!(error.params["reason"], "not_allowed");
    assert_eq!(error.params["value"], foreign_set.id.to_string());

    // 被拒后不得留下半截数据
    let stored = svc.get(set.id).await.unwrap();
    assert_eq!(stored.items, set.items);
    assert_eq!(stored.content_hash, set.content_hash);
}

#[tokio::test]
async fn rename_keeps_the_hash_and_delete_removes_the_snapshot() {
    let (state, _server, _secrets) = offline_state().await;
    let project = seeded_project(&state).await;
    let svc = service(&state);
    let set = svc
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();

    let summary = svc.rename(set.id, "9 月复测用").await.unwrap();
    assert_eq!(summary.label, "9 月复测用");
    assert_eq!(summary.content_hash, set.content_hash, "改名不动内容指纹");

    svc.delete(set.id).await.unwrap();
    let error = svc.get(set.id).await.expect_err("已删除");
    assert_eq!(error.code, "prompt_set/not_found");
}

#[tokio::test]
async fn commands_on_a_missing_set_report_not_found() {
    let (state, _server, _secrets) = offline_state().await;
    let svc = service(&state);
    let missing = geo_domain::PromptSetId::new();

    assert_eq!(
        svc.get(missing).await.expect_err("不存在").code,
        "prompt_set/not_found"
    );
    assert_eq!(
        svc.export_csv(missing).await.expect_err("不存在").code,
        "prompt_set/not_found"
    );
}

#[tokio::test]
async fn generation_on_a_missing_project_reports_not_found() {
    let (state, _server, _secrets) = offline_state().await;
    let error = service(&state)
        .generate(
            geo_domain::ProjectId::new(),
            GenerateOptions::default(),
            now(),
        )
        .await
        .expect_err("项目不存在");
    assert_eq!(error.code, "project/not_found");
}

// ---------------------------------------------------------------------------
// 模板层（纯数据 + 纯函数，离线可测）
// ---------------------------------------------------------------------------

#[test]
fn every_industry_covers_the_seven_intents_with_at_least_four_templates() {
    for industry in geo_domain::Industry::all() {
        let templates = industry_templates(industry);
        assert!(
            !templates.is_empty() || industry == geo_domain::Industry::Other,
            "{industry:?} 缺少行业模板"
        );
        for intent in IntentCategory::all() {
            let count = templates
                .iter()
                .filter(|template| template.intent == intent)
                .count();
            if industry == geo_domain::Industry::Other {
                continue; // 其他行业回落通用模板
            }
            assert!(
                count >= 4,
                "{industry:?}/{intent:?} 只有 {count} 条模板，spec 要求 ≥4"
            );
        }
    }
    for intent in IntentCategory::all() {
        let count = GENERIC_TEMPLATES
            .iter()
            .filter(|template| template.intent == intent)
            .count();
        assert!(count >= 4, "通用模板 {intent:?} 只有 {count} 条");
    }
}

#[test]
fn templates_are_compliant_and_use_known_placeholders() {
    let all: Vec<&PromptTemplate> = geo_domain::Industry::all()
        .iter()
        .flat_map(|industry| industry_templates(*industry).iter())
        .chain(GENERIC_TEMPLATES.iter())
        .collect();
    assert!(all.len() >= 100, "模板总量应 ≥100，实际 {}", all.len());
    for template in &all {
        assert!(
            compliance::is_clean(template.text),
            "模板命中绝对化用语：{}",
            template.text
        );
        for placeholder in placeholders(template.text) {
            assert!(
                geo_desktop_lib::services::templates::KNOWN_PLACEHOLDERS
                    .contains(&placeholder.as_str()),
                "未知占位符 {{{placeholder}}}：{}",
                template.text
            );
        }
    }
}

#[tokio::test]
async fn generation_never_calls_the_network_when_the_model_is_down() {
    // OfflineTransport 永远失败：管线必须靠模板与本地改写补足样本量
    let transport = OfflineTransport::new();
    let (state, _server, _secrets) = state_with_transport(transport.clone()).await;
    let project = seeded_project(&state).await;

    let set = service(&state)
        .generate(project.id, GenerateOptions::default(), now())
        .await
        .unwrap();

    assert!(transport.call_count() >= 1, "确实尝试过调用模型");
    assert!(set.items.len() >= SUFFICIENT_SAMPLE_SIZE);
}

fn texts(items: &[PromptItem]) -> Vec<String> {
    items.iter().map(|item| item.text.clone()).collect()
}

/// 抽出模板里的 `{占位符}` 名字。
fn placeholders(text: &str) -> Vec<String> {
    let mut found = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find('{') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('}') else { break };
        found.push(after[..end].to_string());
        rest = &after[end + 1..];
    }
    found
}
