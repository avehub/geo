//! 强类型 ID。全部为 UUIDv4 的 newtype，序列化为裸字符串，
//! 数据库中以 TEXT 存储。

use std::fmt;
use std::str::FromStr;

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use uuid::Uuid;

use crate::error::GeoError;

macro_rules! id_type {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default)]
        pub struct $name(pub Uuid);

        impl $name {
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }

            pub fn from_uuid(uuid: Uuid) -> Self {
                Self(uuid)
            }

            pub fn as_uuid(&self) -> &Uuid {
                &self.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}", self.0)
            }
        }

        impl FromStr for $name {
            type Err = GeoError;

            fn from_str(raw: &str) -> Result<Self, Self::Err> {
                Uuid::parse_str(raw.trim()).map(Self).map_err(|_| {
                    GeoError::validation(stringify!($name), "invalid_id").with_param("value", raw)
                })
            }
        }

        impl From<Uuid> for $name {
            fn from(uuid: Uuid) -> Self {
                Self(uuid)
            }
        }

        impl From<$name> for Uuid {
            fn from(id: $name) -> Uuid {
                id.0
            }
        }

        impl From<$name> for String {
            fn from(id: $name) -> String {
                id.to_string()
            }
        }

        impl Serialize for $name {
            fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
                serializer.serialize_str(&self.to_string())
            }
        }

        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
                let raw = String::deserialize(deserializer)?;
                Self::from_str(&raw).map_err(serde::de::Error::custom)
            }
        }
    };
}

// 项目 ID / Prompt 集 ID / Prompt 条目 ID / 竞品 ID / 资产 ID / 修订 ID / 关键词 ID / FAQ ID / 知识条目 ID / 站点 ID
id_type!(ProjectId);
id_type!(PromptSetId);
id_type!(PromptId);
id_type!(CompetitorId);
id_type!(AssetId);
id_type!(RevisionId);
id_type!(KeywordId);
id_type!(FaqId);
id_type!(KbEntryId);
id_type!(SiteProfileId);
id_type!(SiteChannelId);
id_type!(SitePatchId);
id_type!(SitePatchEventId);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_roundtrips_through_string() {
        let id = ProjectId::new();
        let parsed: ProjectId = id.to_string().parse().unwrap();
        assert_eq!(id, parsed);
    }

    #[test]
    fn id_serializes_as_bare_string() {
        let id = PromptId::new();
        let json = serde_json::to_string(&id).unwrap();
        assert_eq!(json, format!("\"{id}\""));
        let back: PromptId = serde_json::from_str(&json).unwrap();
        assert_eq!(back, id);
    }

    #[test]
    fn invalid_id_is_validation_error() {
        let err = CompetitorId::from_str("not-a-uuid").unwrap_err();
        assert_eq!(err.code(), "validation/failed");
    }

    #[test]
    fn ids_are_unique() {
        assert_ne!(AssetId::new(), AssetId::new());
    }
}
