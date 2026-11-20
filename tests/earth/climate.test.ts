// 第 30 批：天气按真实气象站的气候平均（data/climate.ts → core/weather.ts）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AREAS } from '../../src/game/data/areas-base.ts';
import { CLIMATE_ZONES, DEFAULT_STATION, LOC_STATION, MONTH_DAYS, STATIONS, WEATHER_MODEL } from '../../src/game/data/climate.ts';
import { WEATHERS } from '../../src/game/data/weather.ts';
import { climateOf, forecast, monthWeights, realMonth, stationId, stationOf, weatherOn, weightsOn } from '../../src/game/core/weather.ts';
import { realDayOfYear } from '../../src/game/core/sky.ts';
import { dateOf, SEASON_DAYS, YEAR_DAYS } from '../../src/game/core/time.ts';

const LOCS = AREAS.flatMap((a) => a.locations);
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;
const share = (t: [string, number][], ...ids: string[]) => t.filter(([id]) => ids.includes(id)).reduce((s, [, w]) => s + w, 0);

test('气候数据：每个站 12 个月四项齐全、数值合理；站号是 BOM 的 6 位站号；气候区存在', () => {
	assert.ok(Object.keys(STATIONS).length >= 15);
	for (const [id, st] of Object.entries(STATIONS)) {
		assert.match(id, /^\d{6}$/);
		assert.ok(Object.hasOwn(CLIMATE_ZONES, st.zone), `${id} 气候区 ${st.zone}`);
		assert.ok(st.name && st.bom, id);
		for (const k of ['tmax', 'tmin', 'rainDays', 'cloudyDays'] as const) {
			assert.equal(st[k].length, 12, `${id} ${k}`);
			assert.ok(st[k].every((x) => Number.isFinite(x)), `${id} ${k}`);
		}
		for (let m = 0; m < 12; m++) {
			assert.ok(st.tmax[m] > st.tmin[m], `${id} ${m + 1} 月最高温不高于最低温`);
			assert.ok(st.tmax[m] < 45 && st.tmin[m] > -5, `${id} ${m + 1} 月气温离谱`);
			assert.ok(st.rainDays[m] >= 0 && st.rainDays[m] <= MONTH_DAYS[m], `${id} ${m + 1} 月雨日`);
			assert.ok(st.cloudyDays[m] >= 0 && st.cloudyDays[m] <= MONTH_DAYS[m], `${id} ${m + 1} 月阴天日`);
		}
	}
	assert.equal(MONTH_DAYS.reduce((a, b) => a + b, 0), 365);
});

test('抽查：几项数字和 BOM 页面一致（2026-11-20 抓取）', () => {
	assert.deepEqual(STATIONS['003003'].rainDays, [9.4, 9.1, 6.3, 1.9, 1.6, 1.1, 0.5, 0.3, 0.2, 0.3, 0.9, 3.9], '布鲁姆机场雨日');
	assert.deepEqual(STATIONS['009021'].tmax, [31.9, 32.1, 29.9, 25.7, 21.9, 19.1, 18.0, 18.7, 20.4, 22.9, 26.2, 29.3], '珀斯机场最高温');
	assert.deepEqual(STATIONS['023000'].cloudyDays, [7.3, 6.7, 9.5, 13.4, 16.4, 15.1, 17.5, 15.4, 13.6, 14.2, 11.7, 10.6], '阿德莱德阴天日');
	assert.deepEqual(STATIONS['012038'].tmin, [18.4, 18.0, 16.2, 12.8, 8.7, 6.4, 5.1, 5.9, 8.2, 11.3, 14.2, 16.7], '卡尔古利最低温');
});

test('每个游戏地点都登记了气象站，登记的站都存在；没登记的按默认站', () => {
	for (const l of LOCS) assert.ok(Object.hasOwn(LOC_STATION, l.id), `${l.id} 没有登记气象站`);
	for (const [loc, st] of Object.entries(LOC_STATION)) {
		assert.ok(Object.hasOwn(STATIONS, st), `${loc} → ${st} 不存在`);
		assert.ok(LOCS.some((l) => l.id === loc), `${loc} 不是游戏地点`);
	}
	assert.equal(stationId('nowhere'), DEFAULT_STATION);
	assert.equal(stationId('__proto__'), DEFAULT_STATION);
	assert.equal(climateOf('broome').zone, 'tropical');
	assert.equal(climateOf('perth').zoneName, '地中海式');
});

test('游戏日 → 现实月份：和气温用的现实日期一致；南半球夏天是 12–2 月', () => {
	const MD = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
	for (let d = -YEAR_DAYS; d < YEAR_DAYS * 2; d++) {
		let doy = realDayOfYear(d * 1440);
		let m = 0;
		while (doy >= MD[m]) doy -= MD[m++];
		assert.equal(realMonth(d), m + 1, `第 ${d} 天`);
		const want = { spring: [9, 10, 11], summer: [12, 1, 2], autumn: [3, 4, 5], winter: [6, 7, 8] }[dateOf(d * 1440).season];
		assert.ok(want.includes(realMonth(d)), `第 ${d} 天 ${dateOf(d * 1440).season} → ${realMonth(d)} 月`);
	}
	// 每个月在游戏里都有日子
	const months = new Set(Array.from({ length: YEAR_DAYS }, (_, d) => realMonth(d)));
	assert.equal(months.size, 12);
	assert.equal(realMonth(SEASON_DAYS), 12, '夏季第 1 天是 12 月');
});

test('概率表：每站每月合计 1；雨天比例等于 BOM 雨日 / 当月天数；气旋季风暴占比更高；炎热、寒冷按温度门槛', () => {
	const ids = new Set(WEATHERS.map((w) => w.id));
	for (const [id, st] of Object.entries(STATIONS)) {
		for (let m = 1; m <= 12; m++) {
			const t = monthWeights(st, m);
			assert.ok(near(t.reduce((s, [, w]) => s + w, 0), 1), `${id} ${m} 月合计`);
			for (const [w, p] of t) {
				assert.ok(ids.has(w), w);
				assert.ok(p > 0 && p <= 1, `${id} ${m} 月 ${w} ${p}`);
			}
			const wet = st.rainDays[m - 1] / MONTH_DAYS[m - 1];
			assert.ok(near(share(t, 'rain', 'storm'), wet), `${id} ${m} 月雨天比例`);
			const cyc = st.cyclone && (WEATHER_MODEL.cycloneMonths as readonly number[]).includes(m);
			if (wet > 0) assert.ok(near(share(t, 'storm') / wet, cyc ? WEATHER_MODEL.cycloneStormShare : WEATHER_MODEL.stormShare), `${id} ${m} 月风暴占雨天`);
			if (st.tmax[m - 1] <= WEATHER_MODEL.hot.from) assert.equal(share(t, 'hot'), 0, `${id} ${m} 月不该炎热`);
			else assert.ok(share(t, 'hot') > 0, `${id} ${m} 月该有炎热`);
			if (st.tmin[m - 1] >= WEATHER_MODEL.cold.from) assert.equal(share(t, 'cold'), 0, `${id} ${m} 月不该寒冷`);
			else assert.ok(share(t, 'cold') > 0, `${id} ${m} 月该有寒冷`);
			assert.ok(share(t, 'hot') <= WEATHER_MODEL.hot.max + 1e-9 && share(t, 'cold') <= WEATHER_MODEL.cold.max + 1e-9, `${id} ${m} 月炎热/寒冷超过上限`);
			const dry = 1 - wet;
			assert.ok(near(share(t, 'cloudy'), dry * Math.min(1, st.cloudyDays[m - 1] / MONTH_DAYS[m - 1])), `${id} ${m} 月多云`);
		}
	}
});

test('概率表按「地点参照的站 + 当天对应的月份」取，不串月、不串站', () => {
	for (const loc of ['kununurra', 'perth', 'coober-pedy']) {
		for (let d = YEAR_DAYS * 2; d >= -YEAR_DAYS; d -= 5) assert.deepEqual(weightsOn(loc, d), monthWeights(stationOf(loc), realMonth(d)), `${loc} 第 ${d} 天`);
	}
	// 库努纳拉 10 月最高温 39°C：晴天里炎热的比例封顶
	const k = monthWeights(STATIONS['002056'], 10);
	const clear = share(k, 'sunny', 'hot', 'cold');
	assert.ok(near(share(k, 'hot'), clear * WEATHER_MODEL.hot.max), '炎热封顶');
	// 霍克 7 月最低温 3.7°C：晴天（去掉炎热）里寒冷的比例封顶
	const h = monthWeights(STATIONS['019017'], 7);
	assert.ok(near(share(h, 'cold'), share(h, 'sunny', 'cold') * WEATHER_MODEL.cold.max), '寒冷封顶');
});

test('每天的天气都在当天的概率表里（惯性不会把上个月才有的天气带进这个月）', () => {
	for (const l of LOCS) {
		for (let d = 0; d < YEAR_DAYS * 2; d++) {
			const w = weatherOn(l.id, d).id;
			assert.ok(weightsOn(l.id, d).some(([x]) => x === w), `${l.id} 第 ${d} 天 ${w}`);
		}
	}
});

test('同一个站的不同地点（珀斯、弗里曼特尔）各自抽，天气不总一样', () => {
	assert.equal(stationId('perth'), stationId('fremantle'));
	let differ = 0;
	for (let d = 0; d < YEAR_DAYS; d++) if (weatherOn('perth', d).id !== weatherOn('fremantle', d).id) differ++;
	// 两地天气相同的比例应接近「各自独立抽」的期望，而不是几乎总一样
	let same = 0, indep = 0;
	for (let d = 0; d < YEAR_DAYS * 20; d++) {
		if (weatherOn('perth', d).id === weatherOn('fremantle', d).id) same++;
		indep += weightsOn('perth', d).reduce((s, [, p]) => s + p * p, 0);
	}
	assert.ok(same < indep + YEAR_DAYS * 20 * 0.1, `相同 ${same} 天，独立期望 ${indep.toFixed(0)} 天`);
});

test('地区差异：北部湿季多雨、旱季几乎不下；珀斯冬天雨多夏天少；内陆冬天有寒冷、北部没有；奥尔巴尼不炎热', () => {
	const B = STATIONS['003003'];
	assert.ok(share(monthWeights(B, 1), 'rain', 'storm') > 10 * share(monthWeights(B, 8), 'rain', 'storm'), '布鲁姆 1 月 vs 8 月');
	const P = STATIONS['009021'];
	assert.ok(share(monthWeights(P, 7), 'rain', 'storm') > 5 * share(monthWeights(P, 1), 'rain', 'storm'), '珀斯 7 月 vs 1 月');
	assert.ok(share(monthWeights(P, 1), 'hot') > 0.15, '珀斯 1 月有炎热天');
	assert.ok(share(monthWeights(STATIONS['012038'], 7), 'cold') > 0.1, '卡尔古利 7 月有寒冷天');
	for (let m = 1; m <= 12; m++) {
		assert.equal(share(monthWeights(B, m), 'cold'), 0, `布鲁姆 ${m} 月`);
		assert.equal(share(monthWeights(STATIONS['009741'], m), 'hot'), 0, `奥尔巴尼 ${m} 月`);
	}
});

test('长期统计：各月各种天气出现的比例接近概率表（连着几天不改变长期比例）', () => {
	const YEARS = 120;
	for (const loc of ['perth', 'broome', 'kalgoorlie', 'adelaide', 'mount-gambier']) {
		const count: Record<number, Record<string, number>> = {};
		for (let d = 0; d < YEAR_DAYS * YEARS; d++) {
			const m = realMonth(d);
			const w = weatherOn(loc, d).id;
			(count[m] ??= {})[w] = (count[m][w] ?? 0) + 1;
		}
		for (let m = 1; m <= 12; m++) {
			const total = Object.values(count[m]).reduce((a, b) => a + b, 0);
			const day = Array.from({ length: YEAR_DAYS }, (_, d) => d).find((d) => realMonth(d) === m)!;
			for (const [id, p] of weightsOn(loc, day)) {
				const got = (count[m][id] ?? 0) / total;
				assert.ok(Math.abs(got - p) < 0.06, `${loc} ${m} 月 ${id}：${(got * 100).toFixed(1)}% vs ${(p * 100).toFixed(1)}%`);
			}
			for (const id of Object.keys(count[m])) assert.ok(weightsOn(loc, day).some(([x]) => x === id) || count[m][id] / total < 0.06, `${loc} ${m} 月不该有 ${id}`);
		}
	}
});

test('惯性：天气会连着几天（今天和昨天一样的比例明显高于各天独立抽）', () => {
	for (const loc of ['perth', 'adelaide', 'broome']) {
		let same = 0, indep = 0, n = 0;
		for (let d = 1; d < YEAR_DAYS * 40; d++) {
			if (realMonth(d) !== realMonth(d - 1)) continue;
			n++;
			if (weatherOn(loc, d).id === weatherOn(loc, d - 1).id) same++;
			indep += weightsOn(loc, d).reduce((s, [, p]) => s + p * p, 0);
		}
		assert.ok(same / n > indep / n + 0.1, `${loc}：连着 ${(same / n).toFixed(2)} vs 独立 ${(indep / n).toFixed(2)}`);
	}
});

test('预报：从今天起连续几天，和逐天算的一样；不同地点同一天可以不同', () => {
	assert.deepEqual(forecast('perth', 30, 3).map((w) => w.id), [30, 31, 32].map((d) => weatherOn('perth', d).id));
	assert.equal(forecast('albany', 5).length, 3);
	let differ = 0;
	for (let d = 0; d < 60; d++) if (weatherOn('broome', d).id !== weatherOn('albany', d).id) differ++;
	assert.ok(differ > 20);
});

test('画面：寒冷天地上有一层霜，其他天气没有', async () => {
	const { sceneSvg } = await import('../../src/game/ui/scene.ts');
	const base = { phase: 'day' as const, kind: 'outback', tags: [] as string[] };
	assert.match(sceneSvg({ ...base, weather: 'cold' }), /rgba\(238,244,251/);
	for (const w of ['sunny', 'hot', 'rain', 'storm', 'cloudy']) assert.doesNotMatch(sceneSvg({ ...base, weather: w }), /rgba\(238,244,251/, w);
});
