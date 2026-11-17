// 天象（第 8 批）：游戏日期对应现实日期、气温、日出日落、潮汐、山火、紫外线。全部是公式，只做显示
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hhmm, realDateLabel, realDayOfYear, skyPhase, sunElevation, sunTimes, temps } from '../../src/game/core/sky.ts';
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
