# 平衡调试工具的变异检查：逐个把关键防线改坏，跑对应的测试文件，应当全部 KILLED。
# 用法（仓库根目录）：python3 tools/earth/balance/mutate.py [--fast]   --fast 跳过要真跑两次生产构建的 GM 构建类变异
import subprocess, sys

BT = 'tests/earth/balance-tools.test.ts'
GM = 'tests/earth/gm.test.ts'
M = [
 # ---- 模拟器：系统开关、经济流水、默认输出 ----
 ("关掉的系统照样做", BT, "tools/earth/balance/sim.ts", "	if (sys && OFF.has(sys)) return", "	if (false && sys) return"),
 ("关掉事件仍结算", BT, "tools/earth/balance/sim.ts", "	if (OFF.has('events') && b.s.pending) {", "	if (false && b.s.pending) {"),
 ("关掉共同事件仍做", BT, "tools/earth/balance/sim.ts", "	if (OFF.has('coop')) return false;\n", ""),
 ("动作不记流水", BT, "tools/earth/balance/sim.ts", "	recordEco(ecoOf(b), a.t, key, b.s.cash - before.cash);\n", ""),
 ("回收记成正数投放", BT, "tools/earth/balance/systems.ts", "		addTo(e.out, type, -delta);", "		addTo(e.in, type, -delta);"),
 ("流水按天数算错", BT, "tools/earth/balance/systems.ts", "v / list.length / (perDay ? days : 1)", "v / list.length"),
 ("默认报告多出一行", BT, "tools/earth/balance/sim.ts", "if (OFF.size) out(`\\n**本次关掉的系统", "if (true) out(`\\n**本次关掉的系统"),
 ("--eco 改动原报告", BT, "tools/earth/balance/sim.ts", "lines.join('\\n') + '\\n' + (process.argv.includes('--eco')", "lines.join('\\n') + (process.argv.includes('--eco')"),
 ("--only 不生效", BT, "tools/earth/balance/sim.ts", "if (ONLY.length) for (const list", "if (false) for (const list"),
 ("坏参数不报错", BT, "tools/earth/balance/systems.ts", "	if (bad.length) throw new Error", "	if (false) throw new Error"),
 ("A/B 两边都全开", BT, "tools/earth/balance/ab.ts", "		variant = runSim([...pass, `--off=${off.join(',')}`]);", "		variant = runSim(pass);"),
 ("零工归错系统", BT, "tools/earth/balance/systems.ts", "export const GIGS = ['work-mine', 'work-farm', 'work-cafe', 'busk'] as const;", "export const GIGS = ['work-mine', 'work-farm', 'work-cafe'] as const;"),
 # ---- 导出与基线 ----
 ("CSV 不转义逗号", BT, "tools/earth/balance/report.ts", "	return /[\",\\n]/.test(s) ? `\"${s.replace(/\"/g, '\"\"')}\"` : s;\n};\n\n/**\n * 长表", "	return s;\n};\n\n/**\n * 长表"),
 ("基线不比缺失项", BT, "tools/earth/balance/report.ts", "		for (const key of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {", "		for (const key of Object.keys(a).filter((k) => k in b)) {"),
 ("基线忽略口径", BT, "tools/earth/balance/report.ts", "	if (before.days !== after.days || before.runs !== after.runs) {", "	if (false) {"),
 ("基线容差失效", BT, "tools/earth/balance/report.ts", "Math.abs(y - x) <= tol * Math.max", "Math.abs(y - x) <= 1 + tol * Math.max"),
 ("基线不取整", BT, "tools/earth/balance/report.ts", "const round4 = (n: number | null) => (n === null ? null : Math.round(n * 1e4) / 1e4);", "const round4 = (n: number | null) => n;"),
 # ---- 待平衡面板 ----
 ("面板漏掉字符串里的标记", BT, "tools/earth/balance/tuning-lib.ts", "		if (!isCommentLine(l)) {\n", "		if (!isCommentLine(l)) {\n			if (!splitComment(l).comment.includes(MARKER)) continue;\n"),
 ("面板不拼多行对象", BT, "tools/earth/balance/tuning-lib.ts", "		if (/^\\s*\\{\\s*$/.test(code)) {", "		if (false) {"),
 ("面板不认文件说明", BT, "tools/earth/balance/tuning-lib.ts", "		if (firstCode < 0 || i < firstCode) {", "		if (firstCode < 0) {"),
 ("面板数字带上字符串里的", BT, "tools/earth/balance/tuning-lib.ts", "	const bare = code.replace(", "	const bare = code; void code.replace("),
 # ---- GM ----
 ("GM 改了入参", GM, "src/game/dev/gm.ts", "	return done(s, { ...s, cash: v }, region,", "	(s as { cash: number }).cash = v;\n	return done(s, { ...s, cash: v }, region,"),
 ("GM 不钳现金", GM, "src/game/dev/gm.ts", "	const v = Math.round(Math.min(MAX_CASH, Math.max(0, cash)));", "	const v = Math.round(cash);"),
 ("GM 跳时间也结算", GM, "src/game/dev/gm.ts", "export function gmSkip(s: PlayerState, region: Region, minutes: number): GmResult {\n", "export function gmSkip(s: PlayerState, region: Region, minutes: number): GmResult {\n	if (minutes > 0) return gmPass(s, region, minutes);\n"),
 ("GM 快进无上限", GM, "src/game/dev/gm.ts", "	if (minutes > MAX_PASS_MINUTES) return", "	if (false) return"),
 ("GM 覆盖待选事件", GM, "src/game/dev/gm.ts", "	if (s.pending) return { ok: false, state: s, msg: `已经有待处理的事件", "	if (false) return { ok: false, state: s, msg: `已经有待处理的事件"),
 ("GM 不过存档校验", GM, "src/game/dev/gm.ts", "	if (!clean) return { ok: false, state: prev, msg: `改完的存档不合法", "	if (!clean) return { ok: true, state: next, msg: `改完的存档不合法"),
 ("GM 坏 JSON 抛错", GM, "src/game/dev/gm.ts", "			try { a = JSON.parse(arg); } catch { return { ok: false, state: s, msg: 'act= 后面要是动作 JSON' }; }", "			a = JSON.parse(arg);"),
 ("集成在构建时也注入", GM, "tools/earth/gm/integration.mjs", "				if (command !== 'dev') return;\n", ""),
 ("GM 页不挡生产", GM, "src/game/dev/gm-page.astro", "if (!import.meta.env.DEV) return new Response(null, { status: 404 });", "// 不挡"),
 ("线上页面 import GM", GM, "src/pages/earth.astro", "---\n// 「地球人生", "---\nimport { GM_MARKER } from '../game/dev/gm.ts';\nconsole.log(GM_MARKER);\n// 「地球人生", "build"),
 ("扫描只认原文不认转义", GM, "tests/earth/gm.test.ts", "	return [...new Set([t, esc(false), esc(true)])];", "	return [t];", "build"),
]

fast = '--fast' in sys.argv
bad = 0
for row in M:
    name, test, f, a, b = row[:5]
    if fast and len(row) > 5:
        print('SKIPPED ' + name)
        continue
    src = open(f, encoding='utf8').read()
    assert src.count(a) == 1, (name, src.count(a))
    open(f, 'w', encoding='utf8').write(src.replace(a, b))
    try:
        r = subprocess.run(['node', '--test', test], capture_output=True, text=True, timeout=900)
    finally:
        open(f, 'w', encoding='utf8').write(src)
    killed = r.returncode != 0
    if not killed:
        bad += 1
    print(('KILLED ' if killed else 'SURVIVED ') + name, flush=True)
print('survived', bad)
sys.exit(1 if bad else 0)
