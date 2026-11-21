// 宠物与野生动物（v31）：数据自洽、领养条件、喂玩遛体检寄养、住房和出行限制、没照顾不惩罚、GPS 跑步联动、存档校验、动作解析；
// 图鉴的天气联动和保护规则。
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyAction, parseAction } from '../../src/game/core/actions.ts';
import { cleanPet, createCharacter, sanitizeState } from '../../src/game/core/character.ts';
import { animalActive, animalHint, animalsAt, getLocation, homesAt, seasonAnimals } from '../../src/game/core/engine.ts';
import { adoptPet, boardPet, dogJoinsRun, neglectDays, petAction, petOffers, petOpBlocked, petStatus, petTravelBlocked } from '../../src/game/core/pets.ts';
import { weatherOn } from '../../src/game/core/weather.ts';
import { EVENTS } from '../../src/game/data/events.ts';
import { HOMES } from '../../src/game/data/housing.ts';
import { MOODLETS } from '../../src/game/data/moodlets.ts';
import { getPetKind, homeAllowsPet, HOME_PETS, PET, PET_KINDS, PET_NO_GO, PET_RULES } from '../../src/game/data/pets.ts';
import { ANIMALS, WILDLIFE_RULES } from '../../src/game/data/wildlife.ts';
import { WA, WORLD } from '../../src/game/data/wa.ts';
import type { Pet, PlayerState, Region, Venue } from '../../src/game/core/types.ts';

const DAY = 1440;
const at = (hour: number, day = 0) => day * DAY + hour * 60;
const make = (over: Partial<PlayerState> = {}): PlayerState => ({
	...createCharacter({ id: 'pet-player', name: '宠', avatar: '🧑', origin: 'student', region: 'wa', spawn: WA.spawn, seed: 5 }),
	needs: { hunger: 90, energy: 90, hygiene: 90, fun: 50, social: 50 },
	clock: at(10),
	cash: 5000,
	home: { type: 'flat', loc: 'perth', furniture: {} },
	...over,
});
const pet = (over: Partial<Pet> = {}, day = 0): Pet => ({ kind: 'dog', name: '豆豆', from: 'shelter', since: day, bond: 50, fedDay: day, playDay: -1, walkDay: -1, vetDay: day, board: null, ...over });
/** 某地点第一个不是风暴也不炎热的游戏日 */
const mildDay = (loc: string, from = 0) => {
	for (let d = from; d < from + 300; d++) {
		const w = weatherOn(loc, d);
		if (!w.closesSea && w.id !== 'hot') return d;
	}
	throw new Error('没有温和的日子');
};
const dayWith = (loc: string, ids: string[], from = 0) => {
	for (let d = from; d < from + 600; d++) if (ids.includes(weatherOn(loc, d).id)) return d;
	throw new Error(`没有 ${ids.join('/')} 的日子`);
};

test('宠物数据：种类唯一、数值为正、能遛的只有狗；每种房型都写明能养什么且只写已知种类；禁行地点存在；规定都有 https 来源', () => {
	assert.equal(new Set(PET_KINDS.map((k) => k.id)).size, PET_KINDS.length);
	for (const k of PET_KINDS) {
		for (const n of [k.adopt, k.food, k.vet, k.board]) assert.ok(n > 0, k.id);
		assert.ok(k.register >= 0 && (k.buy === undefined || k.buy > 0));
		assert.ok(k.names.length > 0 && k.names.every((n) => n.length <= PET.nameMax));
		assert.equal(k.walk, k.id === 'dog');
	}
	for (const h of HOMES) assert.ok(Object.hasOwn(HOME_PETS, h.id), `房型 ${h.id} 要写明能不能养宠物`);
	for (const [h, kinds] of Object.entries(HOME_PETS)) {
		assert.ok(HOMES.some((x) => x.id === h), `HOME_PETS 里的 ${h} 是现有房型`);
		for (const k of kinds) assert.ok(getPetKind(k), `${h} 的 ${k}`);
	}
	for (const l of PET_NO_GO) assert.ok(getLocation(WORLD, l), l);
	for (const r of [...PET_RULES, ...WILDLIFE_RULES]) assert.match(r.source, /^https:\/\/[a-z0-9.-]+\.(gov\.au|com\.au|com)\//, r.id);
	for (const id of ['pet-cuddle', 'dog-walk', 'new-pet']) assert.ok(MOODLETS.some((m) => m.id === id), id);
	assert.ok(homeAllowsPet('some-future-home', 'dog'), '没写的房型默认能养');
});

test('领养：要在城市、要有能养它的住处、钱够；付领养费加登记费，起名过滤，不改入参；已有一只不能再领', () => {
	assert.match(adoptPet(make({ home: null }), WA, 'dog', 'shelter').msg, /住处/);
	assert.match(adoptPet(make({ home: { type: 'room', loc: 'perth', furniture: {} } }), WA, 'dog', 'shelter').msg, /不许养狗/);
	assert.ok(adoptPet(make({ home: { type: 'room', loc: 'perth', furniture: {} } }), WA, 'budgie', 'shelter').ok, '合租房能养小鸟');
	assert.match(adoptPet(make({ loc: 'karijini' }), WA, 'dog', 'shelter').msg, /城市/);
	assert.match(adoptPet(make({ cash: 100 }), WA, 'dog', 'shelter').msg, /\$400/);
	assert.ok(!adoptPet(make(), WA, 'dragon', 'shelter').ok);
	const s = make();
	const before = structuredClone(s);
	const r = adoptPet(s, WA, 'dog', 'shelter', '<b>旺财</b>"');
	assert.ok(r.ok, r.msg);
	assert.deepEqual(s, before, '不改入参');
	const dog = getPetKind('dog')!;
	assert.equal(s.cash - r.state.cash, dog.adopt + dog.register);
	assert.equal(r.state.pet!.name, 'b旺财/b');
	assert.equal(r.state.pet!.bond, PET.startBond);
	assert.ok(r.state.moodlets.some((m) => m.id === 'new-pet'));
	assert.match(adoptPet(r.state, WA, 'cat', 'shelter').msg, /最多养一只/);
	const bought = adoptPet(make(), WA, 'cat', 'breeder');
	assert.equal(make().cash - bought.state.cash, getPetKind('cat')!.buy! + getPetKind('cat')!.register);
	assert.equal(bought.state.pet!.from, 'breeder');
	const unnamed = adoptPet(make(), WA, 'cat', 'shelter', '   ');
	assert.ok(getPetKind('cat')!.names.includes(unnamed.state.pet!.name), '没起名用默认名');
	// 住自己的房子：哪种都能养
	assert.ok(adoptPet(make({ home: { type: 'room', loc: 'perth', furniture: {}, owned: 'x' } }), WA, 'dog', 'shelter').ok);
	assert.equal(petOffers(make({ loc: 'karijini' }), WA).length, 0);
	assert.ok(petOffers(make(), WA).some((o) => o.kind.id === 'dog' && o.from === 'breeder'));
});

test('喂、玩、遛每天一次；只有狗能遛；国家公园、风暴天、炎热天的白天不能遛', () => {
	const d = mildDay('perth');
	const s = make({ clock: at(10, d), pet: pet({}, d - 1) });
	const fed = petAction(s, WA, 'feed');
	assert.ok(fed.ok, fed.msg);
	assert.equal(s.cash - fed.state.cash, getPetKind('dog')!.food);
	assert.match(petAction(fed.state, WA, 'feed').msg, /喂过/);
	const played = petAction(fed.state, WA, 'play');
	assert.ok(played.ok && played.state.needs.fun > fed.state.needs.fun);
	assert.match(petAction(played.state, WA, 'play').msg, /玩累/);
	const walked = petAction(played.state, WA, 'walk');
	assert.ok(walked.ok, walked.msg);
	assert.ok(walked.state.skills.stamina > played.state.skills.stamina, '遛狗涨体能');
	assert.ok(walked.state.moodlets.some((m) => m.id === 'dog-walk'));
	assert.match(petAction(walked.state, WA, 'walk').msg, /遛过/);
	assert.match(petOpBlocked(make({ pet: pet({ kind: 'cat' }) }), WA, 'walk')!, /不用遛/);
	assert.match(petOpBlocked(make({ loc: 'karijini', clock: at(10, mildDay('karijini')), pet: pet() }), WA, 'walk')!, /国家公园/);
	const storm = dayWith('perth', ['storm']);
	assert.match(petOpBlocked(make({ clock: at(10, storm), pet: pet({}, storm) }), WA, 'walk')!, /风暴/);
	const hot = dayWith('perth', ['hot']);
	assert.match(petOpBlocked(make({ clock: at(12, hot), pet: pet({}, hot) }), WA, 'walk')!, /太热/);
	assert.equal(petOpBlocked(make({ clock: at(18, hot), pet: pet({}, hot) }), WA, 'walk'), undefined, '炎热天傍晚可以遛');
});

test('没照顾：好感度按天数扣、不低于 0；宠物不会离开、受伤或死亡；寄养期间不算没照顾', () => {
	const s = make({ clock: at(10, 30), pet: pet({ bond: 50 }, 20) });
	assert.equal(neglectDays(s, s.pet!), 9);
	const r = petAction(s, WA, 'feed');
	assert.equal(r.state.pet!.bond, 50 - 9 * PET.neglectBond + PET.feedBond);
	const long = make({ clock: at(10, 400), pet: pet({ bond: 10 }, 20) });
	const r2 = petAction(long, WA, 'play');
	assert.ok(r2.ok && r2.state.pet, '宠物还在');
	assert.equal(r2.state.pet!.bond, PET.playBond * PET.overdueBondMult, '扣到 0 为止，再加这次（体检过期减半）');
	// 时间走了很多天（睡觉、出行），存档里的宠物原样不动
	const slept = applyAction(make({ clock: at(22, 300), pet: pet({}, 20) }), WA, { t: 'home', op: 'sleep' });
	assert.ok(slept.ok && slept.state.pet?.name === '豆豆');
	assert.equal(neglectDays(make({ clock: at(10, 30), pet: pet({ board: { loc: 'perth', until: 25 } }, 20) }), pet({ board: { loc: 'perth', until: 25 } }, 20)), 0);
});

test('体检：要在有医院的城镇；每 112 天一次，过期时照顾涨的好感度减半', () => {
	assert.match(petOpBlocked(make({ loc: 'karijini', pet: pet() }), WA, 'vet')!, /兽医/);
	const due = make({ clock: at(10, PET.vetEvery), nextWeek: PET.vetEvery + 7, pet: pet({ vetDay: 0, fedDay: PET.vetEvery - 1 }, 0) });
	assert.ok(petStatus(due, WA)!.vetDue);
	assert.equal(petAction(due, WA, 'play').state.pet!.bond, 50 + PET.playBond * PET.overdueBondMult);
	const v = petAction(due, WA, 'vet');
	assert.ok(v.ok, v.msg);
	assert.equal(due.cash - v.state.cash, getPetKind('dog')!.vet);
	assert.ok(!petStatus(v.state, WA)!.vetDue);
});

test('寄养：先付清；寄养中不能喂玩遛；只能在寄养地接；超期补交（钱不够先付能付的）', () => {
	const s = make({ clock: at(10, 5), pet: pet({}, 5) });
	for (const days of [0, PET.boardMaxDays + 1, 1.5]) assert.ok(!boardPet(s, WA, days).ok, `${days} 天`);
	assert.match(boardPet(make({ loc: 'karijini', pet: pet() }), WA, 3).msg, /寄养所/);
	const b = boardPet(s, WA, 3);
	assert.ok(b.ok, b.msg);
	assert.equal(s.cash - b.state.cash, 3 * getPetKind('dog')!.board);
	assert.deepEqual(b.state.pet!.board, { loc: 'perth', until: 8 });
	assert.match(petAction(b.state, WA, 'feed').msg, /在寄养/);
	assert.match(petAction({ ...b.state, loc: 'fremantle' }, WA, 'pickup').msg, /珀斯/);
	const onTime = petAction({ ...b.state, clock: at(10, 7) }, WA, 'pickup');
	assert.ok(onTime.ok && onTime.state.pet!.board === null);
	assert.equal(onTime.state.cash, b.state.cash, '没超期不补钱');
	const late = petAction({ ...b.state, clock: at(10, 10) }, WA, 'pickup');
	assert.equal(b.state.cash - late.state.cash, 2 * getPetKind('dog')!.board);
	const broke = petAction({ ...b.state, cash: 7, clock: at(10, 20) }, WA, 'pickup');
	assert.ok(broke.ok && broke.state.cash === 0 && broke.state.pet, '钱不够也能接回来');
});

test('出行：带着宠物不能坐飞机、不能上罗特内斯特岛；寄养后可以；界面和服务端（applyAction）一致', () => {
	const s = make({ pet: pet() });
	assert.match(petTravelBlocked(s, 'broome', 'air')!, /飞机/);
	assert.match(petTravelBlocked(s, 'rottnest', 'ferry')!, /保护区/);
	assert.equal(petTravelBlocked(s, 'fremantle', 'road'), undefined);
	assert.equal(petTravelBlocked(make({ pet: pet({ board: { loc: 'perth', until: 3 } }) }), 'broome', 'air'), undefined);
	const r = applyAction({ ...s, loc: 'fremantle' }, WA, { t: 'travel', to: 'rottnest', mode: 'ferry' });
	assert.ok(!r.ok && /保护区/.test(r.msg));
	const ok = applyAction({ ...s, loc: 'fremantle', pet: null }, WA, { t: 'travel', to: 'rottnest', mode: 'ferry' });
	assert.ok(ok.ok, ok.msg);
});

test('住房：有狗时合租房和高层公寓租不了，其余可以；送回救助站后就能租', () => {
	const s = make({ home: null, pet: pet() });
	const offers = homesAt(s, WA);
	assert.match(offers.find((o) => o.home.id === 'room')!.blocked!, /不许养狗/);
	assert.equal(offers.find((o) => o.home.id === 'flat')!.blocked, undefined);
	const gone = petAction(s, WA, 'rehome');
	assert.ok(gone.ok && gone.state.pet === null);
	assert.equal(homesAt(gone.state, WA).find((o) => o.home.id === 'room')!.blocked, undefined);
});

test('GPS 联动：真实地点跑步时狗跟着去，算今天遛过；猫不算，国家公园不算', () => {
	const d = mildDay('perth');
	const s = make({ clock: at(10, d), pet: pet({}, d) });
	const msg = dogJoinsRun(s, WA);
	assert.match(msg, /也遛过了/);
	assert.equal(s.pet!.walkDay, d);
	assert.equal(dogJoinsRun(s, WA), '', '一天一次');
	const cat = make({ clock: at(10, d), pet: pet({ kind: 'cat' }, d) });
	assert.equal(dogJoinsRun(cat, WA), '');
	// 走完整的 applyAction：在珀斯的公园跑步
	const park: Venue = { id: 't-dog-park', loc: 'perth', name: '测试公园', lat: -31.944, lon: 115.86, type: 'park', source: 'seed' };
	const R: Region = { ...WA, venues: [park] };
	const now = Date.UTC(2026, 10, 14, 1, 0);
	const r = applyAction(s.pet!.walkDay === d ? { ...s, pet: pet({}, d) } : s, R, { t: 'venue', venue: park.id, op: 'run', lat: park.lat, lon: park.lon, acc: 10 }, now);
	assert.ok(r.ok, r.msg);
	assert.match(r.msg, /也遛过了/);
	assert.equal(r.state.pet!.walkDay, d);
});

test('动作解析：形状不对一律 null；名字只查类型和长度', () => {
	assert.deepEqual(parseAction({ t: 'pet', op: 'adopt', kind: 'dog', from: 'shelter' }), { t: 'pet', op: 'adopt', kind: 'dog', from: 'shelter' });
	assert.deepEqual(parseAction({ t: 'pet', op: 'adopt', kind: 'cat', from: 'breeder', name: '咪' }), { t: 'pet', op: 'adopt', kind: 'cat', from: 'breeder', name: '咪' });
	assert.deepEqual(parseAction({ t: 'pet', op: 'board', days: 3 }), { t: 'pet', op: 'board', days: 3 });
	assert.deepEqual(parseAction({ t: 'pet', op: 'walk' }), { t: 'pet', op: 'walk' });
	for (const bad of [
		{ t: 'pet', op: 'adopt', kind: 'dragon', from: 'shelter' },
		{ t: 'pet', op: 'adopt', kind: 'dog', from: 'street' },
		{ t: 'pet', op: 'adopt', kind: 'dog', from: 'shelter', name: 5 },
		{ t: 'pet', op: 'adopt', kind: 'dog', from: 'shelter', name: 'x'.repeat(41) },
		{ t: 'pet', op: 'board', days: 0 },
		{ t: 'pet', op: 'board', days: PET.boardMaxDays + 1 },
		{ t: 'pet', op: 'board', days: 2.5 },
		{ t: 'pet', op: 'pet' },
		{ t: 'pet', op: 'constructor' },
	]) assert.equal(parseAction(bad), null, JSON.stringify(bad));
	const ok = applyAction(make(), WA, parseAction({ t: 'pet', op: 'adopt', kind: 'dog', from: 'shelter', name: '豆豆' })!);
	assert.ok(ok.ok && ok.state.rev === 1 && ok.state.pet?.name === '豆豆');
});

test('存档校验：不认识的种类丢掉；名字过滤；日期钳到今天以内；寄养地点必须存在、天数有上限；旧存档没有宠物', () => {
	const locs = new Set(WA.locations.map((l) => l.id));
	const clock = at(10, 50);
	assert.equal(cleanPet({ kind: 'dragon' }, clock), null);
	assert.equal(cleanPet('dog', clock), null);
	const p = cleanPet({ kind: 'dog', name: '<img src=x>', bond: 500, since: 999, fedDay: -50, vetDay: 'x', walkDay: 3.7, board: { loc: 'nowhere', until: 51 } }, clock, locs)!;
	assert.equal(p.name, 'imgsrc=x');
	assert.equal(p.bond, 100);
	assert.equal(p.since, 50);
	assert.equal(p.fedDay, -1);
	assert.equal(p.vetDay, 50);
	assert.equal(p.walkDay, 3);
	assert.equal(p.board, null);
	assert.deepEqual(cleanPet({ kind: 'dog', board: { loc: 'perth', until: 9999 } }, clock, locs)!.board, { loc: 'perth', until: 50 + PET.boardMaxDays });
	assert.equal(cleanPet({ kind: 'cat', walkDay: 40, from: 'breeder' }, clock)!.walkDay, -1, '猫没有遛的记录');
	assert.equal(cleanPet({ kind: 'budgie', from: 'breeder' }, clock)!.from, 'breeder');
	const s = sanitizeState({ ...make(), pet: { kind: 'cat', name: '橘子', bond: 40, since: 0, fedDay: 0, playDay: -1, walkDay: -1, vetDay: 0, board: null } }, locs, { fallbackLoc: 'perth', now: Date.now() })!;
	assert.equal(s.pet!.name, '橘子');
	// 经过 sanitizeState 时也走同一套校验
	assert.equal(sanitizeState({ ...make(), pet: { kind: 'dragon', name: 'x' } }, locs, { fallbackLoc: 'perth', now: Date.now() })!.pet, null);
	assert.equal(sanitizeState({ ...make(), pet: { kind: 'cat', name: '<b>喵</b>', bond: 1e9 } }, locs, { fallbackLoc: 'perth', now: Date.now() })!.pet!.name, 'b喵/b');
	const old: Record<string, unknown> = { ...make() };
	delete old.pet;
	assert.equal(sanitizeState(old, locs, { fallbackLoc: 'perth', now: Date.now() })!.pet, null);
});

test('图鉴天气联动：摩托蛙只在雨天夜里、短尾蜥只在晴热的春夏白天、海洋动物风暴天看不到；提示文字和本季限定', () => {
	const frog = ANIMALS.find((a) => a.id === 'motorbike-frog')!;
	const rain = { id: 'rain' };
	assert.ok(animalActive(frog, at(22), rain));
	assert.ok(!animalActive(frog, at(22), { id: 'sunny' }));
	assert.ok(!animalActive(frog, at(12), rain));
	const bob = ANIMALS.find((a) => a.id === 'bobtail')!;
	assert.ok(animalActive(bob, at(12), { id: 'sunny' }));
	assert.ok(!animalActive(bob, at(12, 3 * 28), { id: 'sunny' }), '冬天不出来');
	const dolphin = ANIMALS.find((a) => a.id === 'bottlenose-dolphin')!;
	assert.ok(animalActive(dolphin, at(12), { id: 'sunny' }));
	assert.ok(!animalActive(dolphin, at(12), { id: 'storm', closesSea: true }));
	// animalsAt 用的是那个地点当天的天气
	const storm = dayWith('bunbury', ['storm']);
	assert.ok(!animalsAt(make({ clock: at(12, storm) }), getLocation(WA, 'bunbury')!).some((a) => a.group === 'sea'));
	assert.equal(animalHint(bob), '春、夏季 · 白天 · 晴、炎热天');
	assert.equal(animalHint(ANIMALS.find((a) => a.id === 'quokka')!), '');
	assert.ok(seasonAnimals(at(12)).every((a) => a.seasons!.includes('spring')));
	assert.ok(seasonAnimals(at(12)).some((a) => a.id === 'bobtail'));
	for (const a of ANIMALS) for (const w of a.weather ?? []) assert.ok(['sunny', 'cloudy', 'hot', 'rain', 'storm'].includes(w), `${a.id} 的天气 ${w}`);
});

test('保护规则：有动物的事件里，自己喂或摸野生动物的选项都有代价（罚款或麻烦值）；在工作人员指导下的除外', () => {
	let checked = 0;
	for (const e of EVENTS.filter((x) => x.animal)) {
		for (const c of e.choices) {
			if (!/喂|摸/.test(c.label) || /志愿者|护林员|指导/.test(c.label)) continue;
			checked++;
			for (const o of [c.ok, c.fail].filter(Boolean)) assert.ok((o!.fx.cash ?? 0) < 0 || (o!.fx.heat ?? 0) > 0, `${e.id}「${c.label}」`);
		}
	}
	assert.ok(checked > 0, '至少检查到短尾矮袋鼠那一条');
});
