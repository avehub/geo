# brand/ — 应用图标与品牌资产

| 文件 | 说明 |
|---|---|
| `icon-source.png` | 1024×1024 RGBA 图标源图（唯一手绘资产），由 `scripts/make-icon.py` 生成 |
| `../apps/desktop/src-tauri/icons/` | 各平台尺寸产物，由 `tauri icon` 从源图派生，**不要手改** |

## 图形语义

- 深蓝渐变圆角方块：桌面应用的"窗口/画布"。
- 白色雷达弧 + 圆点：GEO 的核心动作——在生成式引擎里"被看见"。
- 三根上升柱（白/青）：可见度与提及率的提升趋势。

不含任何排名承诺或绝对化用语（`AGENTS.md` 规则 6）。

## 重新生成

改样式时只改 `scripts/make-icon.py`（纯标准库，无第三方依赖），然后：

```bash
python3 scripts/make-icon.py                                   # 重画 1024×1024 源图
mise exec -- pnpm --dir apps/desktop/ui run tauri icon \
  -o ../src-tauri/icons "$(pwd)/brand/icon-source.png"          # 派生全部尺寸
scripts/record-fixtures.sh check                                # 顺手跑一遍离线自检
```

注意 `tauri icon` 的路径参数要传**绝对路径**（pnpm 会把 cwd 切到 `apps/desktop/ui`）。

派生产物会覆盖 `apps/desktop/src-tauri/icons/` 下的 png/icns/ico 与 android/ios 目录，
提交前用 `git status` 确认只多了预期的图标文件。
