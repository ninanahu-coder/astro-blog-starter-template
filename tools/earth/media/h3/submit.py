#!/usr/bin/env python3
"""地点环境短片：调用 h3v2 submit，上传关键帧改用内容哈希命名（避免共享服务器同名覆盖串帧）。
用法：在 tools/earth/media/h3/<地点>/ 里运行 python3 ../submit.py segments.json --seed 7700 [--dry-run]"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path.home() / 'AI/video-workflow/dist/h3v2-workflow/scripts'))
import h3v2  # noqa: E402

h3v2.upload = lambda fp: h3v2.upload_unique(fp, 'earthloc')
sys.argv = [sys.argv[0], 'submit'] + sys.argv[1:]
h3v2.main()
