// 金融资产（第 25 批，设计见 docs/earth-game/economy-design.md 第 11 节）。drift / vol / fee 全部待平衡。
// 现实参照（只作量级参考，不是照搬）：
//   - 澳股：Vanguard 指数图表 30 年（至 2023-06-30）澳洲股票年均回报 9.2%；ASX 200 长期年化波动约 12.5%–16%（Infocus / SMS Magazine）
//   - 现金：RBA 现金利率 2026-11-04 起 4.85%，储蓄利率通常低于它
//   - 黄金：Perth Mint 回购价 2026-11-03 约 A$5,472/盎司（约 A$176/克）
//   - 比特币：2026 年 30 天实现波动率月末读数 21%–73%，VanEck 给的长期平均约 80%
// 虚拟币是游戏内虚构的币种，和任何真实加密货币无关，不能兑换真钱。
import type { AssetDef } from '../core/types.ts';

export const ASSETS: AssetDef[] = [
	{ id: 'savings', name: '高息储蓄', icon: '🏦', kind: 'cash', start: 1, drift: 0.03, vol: 0, fee: 0, desc: '随存随取，不会亏，利息按天算。' },
	{ id: 'asx-index', name: '澳股指数基金', icon: '📈', kind: 'stock', start: 100, drift: 0.06, vol: 0.16, fee: 0.005, desc: '一篮子澳洲大公司的股票。长期往上走，短期会跌。' },
	{ id: 'gold', name: '金条（克）', icon: '🥇', kind: 'metal', start: 140, drift: 0.03, vol: 0.15, fee: 0.02, desc: '按克计价的小金条。买卖差价大，适合放着不动。' },
	{ id: 'emu-coin', name: '鸸鹋币', icon: '🪙', kind: 'crypto', start: 50, drift: 0, vol: 0.8, fee: 0.02, desc: '游戏里虚构的虚拟币，一天涨跌一两成都正常，也可能跌掉大半。不能兑换真钱。' },
];

/** 每笔买入至少多少钱 */
export const ASSET_MIN_TRADE = 10;
/** 每次买卖花的游戏时间（分钟） */
export const ASSET_TRADE_MINUTES = 10;
/** 发给客户端多少天的行情（含今天），界面画走势用 */
export const QUOTE_DAYS = 30;
/** 行情最多算到第几天，之后价格不再变（防止损坏的存档让计算量失控；约 55 年） */
export const MARKET_DAYS_MAX = 20000;
