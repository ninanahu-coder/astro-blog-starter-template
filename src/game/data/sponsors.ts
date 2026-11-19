// 本地商户赞助（第一版：只有数据结构和展示，不接支付，不改任何数值）。设计见 docs/earth-game/monetization.md。
// 每一条都对应一份线下签好的赞助协议；协议没签、没付款、没核对店铺身份之前，不得往这里加条目。
// 目前没有任何已签的协议，所以列表是空的。测试用虚构店铺和条目，不放在这里。

export interface SponsorDeal {
	/** 唯一编号，建议 sp-<店铺 id>-<开始年月> */
	id: string;
	/** 对应 wa.venues.json / sa.venues.json 里的店铺 id；只接受 OSM 来源的真实店铺 */
	venueId: string;
	/** 给玩家看的优惠，一句话，例如「出示本页咖啡减 1 澳元」；不得出现网址 */
	offer: string;
	/** 使用条件，例如「每人每天一次，不与其他优惠同用」 */
	terms: string;
	/** 起止日期（含），按珀斯日期 YYYY-MM-DD；一期最长 92 天 */
	start: string;
	end: string;
	/** 线下协议编号（不是网址，不放商户联系方式） */
	agreement: string;
	/** 收费（按协议填，单位：澳分，含 GST）：固定月费 + 每次核销。只用于给商户出对账单，不在游戏里显示 */
	fee: { monthly: number; perRedeem: number };
	/** 每天最多核销多少次（商户自定，防止账单失控）；不填不限 */
	dailyCap?: number;
}

export const SPONSORS: SponsorDeal[] = [];

/** 赞助标签的固定文字：所有赞助都用同一个词，玩家一眼能认出这是付费推广 */
export const SPONSOR_LABEL = '赞助';

/** 不接受赞助的店铺类型：酒吧（玩家可能未成年）、诊所（医疗服务广告另有限制） */
export const SPONSOR_EXCLUDED_TYPES = ['pub', 'clinic'];

export const SPONSOR_RULES = {
	maxDays: 92,
	offerMax: 40,
	termsMax: 80,
	/** 月费、单次核销费的上限（澳分），只用来拦明显填错的数（例如把元写成分的一百倍） */
	monthlyMax: 1_000_000,
	perRedeemMax: 10_000,
	dailyCapMax: 1000,
};
