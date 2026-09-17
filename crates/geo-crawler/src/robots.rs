//! robots.txt 解析与判定。
//!
//! 实现 RFC 9309 的常用子集：
//!
//! - 分组：UA 专属组优先于 `*` 组；同一组可列多个 `User-agent`。
//! - 规则：`Allow` / `Disallow` 走最长前缀匹配，等长时 `Allow` 优先；空规则集表示全放行。
//! - 忽略 `Sitemap` / `Crawl-delay` / `Host` 等非规则指令与 `#` 注释。
//!
//! 不实现路径通配（`*` 与结尾 `$`）：企业站极少使用，非 HTML 资源另由 MIME 白名单挡掉。
//! 抓取失败或 robots.txt 缺失时，调用方应退回 [`RobotsRules::allow_all`]，
//! 但整站抓取仍受 `FetchLimits` 约束。

/// 与当前抓取器相关的 robots 规则（已按 UA 归并，不含分组信息）。
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RobotsRules {
    /// 禁止抓取的路径前缀。
    pub disallow: Vec<String>,
    /// 明确放行的路径前缀；与 `disallow` 等长时优先。
    pub allow: Vec<String>,
}

/// 解析过程中的一个分组：若干 UA + 该组的规则。
#[derive(Debug, Default)]
struct Group {
    /// 已小写化的 UA 声明；空列表按 `*` 处理（宁可少抓，不可越权抓）。
    agents: Vec<String>,
    rules: RobotsRules,
    /// 该组是否已经出现过规则行：用于判断后续 `User-agent` 是否开启新组。
    has_rule: bool,
}

impl RobotsRules {
    /// 全放行规则（robots.txt 缺失、不可读或解析失败时的保守默认）。
    pub fn allow_all() -> Self {
        Self::default()
    }

    /// 解析 robots.txt 文本，取出对 `user_agent` 生效的那一组规则。
    ///
    /// `user_agent` 传抓取器完整的 UA 串（如 `GdkBot/0.1 (+https://...)`），
    /// 匹配时只取 `/` 或空白之前的产品名，大小写不敏感，并按 RFC 9309 做前缀匹配。
    pub fn parse(text: &str, user_agent: &str) -> Self {
        let mut groups: Vec<Group> = vec![Group::default()];
        for raw_line in text.lines() {
            let line = strip_comment(raw_line);
            if line.is_empty() {
                continue;
            }
            let Some((directive, value)) = line.split_once(':') else {
                continue;
            };
            let directive = directive.trim().to_ascii_lowercase();
            let value = value.trim();
            match directive.as_str() {
                "user-agent" => {
                    let current = groups.last_mut().expect("分组列表至少有一项");
                    if current.has_rule {
                        // 上一组已写过规则，本行开启新组。
                        groups.push(Group::default());
                    }
                    groups
                        .last_mut()
                        .expect("刚 push 的分组必然存在")
                        .agents
                        .push(value.to_ascii_lowercase());
                }
                "disallow" | "allow" => {
                    let current = groups.last_mut().expect("分组列表至少有一项");
                    // 空值（`Disallow:`）表示「本组无禁止项」，同样算作已声明规则，
                    // 否则后面的 `User-agent` 会被并进本组，导致 `*` 组的规则越权生效。
                    current.has_rule = true;
                    if value.is_empty() {
                        continue;
                    }
                    if directive == "disallow" {
                        current.rules.disallow.push(value.to_string());
                    } else {
                        current.rules.allow.push(value.to_string());
                    }
                }
                // `sitemap` / `crawl-delay` / `host` / 未知指令一律忽略。
                _ => {}
            }
        }

        let mut specific = Self::default();
        let mut specific_seen = false;
        let mut wildcard = Self::default();
        for group in groups {
            let matches_specific = group
                .agents
                .iter()
                .any(|agent| agent_matches(agent, user_agent));
            let matches_wildcard =
                group.agents.is_empty() || group.agents.iter().any(|agent| agent == "*");
            if matches_specific {
                specific_seen = true;
                specific.merge(group.rules);
            } else if matches_wildcard {
                wildcard.merge(group.rules);
            }
        }
        if specific_seen {
            specific
        } else {
            wildcard
        }
    }

    /// 判定某个路径是否允许抓取。
    ///
    /// `path` 传 URL 的路径部分（可含 `?query`）；空串按 `/` 处理。
    /// 命中最长前缀的规则生效，`Allow` 与 `Disallow` 等长时 `Allow` 胜出，
    /// 没有任何命中则放行。
    pub fn is_allowed(&self, path: &str) -> bool {
        let path = if path.is_empty() { "/" } else { path };
        let matched = self
            .allow
            .iter()
            .map(|pattern| (pattern.as_str(), true))
            .chain(
                self.disallow
                    .iter()
                    .map(|pattern| (pattern.as_str(), false)),
            )
            .filter(|(pattern, _)| !pattern.is_empty() && path.starts_with(pattern))
            .max_by_key(|(pattern, allowed)| (pattern.len(), *allowed));
        matched.is_none_or(|(_, allowed)| allowed)
    }

    /// 合并同属一个 UA 归属的多个分组（保留出现顺序）。
    fn merge(&mut self, other: Self) {
        self.disallow.extend(other.disallow);
        self.allow.extend(other.allow);
    }
}

/// robots 中声明的 UA token 是否匹配本抓取器：取产品名做大小写不敏感前缀匹配。
fn agent_matches(pattern: &str, user_agent: &str) -> bool {
    if pattern.is_empty() || pattern == "*" {
        return false;
    }
    let product = user_agent
        .split(['/', ' '])
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    !product.is_empty() && product.starts_with(pattern)
}

/// 去掉行内 `#` 注释并裁剪首尾空白。
fn strip_comment(line: &str) -> &str {
    line.split('#').next().unwrap_or_default().trim()
}

#[cfg(test)]
mod tests {
    use super::*;

    const BOT_UA: &str = "GdkBot/0.1 (+https://gaodekuai.local)";

    #[test]
    fn disallow_prefix_blocks_subpaths() {
        let rules = RobotsRules::parse("User-agent: *\nDisallow: /admin\n", BOT_UA);
        assert!(!rules.is_allowed("/admin"));
        assert!(!rules.is_allowed("/admin/x"));
        assert!(!rules.is_allowed("/admin/secret"));
        assert!(rules.is_allowed("/about"));
        assert!(rules.is_allowed("/"));
        // RFC 9309 的前缀语义：`/admin` 也会命中 `/administrator`。
        assert!(!rules.is_allowed("/administrator"));
    }

    #[test]
    fn longest_prefix_wins_and_allow_beats_disallow_at_equal_length() {
        let rules = RobotsRules::parse(
            "User-agent: *\nDisallow: /docs\nAllow: /docs/public\n",
            BOT_UA,
        );
        assert!(!rules.is_allowed("/docs/internal"));
        assert!(rules.is_allowed("/docs/public"));
        assert!(rules.is_allowed("/docs/public/guide.html"));

        let tie = RobotsRules::parse("User-agent: *\nDisallow: /a\nAllow: /a\n", BOT_UA);
        assert!(tie.is_allowed("/a"), "等长时 Allow 优先");
    }

    #[test]
    fn empty_rules_allow_everything() {
        for rules in [
            RobotsRules::allow_all(),
            RobotsRules::default(),
            RobotsRules::parse("", BOT_UA),
            RobotsRules::parse("# 只有注释\n", BOT_UA),
            RobotsRules::parse("User-agent: *\nDisallow:\n", BOT_UA),
        ] {
            assert!(rules.disallow.is_empty(), "{rules:?}");
            assert!(rules.is_allowed("/"));
            assert!(rules.is_allowed("/admin/x"));
            assert!(rules.is_allowed(""));
        }
    }

    #[test]
    fn disallow_root_blocks_whole_site() {
        let rules = RobotsRules::parse("User-agent: *\nDisallow: /\n", BOT_UA);
        assert!(!rules.is_allowed("/"));
        assert!(!rules.is_allowed("/about.html"));
    }

    #[test]
    fn user_agent_specific_group_wins_over_wildcard() {
        let text = "User-agent: *\nDisallow: /\n\nUser-agent: GdkBot\nDisallow: /admin\n";
        let rules = RobotsRules::parse(text, BOT_UA);
        assert!(
            rules.is_allowed("/about"),
            "UA 专属组优先，不应被 * 的全站禁止覆盖"
        );
        assert!(!rules.is_allowed("/admin/x"));

        let other = RobotsRules::parse(text, "SomeOtherBot/2.0");
        assert!(!other.is_allowed("/about"), "未匹配到专属组时回落到 *");
    }

    #[test]
    fn empty_specific_group_still_overrides_wildcard() {
        // 专属组只写空的 Disallow，表示「对该抓取器全放行」。
        let rules = RobotsRules::parse(
            "User-agent: GdkBot\nDisallow:\n\nUser-agent: *\nDisallow: /admin\n",
            BOT_UA,
        );
        assert!(rules.is_allowed("/admin/x"));
    }

    #[test]
    fn user_agent_matching_is_case_insensitive_prefix() {
        let text = "User-agent: gdkbot\nDisallow: /private\n";
        assert!(!RobotsRules::parse(text, "GdkBot/0.1").is_allowed("/private/x"));
        assert!(!RobotsRules::parse(text, "gdkbot").is_allowed("/private/x"));

        let prefix = "User-agent: Gdk\nDisallow: /private\n";
        assert!(!RobotsRules::parse(prefix, BOT_UA).is_allowed("/private/x"));

        let mismatch = "User-agent: OtherBot\nDisallow: /private\n";
        assert!(RobotsRules::parse(mismatch, BOT_UA).is_allowed("/private/x"));
    }

    #[test]
    fn group_with_several_user_agents_applies_to_each() {
        let text = "User-agent: GdkBot\nUser-agent: PartnerBot\nDisallow: /private\n";
        assert!(!RobotsRules::parse(text, BOT_UA).is_allowed("/private"));
        assert!(!RobotsRules::parse(text, "PartnerBot/3").is_allowed("/private"));
        assert!(RobotsRules::parse(text, "Stranger/1").is_allowed("/private"));
    }

    #[test]
    fn ignores_sitemap_crawl_delay_and_comments() {
        let text = "\
# 站点爬虫策略
User-agent: *
Crawl-delay: 10
Disallow: /admin # 后台入口
Disallow: /tmp/
Allow: /admin/public
Sitemap: https://a.example/sitemap.xml
Host: a.example
";
        let rules = RobotsRules::parse(text, BOT_UA);
        assert_eq!(rules.disallow, vec!["/admin", "/tmp/"]);
        assert_eq!(rules.allow, vec!["/admin/public"]);
        assert!(!rules.is_allowed("/admin/secret"));
        assert!(rules.is_allowed("/admin/public"));
        assert!(!rules.is_allowed("/tmp/cache"));
    }

    #[test]
    fn directives_are_case_insensitive() {
        let rules = RobotsRules::parse("USER-AGENT: *\nDISALLOW: /Admin\n", BOT_UA);
        assert!(
            !rules.is_allowed("/Admin/x"),
            "路径匹配区分大小写，指令不区分"
        );
        assert!(rules.is_allowed("/about"));
    }

    #[test]
    fn rules_do_not_leak_across_groups() {
        let text = "User-agent: GdkBot\nDisallow: /a\n\nUser-agent: *\nDisallow: /b\n";
        let rules = RobotsRules::parse(text, BOT_UA);
        assert!(!rules.is_allowed("/a"));
        assert!(rules.is_allowed("/b"), "别的组的规则不应生效");
    }

    #[test]
    fn malformed_lines_are_skipped() {
        let text = "无冒号的行\n:\nDisallow: /admin\n\n\n";
        let rules = RobotsRules::parse(text, BOT_UA);
        assert_eq!(rules.disallow, vec!["/admin"]);
        assert!(!rules.is_allowed("/admin/x"));
    }

    #[test]
    fn parse_trims_whitespace_and_crlf() {
        let rules = RobotsRules::parse("User-agent: *  \r\n  Disallow:   /admin  \r\n", BOT_UA);
        assert_eq!(rules.disallow, vec!["/admin"]);
        assert!(!rules.is_allowed("/admin/x"));
    }
}
