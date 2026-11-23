// @ts-check
import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

import cloudflare from "@astrojs/cloudflare";
// GM 沙盒页只在 astro dev 时注入（docs/earth-game/balance-tools.md §4）
import { earthGm } from "./tools/earth/gm/integration.mjs";

// https://astro.build/config
export default defineConfig({
	site: "https://example.com",
	integrations: [mdx(), sitemap(), earthGm()],
	adapter: cloudflare({
		platformProxy: {
			enabled: true,
		},
		workerEntryPoint: {
			path: "src/worker.ts",
			namedExports: ["BaccaratTable", "EarthWorld"],
		},
	}),
});
