// 做饭的界面片段（住处卡里的厨房、地点页的超市）。纯函数，返回 HTML 字符串；所有插入的文字都经过调用方传进来的 esc()。
import {
	cookBlocked, cookQuality, getRecipe, deliveryBlocked, deliveryPrice, freshPantry, getIngredient, groceriesAt, hostBatches, hostBlocked, hostGuests, kitchenLevel, pantryTotal, recipeKnown, unlockLabel,
} from '../core/cooking.ts';
import { dayOf } from '../core/time.ts';
import { HOSTING, PANTRY_MAX, RECIPES } from '../data/cooking.ts';
import type { PlayerState, RecipeDef, Region } from '../core/types.ts';

type Esc = (s: unknown) => string;

const btn = (attrs: string, label: string, why: string | undefined, esc: Esc) =>
	`<button ${attrs} ${why ? `disabled title="${esc(why)}"` : ''}>${label}</button>`;

const needsLabel = (r: RecipeDef, esc: Esc) =>
	Object.entries(r.ingredients).map(([id, n]) => `${getIngredient(id)?.icon ?? ''}${esc(getIngredient(id)?.name ?? id)}×${n}`).join(' ');

/** 住处卡里的厨房：随手做、叫外卖两个按钮，下面折叠食材柜和食谱 */
export function kitchenHtml(s: PlayerState, region: Region, esc: Esc): string {
	const quick = cookBlocked(s, 'quick');
	const delivery = deliveryBlocked(s, region);
	const lv = kitchenLevel(s);
	const rows = freshPantry(s.cooking.pantry, s.clock).rows.slice().sort((a, b) => a.exp - b.exp);
	const today = dayOf(s.clock);
	const pantry = rows.length
		? rows.map((r) => {
				const left = Math.max(0, Math.ceil(r.exp / 1440) - today - 1);
				return `<span class="chip">${getIngredient(r.id)?.icon ?? ''}${esc(getIngredient(r.id)?.name ?? r.id)}×${r.n} · ${left ? `${left} 天后` : '今天'}到期</span>`;
			}).join(' ')
		: '<span class="muted">空的。去超市买点食材回来。</span>';
	const guests = hostGuests(s);
	const recipes = RECIPES.filter((r) => r.cuisine !== 'basic').map((r) => {
		if (!recipeKnown(s, r)) return `<p class="muted" style="margin-top:6px">🔒 ${esc(r.name)} · ${esc(unlockLabel(r))}${r.kitchen > 1 ? ' · 要烤箱' : ''}</p>`;
		const q = cookQuality(s, r);
		const made = s.cooking.made[r.id] ?? 0;
		return `<div class="row" style="margin-top:8px"><span class="ico">${r.icon}</span><span class="body">${esc(r.name)}${made ? ` · 做过 ${made} 次` : ''}<small>${needsLabel(r, esc)} · ${r.minutes} 分钟 · 饱食约 +${Math.round(r.hunger * q)}${r.serves > 1 ? ` · 一锅够 ${r.serves} 人` : ''}</small></span>
			<span class="inline">${btn(`data-cook="${r.id}"`, '做', cookBlocked(s, r.id), esc)}${btn(`data-host="${r.id}"`, `请客${hostBatches(s, r) > 1 ? `（${hostBatches(s, r)} 锅）` : ''}`, hostBlocked(s, r.id), esc)}</span></div>`;
	}).join('');
	return `<div class="inline" style="margin-top:8px">${btn('data-home="cook"', `随手做一顿 $${getRecipe('quick')?.cash ?? 0}`, quick, esc)}${btn('data-home="delivery"', `叫外卖 $${deliveryPrice(s)}`, delivery, esc)}</div>
		${quick || delivery ? `<p style="margin-top:4px">${esc([...new Set([quick, delivery].filter(Boolean))].join('；'))}</p>` : ''}
		<details style="margin-top:8px"><summary class="muted">厨房 · 烹饪 ${Math.floor(s.cooking.xp)} · 食材 ${pantryTotal(s)}/${PANTRY_MAX}${lv ? ` · ${lv >= 2 ? '有烤箱' : '只有炉灶'}` : ' · 还没有炊具'}</summary>
		<p style="margin-top:6px">${pantry}</p>
		<p style="margin-top:6px" class="muted">${guests.length ? `请客能请来：${guests.map((n) => esc(n.name)).join('、')}（关系 +${HOSTING.rel}）` : '这里还没有能请来家里的朋友（关系到「朋友」才会来），请客就请邻居和室友。'}每天请一次。</p>
		${recipes}</details>`;
}

/** 地点页的超市卡：这里能买的食材，每样买 1 份或 4 份 */
export function groceryHtml(s: PlayerState, region: Region, esc: Esc): string {
	const offers = groceriesAt(s, region);
	if (!offers.length) return '';
	const asian = offers.some((o) => o.item.store === 'asian');
	return `<div class="card"><h3>${asian ? '超市 · 亚洲超市' : '超市'}</h3><p>买食材回家照食谱做菜。新鲜的放不久，过期会扔掉。食材柜 ${pantryTotal(s)}/${PANTRY_MAX}。</p>${offers.map(({ item, price, blocked }) => `
		<div class="row" style="margin-top:8px"><span class="ico">${item.icon}</span><span class="body">${esc(item.name)} · $${price}/份${item.store === 'asian' ? ' · 亚洲超市' : ''}<small>${esc(blocked ?? `${item.desc} 保质 ${item.days} 天`)}</small></span>
		<span class="inline">${btn(`data-grocery="${item.id}" data-n="1"`, '×1', blocked, esc)}${btn(`data-grocery="${item.id}" data-n="4"`, `×4 $${price * 4}`, blocked ?? (s.cash < price * 4 ? `需要 $${price * 4}` : pantryTotal(s) + 4 > PANTRY_MAX ? '食材柜放不下 4 份' : undefined), esc)}</span></div>`).join('')}</div>`;
}
