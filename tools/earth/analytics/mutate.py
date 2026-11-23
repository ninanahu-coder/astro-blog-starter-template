# 统计埋点的变异检查：逐个把关键防线改坏，跑 tests/earth/analytics.test.ts，应当全部 KILLED。用法：python3 tools/earth/analytics/mutate.py（在仓库根目录）
import subprocess, sys
M = [
 ("关后 flush 仍发送", "src/game/ui/telemetry.ts", "		if (!this.d.enabled()) {\n			this.clear();\n			return;\n		}\n		if (this.sending", "		if (this.sending"),
 ("关后 track 仍排队", "src/game/ui/telemetry.ts", "			if (!this.d.enabled()) return;\n			const e", "			const e"),
 ("客户端不校验白名单", "src/game/ui/telemetry.ts", "			if (!validEvent(e)) return;\n", ""),
 ("服务端忽略 nt（动作）", "src/game/server/world.ts", "if (body.nt !== true) await this.track(id, realDayOf(now), actionCounts", "if (true) await this.track(id, realDayOf(now), actionCounts"),
 ("服务端忽略 nt（建角色）", "src/game/server/world.ts", "const track = body.nt !== true;", "const track = true;"),
 ("批次不查参数白名单", "src/game/server/stats.ts", "if (typeof arg !== 'string' || !allowed.includes(arg)) continue;", "if (typeof arg !== 'string') continue;"),
 ("功能名带地点 id", "src/game/server/stats.ts", "return VENUE_OPS.test(a.op) ? `venue.${a.op}` : 'venue';", "return `venue.${a.venue}.${a.lat}`;"),
 ("查询不验令牌", "src/game/server/world.ts", "token.length < 32 || !timingSafeEqual(auth, 'Bearer ' + token)", "false"),
 ("留存不删注册日", "src/game/server/world.ts", "if (k > BORN_KEEP_DAYS) await this.ctx.storage.delete(bornKey);", ""),
 ("落盘失败丢计数", "src/game/server/stats.ts", "					this.pending.set(day, addCounts(this.pending.get(day) ?? {}, add));\n", ""),
 ("页面关统计不带 nt", "src/pages/earth.astro", "statsOn ? body : { ...(body as object), nt: true }", "body"),
 ("页面传名字进埋点", "src/pages/earth.astro", "tm.track('tab', tab);", "tm.track('tab', state.name);"),
 ("漏斗出行判定反了", "src/game/server/stats.ts", "distinct(before.visited) <= 1 &&", "distinct(before.visited) >= 1 && false &&"),
]
bad=0
for name,f,a,b in M:
    src=open(f).read()
    assert src.count(a)==1,(name,src.count(a))
    open(f,'w').write(src.replace(a,b))
    try:
        r=subprocess.run(['node','--test','tests/earth/analytics.test.ts'],capture_output=True,text=True,timeout=120)
    finally:
        open(f,'w').write(src)
    killed = r.returncode!=0
    if not killed: bad+=1
    print(('KILLED ' if killed else 'SURVIVED ')+name)
print('survived',bad)
