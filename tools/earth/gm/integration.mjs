// GM 沙盒页的 Astro 集成（平衡调试工具）：只在 `astro dev` 时注入 /earth/gm，`astro build` / `preview` / `sync` 什么都不做。
// 这样生产构建里根本没有这条路由，页面文件和 src/game/dev/gm.ts 也不会被打包。
// tests/earth/gm.test.ts 既单测这个钩子，也真跑一次生产构建检查产物。说明见 docs/earth-game/balance-tools.md §4。
import { fileURLToPath } from 'node:url';

export const GM_ROUTE = '/earth/gm';
export const GM_ENTRY = fileURLToPath(new URL('../../../src/game/dev/gm-page.astro', import.meta.url));

/** @returns {import('astro').AstroIntegration} */
export function earthGm() {
	return {
		name: 'earth-gm-dev-only',
		hooks: {
			'astro:config:setup': ({ command, injectRoute, logger }) => {
				if (command !== 'dev') return;
				injectRoute({ pattern: GM_ROUTE, entrypoint: GM_ENTRY, prerender: false });
				logger.info(`GM 沙盒（仅开发环境）：${GM_ROUTE}`);
			},
		},
	};
}
