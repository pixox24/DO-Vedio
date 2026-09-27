<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 项目更新记录

本仓库右上角有一个「项目更新」页面（路由 `/changelog`），按版本记录项目的重大更新。接手项目时，先读这个页面了解项目已有的能力与演进历史。

- 页面只渲染 `lib/changelog.ts` 中的数据，不要在页面组件里写死内容。
- 完成一个**重大功能**（新功能、重要体验优化、架构调整、不兼容变更）后，必须在 `lib/changelog.ts` 的 `changelog` 数组**最前面**新增一条记录（按时间倒序）：
  - `version`：语义化版本号；`date`：`YYYY-MM-DD`；`title`：版本主题；`summary`：一两句话概括。
  - `items`：按已有分类 `feature` / `improvement` / `fix` / `infra` 归类，每条用小标题 + 一句说明描述「做了什么、对用户意味着什么」。
  - 一次功能可跨多个分类；同分类下可以有多条。
- 小的文案修补、格式化、依赖升级、重构且无行为变化，无需记录。
- 改完后运行 `npm run typecheck` 与 `npm run lint`，并确认 `/changelog` 页面正常渲染。
