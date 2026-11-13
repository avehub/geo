//! 构建形态门禁（2026-11-13 裁定 B8）：Store（MSIX）版不含浏览器自动化通道。
//!
//! 背景：Store 认证对「受控浏览器」行为敏感，且 MSIX 容器对这两条通道未实测；
//! 产品裁定 Store 版不保留腾讯元宝采集通道与百度站长浏览器取数，直下载版不受影响。
//! 前端按 `VITE_STORE_BUILD` 隐藏入口（`ui/src/api/build-flavor.ts`），这里做服务端兜底：
//! Store 构建下相应 IPC 命令回 `validation/failed`，命令面清单保持 108 条不变。
//! 裁定与事实见 docs/superpowers/specs/2026-11-10-release-signing-distribution-design.md
//! （DR-R3 修订 / §4.5）。

use crate::error::IpcError;
use geo_domain::GeoError;

/// 以 `--features store` 编译时为真（`release.yml` 的 msix job）。
pub const STORE_BUILD: bool = cfg!(feature = "store");

/// Store 构建下拒绝浏览器自动化通道；直下载版原样放行。
pub fn reject_in_store_build(channel: &str) -> Result<(), IpcError> {
    if STORE_BUILD {
        return Err(IpcError::from(
            GeoError::validation("channel", "unsupported_in_store_build")
                .with_param("channel", channel.to_string()),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(feature = "store")]
    #[test]
    fn store_build_rejects_browser_channels() {
        let error = reject_in_store_build("yuanbao").expect_err("Store 构建必须拒绝");
        assert_eq!(error.code, "validation/failed");
    }

    #[cfg(not(feature = "store"))]
    #[test]
    fn direct_build_allows_browser_channels() {
        assert!(reject_in_store_build("yuanbao").is_ok());
    }
}
