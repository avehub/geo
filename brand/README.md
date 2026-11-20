# brand/ — 应用图标与品牌资产

| 文件 | 说明 |
|---|---|
| `icon-source-original.png` | 设计交付原图（1536×1536 PNG，白底上画蓝色圆角方块；**只改这个**） |
| `icon-source.png` | 1024×1024 RGBA 母版：裁到方块边界、圆角外侧补透明，由脚本生成 |
| `../apps/desktop/src-tauri/icons/` | 各平台尺寸产物，由 `scripts/make-icon.py` 派生，**不要手改** |

## 图形语义

- 蓝色圆角方块：桌面应用的"窗口/画布"。
- 白色「搞钱」大字：品牌名（中文展示名 `搞钱GEO`，英文 `GQ-GEO`）。
- 「高」字口中嵌的黄色铜钱：生意的语义锚点，也是全图唯一的暖色。
- 右下 `GEO`：生成式引擎优化。

不含任何排名承诺或绝对化用语（`AGENTS.md` 规则 6）。

## 重新生成

换图时只替换 `icon-source-original.png`，然后重跑：

```bash
python3 scripts/make-icon.py          # 需要 Pillow，仅开发期依赖
scripts/record-fixtures.sh check      # 顺手跑一遍离线自检
```

脚本一次产出：`brand/icon-source.png` 母版、Windows `icon.ico`、macOS `icon.icns`、
Tauri 的 PNG 尺寸、Microsoft Store 磁贴（`Square*Logo.png` / `StoreLogo.png`），
以及 `android/` `ios/` 里的移动端产物（桌面构建不引用，只为保持一致）。

## Windows 任务栏三条硬约束

1. **ICO 第 0 帧必须是 256×256。** `tauri-codegen` 在 Windows 上把 `icon.ico` 的
   **第一个 entry** 解码成窗口图标（也就是任务栏图标），它不挑最大帧。旧图标第 0 帧
   只有 32×32，高 DPI 任务栏只能把它放大成糊图。脚本按 256 → 16 降序写帧。
2. **帧必须是未压缩 BMP。** Windows 外壳与 `ico` crate 对 BMP 帧的兼容性最好；
   脚本不写 PNG 帧，避免出现"exe 有图标、任务栏却是空白"的情况。
3. **圆角外必须透明。** 原图圆角外是白底，直接缩小会在任务栏/标题栏留下白方块；
   母版按原图圆角半径重建 alpha 通道。

改完图标后如果 Windows 仍显示旧图标，那是资源管理器图标缓存：
`ie4uinit.exe -show` 或重启 explorer 即可；正式发布请同时跑
`mise run version:set -- X.Y.Z` 让安装包与 exe 时间戳一起变化。
