#!/usr/bin/env python3
"""
从 search_browser.rs 重新生成 scripts/capture-search-tables.js，并校验逐字一致。

🔴 为什么需要这个：采集脚本里的 extractVisibleTables() 必须与线上
   extract_visible_tables_script() **逐字相同**，否则"改造前基线"就不是线上实现的
   真实输出，Task 10 的 parity 比对会失去参照物 —— 而这种漂移是静默的：
   两边看起来都在跑，结果对不上时你会去怀疑重构，而真正的原因是采集器早就变了。

用法：
  python3 scripts/refresh-capture-snippet.py           # 校验；不一致则 exit 1
  python3 scripts/refresh-capture-snippet.py --write    # 重新生成
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RS = ROOT / "apps/desktop/src-tauri/src/services/search_browser.rs"
SNIPPET = ROOT / "scripts/capture-search-tables.js"

BEGIN = "  // ↓↓↓ 以下函数体与 search_browser.rs::extract_visible_tables_script() 逐字一致 ↓↓↓\n"
END_MARK = ";\n  // ↑↑↑ 逐字复制区结束 ↑↑↑"


def rust_js() -> str:
    src = RS.read_text(encoding="utf-8")
    m = re.search(
        r"pub fn extract_visible_tables_script\(\) -> &'static str \{\s*r#\"(.*?)\"#\s*\}",
        src,
        re.S,
    )
    if not m:
        sys.exit("❌ 在 search_browser.rs 里找不到 extract_visible_tables_script")
    return m.group(1).rstrip()


def embed(js: str) -> str:
    body = "\n".join(("  " + ln) if ln.strip() else ln for ln in js.split("\n"))
    return f"{BEGIN}  const extractVisibleTables = () => {body}{END_MARK}"


def main() -> None:
    write = "--write" in sys.argv
    js = rust_js()
    expected = embed(js)
    if not SNIPPET.exists():
        sys.exit(f"❌ {SNIPPET} 不存在，请先用 --write 生成")
    current = SNIPPET.read_text(encoding="utf-8")
    if expected in current:
        print(f"✅ 采集脚本与 search_browser.rs 逐字一致（JS 主体 {len(js)} 字节）")
        return
    if not write:
        print("❌ 采集脚本与 search_browser.rs **不一致** —— 基线不可信")
        print("   修法：python3 scripts/refresh-capture-snippet.py --write")
        sys.exit(1)
    # 只替换复制区，保留文件其余部分（说明文字、下载逻辑）
    start = current.find(BEGIN)
    end = current.find(END_MARK)
    if start < 0 or end < 0:
        sys.exit("❌ 找不到复制区标记，无法安全替换；请人工核对")
    updated = current[:start] + expected + current[end + len(END_MARK):]
    SNIPPET.write_text(updated, encoding="utf-8")
    print(f"✅ 已重新生成 {SNIPPET.relative_to(ROOT)}（JS 主体 {len(js)} 字节）")


if __name__ == "__main__":
    main()
