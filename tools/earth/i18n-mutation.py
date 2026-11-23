# 多语言测试的变异检查（第 38 批）：逐条把源码改坏，确认 tests/earth/i18n.test.ts + prefs.test.ts 会失败。
# 用法：在仓库根目录跑 `python3 tools/earth/i18n-mutation.py`；有任何一条 SURVIVED 就说明测试漏了，退出码 1。
# 每条改完立刻还原；被测文案改了以后要同步改这里的原文，原文找不到会直接报错（不会静默跳过）。
import subprocess, sys
M = [
 ('删一个英文键', 'src/game/i18n/strings/en.ts', "\t'tab.me': 'Me',\n", ''),
 ('英文漏翻留中文', 'src/game/i18n/strings/en.ts', "'tab.go': 'Travel'", "'tab.go': '出行'"),
 ('英文占位符改名', 'src/game/i18n/strings/en.ts', "'Players online here: {n}'", "'Players online here: {count}'"),
 ('英文漏占位符', 'src/game/i18n/strings/en.ts', "'Players online here: {n}'", "'Players online here'"),
 ('繁体多拼错键', 'src/game/i18n/strings/zh-Hant.ts', "\t'tab.me': '我',\n", "\t'tab.me': '我',\n\t'tab.mee': '我',\n"),
 ('繁体留简体字', 'src/game/i18n/strings/zh-Hant.ts', "'這裡有 {n} 位玩家在線'", "'这里有 {n} 位玩家在线'"),
 ('繁体空串', 'src/game/i18n/strings/zh-Hant.ts', "'tab.grow': '成長'", "'tab.grow': ' '"),
 ('基准表多一个没人用的键', 'src/game/i18n/strings/zh-Hans.ts', "\t'tab.me': '我',\n", "\t'tab.me': '我',\n\t'tab.unused': '无',\n"),
 ('页面引用不存在的键', 'src/pages/earth.astro', "tx('me.news.new')", "tx('me.news.neww')"),
 ('tx 不包 esc', 'src/pages/earth.astro', "=> esc(t(prefs.lang, key, params));", "=> t(prefs.lang, key, params);"),
 ('页面直接拼 t()', 'src/pages/earth.astro', "${tx('pref.display')}", "${t(prefs.lang, 'pref.display')}"),
 ('语言名不 esc', 'src/pages/earth.astro', "${esc(LOCALES[l].label)}", "${LOCALES[l].label}"),
 ('回退链断', 'src/game/i18n/locales.ts', "en: { label: 'English', tag: 'en-AU', fallback: ['zh-Hans'] }", "en: { label: 'English', tag: 'en-AU', fallback: [] }"),
 ('lookup 不回退', 'src/game/i18n/index.ts', "[locale, ...LOCALES[locale].fallback, DEFAULT_LOCALE]", "[locale]"),
 ('fill 吞掉漏传', 'src/game/i18n/index.ts', "? String(params[k]) : m)", "? String(params[k]) : '')"),
 ('fill 认原型链', 'src/game/i18n/index.ts', "Object.hasOwn(params, k)", "k in params"),
 ('isLocale 认原型链', 'src/game/i18n/locales.ts', "Object.hasOwn(LOCALES, v)", "v in LOCALES"),
 ('prefs 不校验语言', 'src/game/ui/prefs.ts', "isLocale(own('lang')) ? (own('lang') as Locale) : DEFAULT_PREFS.lang", "((own('lang') as Locale) ?? DEFAULT_PREFS.lang)"),
 ('金额不取整', 'src/game/i18n/format.ts', "Math.abs(Math.round(n))", "Math.abs(n)"),
 ('负零带负号', 'src/game/i18n/format.ts', "n < 0 && abs ?", "n < 0 ?"),
 ('时区写死珀斯', 'src/game/i18n/format.ts', "Object.hasOwn(REGION_TZ, region) ? REGION_TZ[region] : REGION_TZ.wa", "REGION_TZ.wa"),
 ('时区认原型链', 'src/game/i18n/format.ts', "Object.hasOwn(REGION_TZ, region) ? REGION_TZ[region] : REGION_TZ.wa", "REGION_TZ[region] ?? REGION_TZ.wa"),
 ('时钟分钟算错', 'src/game/i18n/format.ts', "String(m % 60)", "String(m % 61)"),
]
bad = 0
for name, f, a, b in M:
    s = open(f, encoding='utf-8').read()
    assert s.count(a) == 1, (name, a)
    open(f, 'w', encoding='utf-8').write(s.replace(a, b))
    try:
        r = subprocess.run(['node', '--test', 'tests/earth/i18n.test.ts', 'tests/earth/prefs.test.ts'], capture_output=True, text=True)
    finally:
        open(f, 'w', encoding='utf-8').write(s)
    killed = r.returncode != 0
    bad += not killed
    print(('KILLED ' if killed else 'SURVIVED ') + name)
print('survived', bad, 'of', len(M)); sys.exit(1 if bad else 0)
