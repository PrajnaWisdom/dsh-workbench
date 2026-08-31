/* ============================================================
 * data.js — 看板数据（改内容只动这里）
 *
 * 这是示例数据：把 window.DASHBOARD 换成你自己的看板即可。
 * 结构与插件里 workbench_save 保存的格式完全一致。
 * ============================================================ */

window.DASHBOARD = {
  title: '「看板插件持久化」分析看板',
  description: '把「动态插件重启即失」的根因分析与持久化改造方案整理成看板，便于回查。',
  columns: 2,
  widgets: [
    {
      type: 'metrics',
      title: '改造概览',
      items: [
        { label: '模型工具', value: '3 个' },
        { label: 'HTTP 路由', value: '3 条' },
        { label: '插件文件', value: '4 个' },
        { label: '验证通过', value: '6/6 项' },
      ],
    },
    {
      type: 'markdown',
      title: '根因与结论',
      content: '**根因**：动态 Cordis 插件只存活于当前 DSH 进程，进程一重启即被清空；之前「看不到按钮」正是因为 DSH 重启后动态插件 `wbk-1` 丢失。\n\n**方案**：改写成真正的持久化插件（npm 包 `@dsh-desktop/dsh-workbench`），写进 DSH web profile 的 `cordis.patch.yml`，随进程启动加载。\n\n**双半区**：Host 注册 3 个模型工具 + `/api/dsh-workbench/*` 路由；Client 挂会话头部/侧边栏入口 + 浮动面板。\n\n**持久化**：看板数据落盘到 `dsh-home/workbench.json`，跨重启保留。',
    },
    {
      type: 'table',
      title: '插件文件结构',
      columns: ['文件', '半区', '职责'],
      rows: [
        ['package.json', '元数据', 'dsh.client 浏览器半区 + main Host 半区'],
        ['cordis.patch.yml', '组合', 'insert ui-dsh-workbench 插件行'],
        ['lib/index.js', 'Host', '3 工具 + 3 路由 + 持久化'],
        ['lib/client.js', 'Client', '头部/侧边栏入口 + 看板面板'],
      ],
    },
    {
      type: 'text',
      title: '使用说明',
      content: '打开看板：会话标题行「▦ 看板」按钮，或侧边栏底部「看板」入口。\n\n生成新看板：在对话里说「把……做成看板保存」，助手即调用 workbench_save 落盘。',
    },
  ],
};
