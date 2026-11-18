// 声望这类可能带 .5 的数（平衡分析第九轮后共同事件声望是 0.5）：保留一位小数，整数不带「.0」
export function fmtHalf(n: number): string {
	const r = Math.round(n * 10) / 10;
	return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
