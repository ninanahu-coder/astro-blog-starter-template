// 天象（第 8 批）：游戏日期对应现实日期、气温、日出日落、潮汐、山火、紫外线。全部是公式，只做显示
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasTide, hhmm, phaseNote, realDateLabel, realDayOfYear, skyPhase, sunElevation, sunTimes, temps, tideHeight, tideNow, fireDanger, fireSeason, FIRE_LEVELS, uvDay, uvIndex, uvLevel } from '../../src/game/core/sky.ts';
import { weatherOn } from '../../src/game/core/weather.ts';
import { addFireSeen, FIRE_SEEN_MAX, fireKey, fireToastText, parseFireSeen } from '../../src/game/ui/alerts.ts';
import { SEASON_DAYS, YEAR_DAYS } from '../../src/game/core/time.ts';
import { WA } from '../../src/game/data/wa.ts';

const loc = (id: string) => WA.locations.find((l) => l.id === id)!;
/** 游戏第 day 天（从 0 起）的 hour 点 */
const at = (day: number, hour = 12) => day * 1440 + hour * 60;

test('日期：游戏四季对应南半球的现实月份，季内按比例，一年走一圈不倒退', () => {
	assert.equal(realDateLabel(realDayOfYear(at(0))), '9 月 2 日', '春季第 1 天 ≈ 9 月初');
	assert.equal(realDateLabel(realDayOfYear(at(SEASON_DAYS))), '12 月 2 日', '夏季第 1 天 ≈ 12 月初');
	assert.equal(realDateLabel(realDayOfYear(at(2 * SEASON_DAYS))), '3 月 2 日');
	assert.equal(realDateLabel(realDayOfYear(at(3 * SEASON_DAYS))), '6 月 2 日');
	assert.match(realDateLabel(realDayOfYear(at(YEAR_DAYS - 1))), /^8 月 (2\d|3\d) 日$/, '冬季最后一天 ≈ 8 月底');
	assert.equal(realDayOfYear(at(YEAR_DAYS + 5)), realDayOfYear(at(5)), '第二年同一天一样');
	// 同一天里时间不影响日期；一年里日期只在跨年时回绕一次
	assert.equal(realDayOfYear(at(10, 0)), realDayOfYear(at(10, 23)));
	let wraps = 0;
	for (let d = 1; d < YEAR_DAYS; d++) if (realDayOfYear(at(d)) < realDayOfYear(at(d - 1))) wraps++;
	assert.equal(wraps, 1);
	assert.equal(realDateLabel(0), '1 月 1 日');
	assert.equal(realDateLabel(364), '12 月 31 日');
	assert.equal(realDateLabel(-1), '12 月 31 日');
});

test('气温（第 36 轮）：北边暖、南边凉；夏天比冬天热；内陆温差大；炎热天更热；整数、可复现', () => {
	const jan = at(SEASON_DAYS + 14); // 夏季中 ≈ 1 月中
	const jul = at(3 * SEASON_DAYS + 14); // 冬季中 ≈ 7 月中
	for (const l of WA.locations) {
		const s = temps(l, jan, 'sunny');
		const w = temps(l, jul, 'sunny');
		assert.ok(Number.isInteger(s.max) && Number.isInteger(s.min), l.id);
		assert.ok(s.max > w.max, `${l.id} 夏天比冬天热`);
		assert.ok(s.min < s.max, l.id);
		assert.ok(s.max >= 20 && s.max <= 42 && w.max >= 12 && w.max <= 34, `${l.id} ${s.max}/${w.max} 在西澳合理范围`);
		assert.deepEqual(temps(l, jan, 'sunny'), s, '同一天同一地点一样');
	}
	assert.ok(temps(loc('broome'), jul, 'sunny').max > temps(loc('albany'), jul, 'sunny').max + 8, '冬天北边比南边暖得多');
	const k = temps(loc('kalgoorlie'), jan, 'sunny');
	const p = temps(loc('perth'), jan, 'sunny');
	assert.ok(k.max - k.min > p.max - p.min, '内陆早晚温差比海边大');
	// 同一纬度、同一天：内陆夏天比海边热、冬天略凉
	const kal = loc('kalgoorlie');
	const kalCoast = { ...kal, kind: 'coast', tags: ['beach'] };
	assert.ok(temps(kal, jan, 'sunny').max >= temps(kalCoast, jan, 'sunny').max + 3, '内陆夏天更热');
	assert.ok(temps(kal, jul, 'sunny').max < temps(kalCoast, jul, 'sunny').max, '内陆冬天略凉');
	assert.ok(temps(loc('perth'), jan, 'hot').max > p.max + 3, '炎热天更热');
	assert.ok(temps(loc('perth'), jan, 'storm').max < p.max, '风暴天凉');
	// 每天有点起伏：一季里不全是同一个数
	const days = new Set(Array.from({ length: SEASON_DAYS }, (_, d) => temps(loc('perth'), at(SEASON_DAYS + d), 'sunny').max));
	assert.ok(days.size >= 3);
});

test('日出日落（第 37 轮）：和珀斯的实际时刻相差几分钟以内；夏天白天长；北边冬夏差小；日出日落时太阳正好在地平线', () => {
	const perth = loc('perth');
	// 珀斯（AWST）实际：1 月 10 日约 5:20 / 19:26，7 月 18 日约 7:13 / 17:33（公开天文年历的数）
	const jan = at(SEASON_DAYS + 12, 0);
	const jul = at(3 * SEASON_DAYS + 14, 0);
	assert.equal(realDateLabel(realDayOfYear(jan)), '1 月 10 日');
	assert.equal(realDateLabel(realDayOfYear(jul)), '7 月 18 日');
	const near = (got: number, want: string) => {
		const [h, m] = want.split(':').map(Number);
		assert.ok(Math.abs(got - (h * 60 + m)) <= 5, `${hhmm(got)} 应接近 ${want}`);
	};
	near(sunTimes(perth, jan).rise, '5:20');
	near(sunTimes(perth, jan).set, '19:26');
	near(sunTimes(perth, jul).rise, '7:13');
	near(sunTimes(perth, jul).set, '17:33');
	const len = (l: ReturnType<typeof loc>, c: number) => sunTimes(l, c).set - sunTimes(l, c).rise;
	for (const l of WA.locations) {
		assert.ok(len(l, jan) > len(l, jul), `${l.id} 夏天白天长`);
		const t = sunTimes(l, jan);
		assert.ok(Math.abs(sunElevation(l, jan + t.rise) + 0.83) < 0.6, `${l.id} 日出时太阳在地平线`);
		assert.ok(sunElevation(l, jan + t.noon) > sunElevation(l, jan + t.rise + 60), '正午最高');
	}
	assert.ok(len(loc('albany'), jan) - len(loc('albany'), jul) > len(loc('kununurra'), jan) - len(loc('kununurra'), jul) + 60, '越往南冬夏白天长短差得越多');
	assert.equal(hhmm(5), '0:05');
	assert.equal(hhmm(1445), '0:05');
	assert.equal(hhmm(-5), '23:55');
});

test('画面天色（第 37 轮）：跟着当地日出日落，不是固定钟点；同一个钟点冬夏不同', () => {
	const perth = loc('perth');
	const jan = at(SEASON_DAYS + 12, 0);
	const jul = at(3 * SEASON_DAYS + 14, 0);
	assert.equal(skyPhase(perth, jan + 12 * 60), 'day');
	assert.equal(skyPhase(perth, jan + 2 * 60), 'night');
	assert.equal(skyPhase(perth, jan + 19 * 60), 'dusk', '夏天傍晚 7 点还没黑');
	assert.equal(skyPhase(perth, jul + 19 * 60), 'night', '冬天傍晚 7 点已经黑了');
	assert.equal(skyPhase(perth, jul + 7 * 60), 'dawn', '冬天 7 点天刚亮');
	assert.equal(skyPhase(perth, jan + 7 * 60), 'day', '夏天 7 点已经大亮');
});

test('潮汐（第 38 轮，示意）：只在海边；北边潮差大、南边小；有大潮小潮；满潮干潮交替，时刻和高度对得上', () => {
	assert.equal(hasTide(loc('kalgoorlie')), false, '内陆没有潮汐');
	assert.equal(hasTide(loc('wave-rock')), false);
	for (const id of ['perth', 'fremantle', 'rottnest', 'broome', 'exmouth', 'albany']) assert.equal(hasTide(loc(id)), true, id);
	const ranges = (id: string) => Array.from({ length: YEAR_DAYS }, (_, d) => tideNow(loc(id), at(d, 0)).range);
	const broome = ranges('broome');
	const perth = ranges('perth');
	assert.ok(Math.max(...broome) > 6, `布鲁姆大潮潮差 ${Math.max(...broome).toFixed(1)} 米`);
	assert.ok(Math.max(...broome) > Math.min(...broome) * 2.5, '布鲁姆有大潮小潮');
	assert.ok(Math.max(...perth) < 1, `珀斯潮差不到 1 米（${Math.max(...perth).toFixed(2)}）`);
	assert.ok(Math.min(...broome) > Math.max(...perth), '北边最小的潮差也比珀斯大');
	for (const id of ['broome', 'perth', 'exmouth']) {
		const l = loc(id);
		for (const c of [at(3, 0), at(50, 7), at(90, 18)]) {
			const n = tideNow(l, c);
			assert.equal(n.h, tideHeight(l, c));
			assert.equal(n.next.length, 2, `${id} 30 小时内有两次转潮`);
			assert.notEqual(n.next[0].kind, n.next[1].kind, '满潮干潮交替');
			assert.ok(n.next[0].at > c && n.next[1].at > n.next[0].at);
			// 转潮点真的是极值：前后 5 分钟都不比它高（满潮）/ 低（干潮）
			for (const x of n.next) {
				const sgn = x.kind === 'high' ? 1 : -1;
				assert.ok(sgn * (x.h - tideHeight(l, x.at - 5)) >= 0 && sgn * (x.h - tideHeight(l, x.at + 5)) >= 0, `${id} ${x.kind}`);
			}
			// 涨潮中下一次转潮是满潮
			assert.equal(n.rising, n.next[0].kind === 'high', `${id} 涨潮中下一个是满潮`);
		}
	}
	assert.equal(tideHeight(loc('broome'), at(7, 3)), tideHeight(loc('broome'), at(7, 3)), '可复现');
});

test('山火季（第 39 轮，示意）：南部夏天、北部旱季；下雨降级；灾难性少见且只在内陆炎热天；可复现', () => {
	const jan = at(SEASON_DAYS + 12);
	const aug = at(3 * SEASON_DAYS + 27);
	const jul = at(3 * SEASON_DAYS + 14);
	assert.equal(fireSeason(loc('perth'), jan), true, '珀斯 1 月是山火季');
	assert.equal(fireSeason(loc('perth'), jul), false, '珀斯 7 月不是');
	assert.equal(fireSeason(loc('kununurra'), aug), true, '金伯利 8 月旱季是山火季');
	assert.equal(fireSeason(loc('kununurra'), jan), false, '金伯利 1 月雨季不是');
	assert.equal(fireDanger(loc('perth'), jul, 'hot').id, 'none', '不在山火季没有评级');
	assert.equal(fireDanger(loc('perth'), jan, 'sunny').id, 'high');
	assert.equal(fireDanger(loc('perth'), jan, 'hot').id, 'extreme');
	assert.equal(fireDanger(loc('perth'), jan, 'rain').id, 'none', '下雨降级');
	assert.equal(fireDanger(loc('perth'), jan, 'cloudy').id, 'high');
	assert.ok(['extreme', 'catastrophic'].includes(fireDanger(loc('kalgoorlie'), jan, 'hot').id), '内陆炎热天至少极端');
	// 三年里按真实天气统计：灾难性少见、只出现在内陆；每个地点一年里大部分日子没有评级或只是中等
	let cat = 0;
	for (const l of WA.locations) {
		let none = 0;
		for (let d = 0; d < YEAR_DAYS * 3; d++) {
			const f = fireDanger(l, at(d), weatherOn(l.id, d).id);
			assert.ok(FIRE_LEVELS.includes(f));
			if (f.id === 'catastrophic') { cat++; assert.equal(l.tags.includes('beach') || ['coast', 'port', 'island'].includes(l.kind), false, `${l.id} 海边不出灾难性`); }
			if (f.id === 'none') none++;
		}
		assert.ok(none > YEAR_DAYS * 3 * 0.4, `${l.id} 没有评级的日子 ${none}`);
	}
	assert.ok(cat > 0 && cat < 30, `灾难性一共 ${cat} 天`);
	assert.equal(fireDanger(loc('perth'), jan, 'hot'), fireDanger(loc('perth'), jan, 'hot'));
});

test('紫外线（第 40 轮，示意）：夏天正午最强、夜里为 0；北边冬天也强；云雨减弱；防晒时段和珀斯 SunSmart 的数接近；分级', () => {
	const perth = loc('perth');
	const jan = at(SEASON_DAYS + 12, 0);
	const jul = at(3 * SEASON_DAYS + 14, 0);
	const sj = uvDay(perth, jan + 12 * 60, 'sunny');
	assert.ok(sj.peak >= 11 && sj.peak <= 14, `珀斯 1 月最高 ${sj.peak}`);
	const wj = uvDay(perth, jul + 12 * 60, 'sunny');
	assert.ok(wj.peak >= 3 && wj.peak <= 5, `珀斯 7 月最高 ${wj.peak}`);
	assert.ok(uvDay(loc('broome'), jul, 'sunny').peak >= 6, '布鲁姆冬天也高');
	assert.equal(uvIndex(perth, jan + 2 * 60, 'sunny'), 0, '夜里为 0');
	assert.ok(uvIndex(perth, jan + 12 * 60 + 30, 'rain') < uvIndex(perth, jan + 12 * 60 + 30, 'cloudy'));
	assert.ok(uvIndex(perth, jan + 12 * 60 + 30, 'cloudy') < uvIndex(perth, jan + 12 * 60 + 30, 'sunny'));
	// SunSmart 珀斯 1 月防晒时段约 8:10–16:50
	const [from, to] = sj.protect!;
	assert.ok(Math.abs(from - (8 * 60 + 10)) <= 30 && Math.abs(to - (16 * 60 + 50)) <= 30, `${hhmm(from)}–${hhmm(to)}`);
	assert.equal(uvDay(loc('albany'), jul, 'storm').protect, null, '冬天风暴天不用特别防晒');
	assert.deepEqual([0, 2, 3, 5, 6, 7, 8, 10, 11, 15].map((u) => uvLevel(u).name), ['低', '低', '中等', '中等', '高', '高', '很高', '很高', '极高', '极高']);
	for (const l of WA.locations) for (let h = 0; h < 24; h++) {
		const u = uvIndex(l, jan + h * 60, 'sunny');
		assert.ok(Number.isInteger(u) && u >= 0 && u <= 15, `${l.id} ${h} 点 ${u}`);
	}
});

test('火险提示去重（第 8 批审查问题 2）：本机记录当不可信数据；有上限；提示文字写明是估算', () => {
	assert.deepEqual(parseFireSeen(null), []);
	assert.deepEqual(parseFireSeen('{'), []);
	assert.deepEqual(parseFireSeen('{"a":1}'), []);
	assert.deepEqual(parseFireSeen(JSON.stringify(['perth@3', 'perth@3', 42, '<b>@1', 'x@y', 'broome@10'])), ['perth@3', 'broome@10']);
	let seen: string[] = [];
	for (let d = 0; d < FIRE_SEEN_MAX + 5; d++) seen = addFireSeen(seen, fireKey('perth', d));
	assert.equal(seen.length, FIRE_SEEN_MAX, '只记最近的');
	assert.equal(seen.at(-1), `perth@${FIRE_SEEN_MAX + 4}`);
	assert.deepEqual(addFireSeen(['a@1'], 'bad key'), ['a@1']);
	const t = fireToastText('极端', '远离林区。');
	assert.match(t, /游戏里的估算，不是真实预警/);
	assert.match(t, /Emergency WA/);
});

test('潮汐转潮就在眼前时方向不说反、不漏掉这次转潮（第 8 批审查问题 3）', () => {
	const broome = loc('broome');
	// 审查复现：布鲁姆 01:44 之后约半分钟是干潮，此刻还在退
	const n = tideNow(broome, 104);
	assert.equal(n.rising, false, '还在退潮');
	assert.equal(n.next[0].kind, 'low', '下一个就是这次干潮');
	assert.ok(n.next[0].at <= 106, `干潮在 ${hhmm(n.next[0].at)}`);
	// 一般情况：从现在到下一次转潮之间，潮水一直朝报告的方向走（逐分钟看）
	for (const id of ['broome', 'exmouth', 'perth', 'albany']) {
		const l = loc(id);
		for (let c = 0; c < 3 * 1440; c += 37) {
			const t = tideNow(l, c);
			const sign = t.rising ? 1 : -1;
			for (let m = c + 1; m < t.next[0].at - 1; m++) assert.ok(sign * (tideHeight(l, m) - tideHeight(l, m - 1)) >= -1e-9, `${id} ${c} 到 ${m} 方向不变`);
		}
	}
});

test('顶栏时段补注（第 8 批审查问题 4）：玩法时段和画面天色不一致时说明实际天色', () => {
	assert.equal(phaseNote('dusk', 'dusk'), '');
	assert.equal(phaseNote('dusk', 'night'), '天已经黑了');
	assert.equal(phaseNote('dawn', 'night'), '天还没亮');
	assert.equal(phaseNote('dusk', 'day'), '天还亮着');
	assert.equal(phaseNote('dawn', 'day'), '天已大亮');
	assert.equal(phaseNote('night', 'dusk'), '天快黑了');
	assert.equal(phaseNote('day', 'dawn'), '天刚亮');
});
