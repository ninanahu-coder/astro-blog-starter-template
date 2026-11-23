// 「运动」卡（今天页）：各项准备度、本区域 28 天内的比赛、俱乐部、最近成绩。
// 只拼 HTML，不改存档；所有文字插值经过调用方传入的 esc()。规则见 core/sports.ts。
import type { PlayerState, Region } from '../core/types.ts';
import { getLocation } from '../core/engine.ts';
import { clubBonusFor, clubSessionBlocked, clubsAt, fmtSecs, formOf, getClub, getRace, getSport, raceOdds, racesSoon } from '../core/sports.ts';
import { dateLabel, dayOf, hoursLabel } from '../core/time.ts';
import { MEDALS, SPORT_RULES, SPORTS } from '../data/sports.ts';

type Esc = (s: unknown) => string;

export function sportsCard(s: PlayerState, region: Region, esc: Esc): string {
	const soon = racesSoon(s, region);
	const clubsHere = clubsAt(s);
	const club = s.sport.club;
	const clubDef = club ? getClub(club.id) : undefined;
	const results = s.sport.results.slice(0, 5);
	const forms = SPORTS.map((sp) => ({ sp, v: Math.round(formOf(s, sp.id)) })).filter((x) => x.v > 0 || s.sport.total[x.sp.id]);
	if (!soon.length && !clubsHere.length && !clubDef && !results.length && !forms.length) return '';
	const today = dayOf(s.clock);
	const locName = (id: string) => getLocation(region, id)?.name ?? id;
	const btn = (op: string, id: string, label: string, blocked?: string) => `<button data-sport="${op}" data-sport-id="${esc(id)}"${blocked ? ` disabled title="${esc(blocked)}"` : ''}>${esc(label)}</button>`;

	const formHtml = forms.length
		? `<p>准备度：${forms.map(({ sp, v }) => `${sp.icon} ${esc(sp.name)} ${v}`).join(' · ')}</p>`
		: '<p>还没开始练。跑步、游泳、健身、冲浪、骑车都会攒准备度。</p>';

	const raceRows = soon.map((o) => {
		const r = o.race;
		const when = o.startsIn === 0 ? '今天' : `${o.startsIn} 天后（${dateLabel((today + o.startsIn) * 1440)}）`;
		const where = r.locs.length > 1 ? `${r.locs.filter((l) => getLocation(region, l)).map(locName).join('、')}等地` : locName(r.locs[0]);
		const dist = r.km ? `${r.km} 公里` : '分轮次打分';
		const fee = r.fee ? `报名费 $${o.fee}${o.startsIn === 0 ? '（现场）' : ''}` : '免费';
		const odds = raceOdds(s, r);
		const status = o.done ? '这一届已经比过了' : o.entered ? `已报名 · 完赛把握约 ${odds.finish}%，上领奖台约 ${odds.podium}%` : `完赛把握约 ${odds.finish}%`;
		const ref = r.ref ? ` 参照：${r.ref.name}（${r.ref.date}，${r.ref.status}）。` : '';
		const buttons = [
			r.fee > 0 && !o.entered && !o.done ? btn('enter', r.id, `报名 $${o.fee}`, o.enterBlocked) : '',
			o.startsIn === 0 && !o.done ? btn('race', r.id, '参赛', o.raceBlocked) : '',
		].join('');
		const why = o.startsIn === 0 && !o.done && o.raceBlocked ? o.raceBlocked : !o.entered && !o.done && r.fee > 0 && o.enterBlocked && o.enterBlocked !== '已报名' ? o.enterBlocked : '';
		return `<div style="margin-top:10px"><div class="row"><span class="ico">${r.icon}</span><span class="body">${esc(r.name)} · ${esc(when)}<small>${esc(`${where} · ${dist} · 发令 ${hoursLabel(r.start)} · ${fee}。${status}${why ? `（${why}）` : ''}。${r.desc}${ref}`)}</small></span></div>${buttons ? `<div class="inline" style="margin-top:6px">${buttons}</div>` : ''}</div>`;
	}).join('');

	let clubHtml = '';
	if (clubDef && club) {
		const left = club.until - today;
		const why = clubSessionBlocked(s, region);
		const bonus = clubBonusFor(s, clubDef.sport);
		clubHtml = `<p style="margin-top:10px">${clubDef.icon} ${esc(clubDef.name)} · ${esc(left > 0 ? `会员还剩 ${left} 天` : '会费已到期')} · 训练课 ${hoursLabel(clubDef.meet)} 在${esc(locName(clubDef.loc))}。队友：${clubDef.mates.map((m) => `${m.icon} ${esc(m.name)}`).join('、')}。${bonus ? esc(`最近练过，同项目比赛 +${bonus}。`) : ''}</p>
			<div class="inline" style="margin-top:6px">${btn('club', clubDef.id, '上训练课', why)}${clubDef.loc === s.loc ? btn('join', clubDef.id, `续费 $${clubDef.fee}`, s.cash < clubDef.fee ? '钱不够' : undefined) : ''}${btn('quit', clubDef.id, '退出')}</div>${why && left > 0 ? `<p class="muted">${esc(why)}</p>` : ''}`;
	}
	const joinable = clubsHere.filter((c) => c.id !== club?.id);
	if (joinable.length) {
		clubHtml += joinable.map((c) => `<div class="row" style="margin-top:8px"><span class="ico">${c.icon}</span><span class="body">${esc(c.name)} · $${c.fee}/${SPORT_RULES.clubDays} 天<small>${esc(`${getSport(c.sport)?.name ?? ''} · 训练课 ${hoursLabel(c.meet)} · ${c.desc}${club ? ' 加入后会退出现在的俱乐部。' : ''}`)}</small></span>${btn('join', c.id, '加入', s.cash < c.fee ? '钱不够' : undefined)}</div>`).join('');
	}

	const resHtml = results.length
		? `<p style="margin-top:10px">最近成绩：${results.map((x) => `${MEDALS[x.medal].icon} ${esc(getRace(x.race)?.name ?? x.race)}${x.secs ? ` ${fmtSecs(x.secs)} 第 ${x.place.toLocaleString()} 名` : ' 未完赛'}`).join('；')}</p>`
		: '';
	const upcoming = soon.filter((o) => !o.done).length; // 和地点抽屉的摘要一致：比过的不算
	const open = soon.some((o) => o.startsIn === 0 && !o.done) ? ' open' : '';
	return `<details class="card"${open}><summary><h3 style="display:inline">🏅 运动和比赛</h3> <span class="muted">${upcoming ? `${upcoming} 场比赛快到了` : ''}</span></summary>
		${formHtml}<p class="muted">歇 ${SPORT_RULES.graceDays} 天后准备度每天掉 ${SPORT_RULES.decayPerDay}；比赛时准备度 × ${SPORT_RULES.formWeight} 加进检定分。数值待平衡。</p>
		${raceRows}${clubHtml}${resHtml}</details>`;
}
