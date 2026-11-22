// 「待平衡」数值面板（平衡调试工具）：扫出代码里所有标了「待平衡」的地方，给出位置、当前值、所属系统。
// 只读源码文本，不 import 游戏模块（各分支的数据文件形状不同，文本扫描最稳）。说明见 docs/earth-game/balance-tools.md §3。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const MARKER = '待平衡';

/**
 * 标记覆盖的范围：
 * - inline：标记写在一行代码的行尾注释里，当前值就是这一行；
 * - field：标记写在类型字段的注释里（如 `chance: number; // …待平衡`），每条数据各有各的值，面板只指出字段；
 * - decl：独立的注释，紧接着是一个声明（const / function / 对象属性），当前值取那一行；
 * - block：数组或对象中间的分段注释（如「第 24 轮新增，待平衡」），覆盖到下一个分段注释为止，当前值取第一行；
 * - file：文件开头的说明注释，整个文件的数值都算。
 */
export type TuningKind = 'inline' | 'field' | 'decl' | 'block' | 'file';

export interface TuningItem {
	system: string;
	file: string;
	line: number;
	kind: TuningKind;
	/** 当前值：那一行代码去掉注释后的文本（最多 160 字）；file 和 field 没有单一的值，为空 */
	value: string;
	/** 那一行代码里的数字（方便 Codex 直接比对）；没有就是空数组 */
	numbers: number[];
	/** 值所在的行（inline 就是 line） */
	valueLine: number | null;
	/** 标记所在的注释原文 */
	note: string;
}

/** 文件 → 系统。按文件名（去掉扩展名）匹配；没列出的就用文件名本身，免得新文件被漏掉 */
export const SYSTEM_BY_FILE: Record<string, string> = {
	activities: '活动', achievements: '成就', 'areas-base': '地图与出行', 'wa-base': '地图与出行', 'sa-base': '地图与出行',
	careers: '职业', certs: '证书', character: '出身与初始属性', coop: '共同事件', courses: '课程', economy: '经济', finance: '金融',
	events: '事件', 'events-sa': '事件（南澳）', 'venue-events': '事件（到店）', experiences: '体验', festivals: '节日', fish: '钓鱼',
	furniture: '家具', housing: '住房', items: '物品与商店', moodlets: '心情', 'npc-duos': 'NPC', npcs: 'NPC', 'photo-quests': '拍照任务',
	properties: '房产', story: '主线', vehicles: '车辆', venues: '真实地点', weather: '天气', weekly: '周目标', wildlife: '野生动物', wishes: '心愿',
	attributes: '属性', engine: '规则引擎', actions: '规则引擎', time: '时间', social: '社交', trade: '玩家交易', daily: '每日奖励',
};

export function systemOf(file: string): string {
	const base = file.split(/[\\/]/).pop()!.replace(/\.(ts|json|mjs|js)$/, '');
	return SYSTEM_BY_FILE[base] ?? base;
}

const isCommentLine = (l: string) => /^\s*(\/\/|\/\*|\*|\*\/)/.test(l);
const isBlank = (l: string) => !l.trim();

/** 把一行拆成代码部分和注释部分（不处理字符串里的 //，数据文件里的 URL 都在字符串里，所以只认「空白 + //」） */
function splitComment(l: string): { code: string; comment: string } {
	const m = /(^|\s)(\/\/.*)$/.exec(l);
	if (!m) return { code: l, comment: '' };
	return { code: l.slice(0, m.index + m[1].length), comment: m[2] };
}

function numbersIn(code: string): number[] {
	// 去掉字符串里的内容（名字、说明里的数字不是数值）
	const bare = code.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g, "''");
	return [...bare.matchAll(/(?<![\w.$])-?\d[\d_]*(?:\.\d+)?(?:e-?\d+)?/gi)].map((m) => Number(m[0].replace(/_/g, '')));
}

const trimValue = (code: string) => {
	const t = code.trim().replace(/,$/, '');
	return t.length > 160 ? t.slice(0, 157) + '…' : t;
};

/** 扫一个文件的文本。file 是相对仓库根目录的路径（只用来填结果） */
export function scanText(file: string, text: string): TuningItem[] {
	const lines = text.split('\n');
	const items: TuningItem[] = [];
	// 第一行不是注释、也不是空行的位置：在它之前的注释算文件说明
	const firstCode = lines.findIndex((l) => !isBlank(l) && !isCommentLine(l) && !/^\s*import\b/.test(l));
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i];
		if (!l.includes(MARKER)) continue;
		const base = { system: systemOf(file), file, line: i + 1 };
		if (!isCommentLine(l)) {
			const { code, comment } = splitComment(l);
			// 标记也可能写在字符串里（例：物品说明里的「数值待平衡」），同样算这一行；note 里取标记前后一段原文
			const at = l.indexOf(MARKER);
			const where = comment.includes(MARKER) ? comment.trim() : `…${l.slice(Math.max(0, at - 40), at + MARKER.length + 4).trim()}…`;
			const field = /^\s*\w+\??\s*:\s*(number|string|boolean|readonly|Record|Partial|\{|\[|[A-Z]\w*)[^=]*;\s*$/.test(code);
			items.push({ ...base, kind: field ? 'field' : 'inline', value: field ? '' : trimValue(code), numbers: field ? [] : numbersIn(code), valueLine: field ? null : i + 1, note: where });
			continue;
		}
		// 注释行：注释可能跨几行（/** … */），找到注释结束后第一行代码
		let j = i;
		while (j < lines.length && (isCommentLine(lines[j]) || isBlank(lines[j]))) j++;
		const note = l.trim();
		if (firstCode < 0 || i < firstCode) {
			items.push({ ...base, kind: 'file', value: '', numbers: [], valueLine: null, note });
			continue;
		}
		const next = lines[j] ?? '';
		let code = splitComment(next).code;
		// 分段注释后面常是多行对象的「{」：往下拼到这个对象的第一处「}」，最多 6 行
		if (/^\s*\{\s*$/.test(code)) {
			const parts = [code.trim()];
			for (let k = j + 1; k < Math.min(lines.length, j + 7); k++) {
				parts.push(splitComment(lines[k]).code.trim());
				if (lines[k].includes('}')) break;
			}
			code = parts.join(' ');
		}
		const decl = /^\s*(export\s+)?(const|let|function|interface|type|class)\b/.test(next) || /^\s*\w+\??\s*[:=]/.test(next);
		items.push({ ...base, kind: decl ? 'decl' : 'block', value: trimValue(code), numbers: numbersIn(code), valueLine: j < lines.length ? j + 1 : null, note });
	}
	return items;
}

function walk(dir: string, out: string[]) {
	for (const name of readdirSync(dir)) {
		if (name === 'node_modules' || name.startsWith('.')) continue;
		const p = join(dir, name);
		if (statSync(p).isDirectory()) walk(p, out);
		else if (/\.(ts|mjs|js)$/.test(name)) out.push(p);
	}
}

/** 扫仓库：默认只扫 src/game（规则和数据）。dirs 可以换成别的目录（相对 root） */
export function scanTuning(root: string, dirs: string[] = ['src/game']): TuningItem[] {
	const files: string[] = [];
	for (const d of dirs) walk(join(root, d), files);
	files.sort();
	return files.flatMap((f) => scanText(relative(root, f).split(sep).join('/'), readFileSync(f, 'utf8')));
}

// ---------- 输出 ----------

const KIND_LABEL: Record<TuningKind, string> = { inline: '这一行', field: '字段（各条数据）', decl: '下一行的声明', block: '这一段', file: '整个文件' };

export function tuningMarkdown(items: TuningItem[]): string {
	const bySys = new Map<string, TuningItem[]>();
	for (const it of items) bySys.set(it.system, [...(bySys.get(it.system) ?? []), it]);
	const out = [
		'# 待平衡数值面板',
		'',
		`由 \`npm run earth:tuning\` 生成：src/game 下 ${items.length} 处「${MARKER}」标记，${bySys.size} 个系统。范围列说明标记覆盖多大：「这一行」「下一行的声明」的当前值就是那一行；「这一段」「整个文件」「字段」要打开文件看全。`,
		'',
		'| 系统 | 处数 |',
		'| --- | --- |',
		...[...bySys].sort((a, b) => b[1].length - a[1].length).map(([s, xs]) => `| ${s} | ${xs.length} |`),
		'',
	];
	const cell = (s: string) => s.replace(/\|/g, '\\|');
	for (const [sys, xs] of [...bySys].sort((a, b) => a[0].localeCompare(b[0], 'zh'))) {
		out.push(`## ${sys}`, '', '| 位置 | 范围 | 当前值 | 标注 |', '| --- | --- | --- | --- |');
		for (const it of xs) {
			const val = it.value ? `\`${cell(it.value)}\`${it.valueLine && it.valueLine !== it.line ? `（第 ${it.valueLine} 行）` : ''}` : '—';
			out.push(`| ${it.file}:${it.line} | ${KIND_LABEL[it.kind]} | ${val} | ${cell(it.note)} |`);
		}
		out.push('');
	}
	return out.join('\n');
}

export function tuningCsv(items: TuningItem[]): string {
	const c = (v: string | number | null) => {
		const s = v === null ? '' : String(v);
		return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	return ['system,file,line,kind,value_line,value,numbers,note', ...items.map((it) => [it.system, it.file, it.line, it.kind, it.valueLine, it.value, it.numbers.join(' '), it.note].map(c).join(','))].join('\n') + '\n';
}
