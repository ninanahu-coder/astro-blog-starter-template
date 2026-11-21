// 画面设置（体验改造 P3，见 docs/earth-game/ux-p3.md）：「标准 / 省电 / 省流量」三档预设，加「跟随系统」。
// 纯函数：只根据设置和系统信号算出这一档该开什么、配图走哪个地址；页面按这个结果决定发不发视频、底图请求。
// 档位只管「这台设备上怎么显示」，不改玩家自己存的单项开关（环境音、底图等），换回标准档时原样恢复。

export type VisualMode = 'auto' | 'standard' | 'battery' | 'data';
export type VisualPreset = Exclude<VisualMode, 'auto'>;

/** 每一档开哪些东西 */
export interface VisualFx {
	/** 地点 AI 短片自动播放（关掉时只显示静态图，不发视频请求） */
	clips: boolean;
	/** 真实地图底图（关掉时用手绘地图，不下地图库和图块） */
	basemap: boolean;
	/** 动画和飞字只留最基本的（等于「减少动画」，玩家把动画明确设成「正常」时听玩家的） */
	calm: boolean;
	/** 配图用 2 倍图（关掉时换成 public/earth/cgi/1x/ 下的一半宽的图） */
	hiDpi: boolean;
	/** 环境音和背景音乐按各自开关放（关掉时这一档下不放，开关本身不动） */
	beds: boolean;
}

export const VISUAL_FX: Record<VisualPreset, VisualFx> = {
	standard: { clips: true, basemap: true, calm: false, hiDpi: true, beds: true },
	battery: { clips: false, basemap: true, calm: true, hiDpi: true, beds: false },
	data: { clips: false, basemap: false, calm: true, hiDpi: false, beds: false },
};

/** 系统信号：浏览器开了省流量（navigator.connection.saveData）、开了减少动态效果 */
export interface SystemHints { saveData: boolean; reduceMotion: boolean }

/** 「跟随系统」时选哪一档：省流量优先（它同时也省电），其次减少动态效果 → 省电，否则标准 */
export function resolvePreset(mode: VisualMode, sys: SystemHints): VisualPreset {
	if (mode !== 'auto') return mode;
	if (sys.saveData) return 'data';
	if (sys.reduceMotion) return 'battery';
	return 'standard';
}

/** 读系统的省流量开关；不支持的浏览器（Safari、火狐）当作没开 */
export function readSaveData(nav: unknown): boolean {
	const c = (nav as { connection?: { saveData?: unknown } } | null | undefined)?.connection;
	return !!c && c.saveData === true;
}

const CGI_2X = /^\/earth\/cgi\/([a-z0-9-]+\.webp)$/;

/** 配图地址：省流量档换成 1 倍图；不是 /earth/cgi/ 下标准格式的地址原样返回（不拼出别的路径） */
export function cgiSrc(url: string, hiDpi: boolean): string {
	if (hiDpi) return url;
	const m = CGI_2X.exec(url);
	return m ? `/earth/cgi/1x/${m[1]}` : url;
}

/** 整张配图清单按档位换地址 */
export function cgiForPreset(images: Readonly<Record<string, string>>, hiDpi: boolean): Record<string, string> {
	const out: Record<string, string> = {};
	for (const [k, v] of Object.entries(images)) if (typeof v === 'string') out[k] = cgiSrc(v, hiDpi);
	return out;
}
