#!/usr/bin/env python3
"""检查三版离线 HTML UI 预览的完整性，不修改交付文件。"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

VARIANTS = ("a", "b", "c")


def main() -> int:
    parser = argparse.ArgumentParser(description="检查三版离线 HTML UI 预览")
    parser.add_argument("directory", type=Path, help="包含 index.html 的交付目录")
    parser.add_argument("--pages", type=int, default=25, help="每版应有页数，默认 25")
    args = parser.parse_args()
    root = args.directory.expanduser().resolve()
    errors: list[str] = []
    warnings: list[str] = []

    for rel in ("index.html", "src/main.js"):
        if not (root / rel).is_file():
            errors.append(f"缺少文件：{rel}")

    if args.pages < 1:
        errors.append("--pages 必须大于 0")

    for variant in VARIANTS:
        folder = root / "previews" / variant
        if not folder.is_dir():
            errors.append(f"缺少方案目录：previews/{variant}")
            continue
        for page in range(1, args.pages + 1):
            path = folder / f"page-{page}.png"
            if not path.is_file():
                errors.append(f"缺图：{path.relative_to(root)}")
            elif path.stat().st_size == 0:
                errors.append(f"空图片：{path.relative_to(root)}")

    combined = ""
    for rel in ("index.html", "src/main.js"):
        path = root / rel
        if path.is_file():
            combined += "\n" + path.read_text(encoding="utf-8")
    if re.search(r"(?:src|href)=[\"']https?://", combined, re.I):
        errors.append("HTML 存在远程 src/href 依赖，离线预览应改为本地资源")
    if re.search(r"TODO_Describe|YOUR_|PLACEHOLDER|待补充", combined, re.I):
        errors.append("页面仍有未完成占位内容")
    if "location.hash" not in combined:
        warnings.append("未检测到 URL hash 定位，请确认方案与页面可分享定位")
    if "addEventListener" not in combined:
        errors.append("未检测到交互事件")

    result = {
        "ok": not errors,
        "directory": str(root),
        "variants": list(VARIANTS),
        "pagesPerVariant": args.pages,
        "errors": errors,
        "warnings": warnings,
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
