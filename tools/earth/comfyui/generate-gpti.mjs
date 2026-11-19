#!/usr/bin/env node
// 用 GPT image 2（gpt-image-2-skill，走 Codex 账号）生成 CGI 素材：提示词和 ComfyUI 版共用 prompts.mjs。
// 原图（1536×1024 PNG）放 tools/earth/comfyui/.raw/（不进仓库），网页用的压成 960 宽 WebP 写进 public/earth/cgi/，并更新 manifest.json。
//
//   npm run earth:cgi:gpti -- --only=perth,event:whale-shark
//
// 可选：--force（覆盖已有）、--jobs=3（同时几张）、--dry-run、--skip-existing-raw=false。
// 需要：gpt-image-2-skill（~/.claude/skills/gpt-image-2-skill，或 GPTI_CLI 指向它的 .cjs）、cwebp。
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildJobs } from './prompts.mjs';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '../../../public/earth/cgi');
const rawDir = join(here, '.raw');
const manifestPath = join(outDir, 'manifest.json');
const cli = process.env.GPTI_CLI || join(homedir(), '.claude/skills/gpt-image-2-skill/scripts/gpt_image_2_skill.cjs');
// Codex 账号通道只认新模型，默认 gpt-5.4 会报 model_not_found
const model = process.env.GPTI_MODEL || 'gpt-5.6-sol';
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const only = opt('only')?.split(',');
const parallel = Math.max(1, Math.min(4, Number(opt('jobs') ?? 3)));

let jobs = buildJobs().map((j) => ({ ...j, webp: j.file.replace(/\.png$/, '.webp') }));
if (only) jobs = jobs.filter((j) => only.includes(j.key));
if (flag('dry-run')) {
	for (const j of jobs) console.log(`${j.key} → ${j.webp}\n  ${j.prompt}\n`);
	console.log(`${jobs.length} 个任务（dry-run）。`);
	process.exit(0);
}
if (!existsSync(cli)) {
	console.error(`找不到 gpt-image-2-skill：${cli}（可用 GPTI_CLI 指定）`);
	process.exit(1);
}

mkdirSync(outDir, { recursive: true });
mkdirSync(rawDir, { recursive: true });
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { images: {} };
manifest.images ??= {};
const save = () => writeFileSync(manifestPath, JSON.stringify({ ...manifest, images: Object.fromEntries(Object.entries(manifest.images).sort()) }, null, 2) + '\n');

async function one(job) {
	const raw = join(rawDir, job.file);
	const dest = join(outDir, job.webp);
	if (existsSync(dest) && !flag('force')) {
		manifest.images[job.key] = `/earth/cgi/${job.webp}`;
		return 'skip';
	}
	if (!existsSync(raw) || flag('force')) {
		const { stdout } = await run('node', [cli, '--json', '--provider', 'codex', 'images', 'generate', '-m', model, '--prompt', job.prompt, '--out', raw, '--format', 'png', '--size', '1536x1024', '--quality', 'high'], { maxBuffer: 16 << 20, timeout: 15 * 60_000 });
		const res = JSON.parse(stdout);
		if (res.ok === false || !existsSync(raw)) throw new Error(JSON.stringify(res.error ?? res).slice(0, 300));
	}
	await run('cwebp', ['-quiet', '-q', '75', '-resize', '960', '0', '-metadata', 'none', raw, '-o', dest]);
	manifest.images[job.key] = `/earth/cgi/${job.webp}`;
	save(); // 每张落盘一次，中断可续跑
	return 'done';
}

let done = 0, failed = 0, next = 0;
async function worker() {
	while (next < jobs.length) {
		const job = jobs[next++];
		const t = Date.now();
		try {
			const r = await one(job);
			if (r === 'done') { done++; console.log(`完成 ${job.key}（${Math.round((Date.now() - t) / 1000)} 秒）`); }
		} catch (e) {
			failed++;
			// CLI 出错时 stdout 里是 JSON 的 error，比命令行回显有用
			let why = String(e.message ?? e);
			try { why = JSON.stringify(JSON.parse(e.stdout).error); } catch {}
			console.log(`失败 ${job.key}：${why.slice(0, 300)}`);
		}
	}
}
await Promise.all(Array.from({ length: parallel }, worker));
save();
console.log(`\n新生成 ${done} 张，失败 ${failed} 张，manifest 共 ${Object.keys(manifest.images).length} 项。`);
process.exit(failed ? 1 : 0);
