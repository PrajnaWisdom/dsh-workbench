# dsh-workbench

DeepSeek Harness (DSH) 自定义看板/工作台插件：把对话里整理出的分析结论、指标、明细保存为看板，在会话头部「看板」视图标签页里全屏查看。持久化，重启不丢。

## 功能

- **对话生成看板**：告诉助手「把刚才的分析做成看板保存」，即调用 `workbench_save` 持久化（组件类型 markdown / metrics / table / text）。
- **看板视图**：会话头部「看板」标签页，列表 → 详情、删除。
- **Token 消耗面板**：内置「Token 消耗」看板，实时统计活跃会话的 token 用量（输入 / 输出 / 缓存读写）。
- **文件化渲染**：看板由 `view.html` / `workbench.css` / `workbench.js` 渲染，改样式不碰插件代码、改完刷新即生效。
- **一个看板一个文件夹**：数据存 `$DSH_HOME/workbenches/<id>/dashboard.json`，删除 = 删文件夹。

## 结构

- `lib/index.js` — Host 半区：模型工具（workbench_save / list / delete / tokens）+ `/api/dsh-workbench/*` 路由。
- `lib/client.js` — Client 半区：会话头部「看板」视图标签。
- `standalone/` — 看板渲染文件（view.html / workbench.css / workbench.js + 离线预览 index.html / data.js）。
- `cordis.patch.yml` — 组合补丁：insert `ui-dsh-workbench` 行。

## 安装

1. 把本包装进 DSH web profile 的 node_modules，并在 profile 的 `cordis.patch.yml` 加：

   ```yaml
   - insert:
       - id: ui-dsh-workbench
         name: '@dsh-desktop/dsh-workbench'
   ```

2. 重启 DSH。

## 模型工具

| 工具 | 作用 |
| --- | --- |
| `workbench_save` | 保存看板（markdown/metrics/table/text 组件） |
| `workbench_list` | 列出已保存看板 |
| `workbench_delete` | 按 id 删除看板 |
| `workbench_tokens` | 查询活跃会话 token 消耗 |
