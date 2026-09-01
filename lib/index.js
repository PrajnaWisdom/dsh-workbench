// @dsh-desktop/dsh-workbench — host half
// Custom dashboard/workbench: registers three model tools (workbench_save /
// workbench_list / workbench_delete) plus the /api/dsh-workbench route family
// that the browser half consumes. Each dashboard is its own folder under
// $DSH_HOME/workbenches/<id>/dashboard.json — the folder name is the random
// ASCII id, the human-readable title lives in dashboard.json and is mapped on
// display. Deleting = removing the folder.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'

const name = 'dsh-workbench'
const inject = ['tools', 'webServer', 'systemPrompt']

const __dirname = dirname(fileURLToPath(import.meta.url))
const BUNDLED_STANDALONE = join(__dirname, '..', 'standalone')

const API = {
  list: '/api/dsh-workbench/list',
  get: '/api/dsh-workbench/get',
  remove: '/api/dsh-workbench/remove',
  tokens: '/api/dsh-workbench/tokens',
  move: '/api/dsh-workbench/move',
  reorder: '/api/dsh-workbench/reorder',
}

function dshHomeDir() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

// ---- storage: one dashboard = one folder ----
function dashboardsDir() {
  return join(dshHomeDir(), 'workbenches')
}

function legacyStorePath() {
  return join(dshHomeDir(), 'workbench.json')
}

function writeDashboard(dashboard) {
  const folder = join(dashboardsDir(), dashboard.id)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'dashboard.json'), JSON.stringify(dashboard, null, 2), 'utf8')
}

// ---- built-in "Token 消耗" panel: a real dashboard folder (id __tokens__) ----
// Seeded exactly once (first install): the `.seeded` marker under workbenches/
// records that the built-in panel was created, so deleting it later is final
// and a restart does NOT bring it back.
const TOKEN_PANEL_ID = '__tokens__'

function seedTokenPanel() {
  try {
    const dir = dashboardsDir()
    const marker = join(dir, '.seeded')
    if (existsSync(marker)) return
    mkdirSync(dir, { recursive: true })
    const target = join(dir, TOKEN_PANEL_ID, 'dashboard.json')
    if (!existsSync(target)) {
      writeDashboard({
        id: TOKEN_PANEL_ID,
        type: 'token',
        title: 'Token 消耗',
        description: '实时监控当前活跃会话的 token 用量',
        order: 0,
        createdAt: 0,
      })
    }
    writeFileSync(marker, '1', 'utf8')
  } catch {
    /* seed failure is non-fatal */
  }
}

function removeDashboard(id) {
  migrateLegacyIfNeeded()
  try {
    const target = join(dashboardsDir(), id)
    if (!existsSync(target)) return false
    rmSync(target, { recursive: true, force: true })
    return !existsSync(target)
  } catch {
    return false
  }
}

function migrateLegacyIfNeeded() {
  const legacy = legacyStorePath()
  try {
    if (!existsSync(legacy)) return
    const parsed = JSON.parse(readFileSync(legacy, 'utf8'))
    const list = Array.isArray(parsed) ? parsed : []
    for (const d of list) {
      if (d && typeof d.id === 'string') writeDashboard(d)
    }
    rmSync(legacy, { force: true })
  } catch {
    /* leave the legacy file in place on failure */
  }
}

function readAll() {
  migrateLegacyIfNeeded()
  const dir = dashboardsDir()
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
  const out = []
  for (const name of entries) {
    try {
      const raw = readFileSync(join(dir, name, 'dashboard.json'), 'utf8')
      const d = JSON.parse(raw)
      if (d && typeof d.id === 'string') out.push(d)
    } catch {
      /* skip unreadable folder */
    }
  }
  out.sort((a, b) => {
    const ao = orderOf(a)
    const bo = orderOf(b)
    if (ao !== bo) return ao - bo
    return (b.createdAt || 0) - (a.createdAt || 0)
  })
  return out
}

// Order key: the built-in token panel is seeded with 0, user dashboards get
// 1,2,3…; anything without an explicit order (legacy) sorts last.
function orderOf(d) {
  return Number.isInteger(d.order) ? d.order : Number.MAX_SAFE_INTEGER
}

function moveDashboard(id, dir) {
  migrateLegacyIfNeeded()
  const all = readAll()
  const idx = all.findIndex((d) => d.id === id)
  if (idx < 0) return false
  const target = dir === 'up' ? idx - 1 : dir === 'down' ? idx + 1 : -1
  if (target < 0 || target >= all.length) return false
  const tmp = all[idx]
  all[idx] = all[target]
  all[target] = tmp
  all.forEach((d, i) => {
    if (d.order !== i) { d.order = i; writeDashboard(d) }
  })
  return true
}

function reorderDashboard(id, to) {
  migrateLegacyIfNeeded()
  const all = readAll()
  const idx = all.findIndex((d) => d.id === id)
  if (idx < 0) return false
  const target = Number.isInteger(to) ? to : idx
  if (target < 0 || target >= all.length || target === idx) return false
  const [item] = all.splice(idx, 1)
  all.splice(target, 0, item)
  all.forEach((d, i) => {
    if (d.order !== i) { d.order = i; writeDashboard(d) }
  })
  return true
}

function summaryOf(d) {
  return {
    id: d.id,
    title: d.title || '未命名看板',
    description: d.description || '',
    createdAt: d.createdAt || 0,
    widgetCount: Array.isArray(d.widgets) ? d.widgets.length : 0,
    type: d.type || 'dashboard',
  }
}

// ---- token usage (reads dsh-token-meter's session projection) ----
function collectTokenUsage(ctx) {
  const sessions = ctx.get('sessions')
  const projections = ctx.get('sessionProjections')
  if (!sessions || !projections) {
    return {
      ok: false,
      error: 'token metering unavailable (dsh-session-projection not mounted)',
      totals: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, total: 0 },
      sessionCount: 0,
      sessions: [],
    }
  }
  const rows = []
  const totals = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
  for (const session of sessions.list()) {
    let snap
    try {
      snap = projections.snapshot(session)
    } catch {
      continue
    }
    const usage = snap && snap.values ? snap.values.tokenUsage : undefined
    if (!usage) continue
    const total = usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
    rows.push({
      id: session.id,
      title: snap.values.title || session.id,
      uncachedInputTokens: usage.uncachedInputTokens,
      outputTokens: usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens,
      cacheWriteTokens: usage.cacheWriteTokens,
      total,
    })
    totals.uncachedInputTokens += usage.uncachedInputTokens
    totals.outputTokens += usage.outputTokens
    totals.cacheReadTokens += usage.cacheReadTokens
    totals.cacheWriteTokens += usage.cacheWriteTokens
  }
  rows.sort((a, b) => b.total - a.total)
  return {
    ok: true,
    totals: { ...totals, total: totals.uncachedInputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens },
    sessionCount: rows.length,
    sessions: rows,
  }
}

function sanitizeDashboard(args) {
  const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : '未命名看板'
  const description = typeof args.description === 'string' ? args.description : ''
  const columns = Number.isInteger(args.columns) && args.columns >= 1 && args.columns <= 4 ? args.columns : 2
  const widgets = Array.isArray(args.widgets)
    ? args.widgets.map((w, i) => ({
        id: 'w' + i,
        type: (w && typeof w.type === 'string' && w.type) || 'text',
        title: w && typeof w.title === 'string' ? w.title : '',
        span: w && Number.isInteger(w.span) && w.span >= 1 && w.span <= 4 ? w.span : 1,
        content: w && typeof w.content === 'string' ? w.content : '',
        items: w && Array.isArray(w.items)
          ? w.items.filter((x) => x && x.label != null).map((x) => ({ label: String(x.label), value: x.value == null ? '' : String(x.value) }))
          : [],
        columns: w && Array.isArray(w.columns) ? w.columns.map(String) : [],
        rows: w && Array.isArray(w.rows) ? w.rows.filter((r) => Array.isArray(r)).map((r) => r.map(String)) : [],
      }))
    : []
  return { title, description, columns, widgets }
}

function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function queryParam(req, name) {
  try {
    return new URL(req.url, 'http://127.0.0.1').searchParams.get(name)
  } catch {
    return undefined
  }
}

// ---- theme files (HTML/CSS/JS), served fresh on every request so the user can
// edit them without restarting DSH. User-editable copies live in
// $DSH_HOME/workbench/; bundled copies in the package's standalone/ are the
// fallback when a user copy is missing. ----
function themeDir() {
  return join(dshHomeDir(), 'workbench')
}

function readThemeFile(filename) {
  for (const dir of [themeDir(), BUNDLED_STANDALONE]) {
    const p = join(dir, filename)
    try {
      if (existsSync(p)) return readFileSync(p, 'utf8')
    } catch {
      /* try next location */
    }
  }
  return null
}

const THEME_MIME = {
  'view.html': 'text/html; charset=utf-8',
  'workbench.css': 'text/css; charset=utf-8',
  'workbench.js': 'text/javascript; charset=utf-8',
}

function serveThemeFile(res, filename) {
  const content = readThemeFile(filename)
  if (content == null) return writeJson(res, 404, { ok: false, error: 'theme file not found: ' + filename })
  res.writeHead(200, { 'content-type': THEME_MIME[filename] || 'text/plain; charset=utf-8' })
  res.end(content)
}

const WORKBENCH_GUIDANCE =
  '本机已安装 dsh-workbench 插件（自定义看板/工作台）：用户要求把分析结论、指标、明细「做成看板/工作台保存」时，用 workbench_save 持久化（组件类型 markdown/metrics/table/text），用 workbench_list 查看，用 workbench_delete 删除。每个看板是一个独立文件夹，保存后可在会话头部「看板」视图标签页全屏查看；该视图内还有「Token 消耗」面板。用户问 token/用量消耗时，用 workbench_tokens 查询活跃会话的 token 消耗（输入/输出/缓存读/缓存写）。'

function apply(ctx) {
  // Seed the built-in "Token 消耗" panel exactly once (first install); once
  // deleted, a restart does not recreate it.
  seedTokenPanel()

  // ---- HTTP routes for the browser half ----
  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({
        kind: 'exact',
        path: API.list,
        handler: async (_req, res) => {
          writeJson(res, 200, { ok: true, dashboards: readAll().map(summaryOf) })
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: API.get,
        handler: async (req, res) => {
          const id = queryParam(req, 'id')
          if (typeof id !== 'string') return writeJson(res, 400, { ok: false, error: 'id required' })
          const found = readAll().find((d) => d.id === id)
          writeJson(res, 200, { ok: true, dashboard: found ? { ...found } : null })
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: API.remove,
        handler: async (req, res) => {
          const id = queryParam(req, 'id')
          if (typeof id !== 'string') return writeJson(res, 400, { ok: false, error: 'id required' })
          writeJson(res, 200, { ok: true, removed: removeDashboard(id) })
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: API.move,
        handler: async (req, res) => {
          const id = queryParam(req, 'id')
          const dir = queryParam(req, 'dir')
          if (typeof id !== 'string') return writeJson(res, 400, { ok: false, error: 'id required' })
          writeJson(res, 200, { ok: true, moved: moveDashboard(id, dir) })
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: API.reorder,
        handler: async (req, res) => {
          const id = queryParam(req, 'id')
          const to = queryParam(req, 'to')
          if (typeof id !== 'string') return writeJson(res, 400, { ok: false, error: 'id required' })
          writeJson(res, 200, { ok: true, moved: reorderDashboard(id, to == null ? undefined : Number(to)) })
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: API.tokens,
        handler: async (_req, res) => {
          writeJson(res, 200, collectTokenUsage(ctx))
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-workbench/view',
        handler: async (_req, res) => serveThemeFile(res, 'view.html'),
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-workbench/assets/workbench.css',
        handler: async (_req, res) => serveThemeFile(res, 'workbench.css'),
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: '/dsh-workbench/assets/workbench.js',
        handler: async (_req, res) => serveThemeFile(res, 'workbench.js'),
      }),
    ]
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-workbench: routes')

  // ---- system prompt announcement ----
  ctx.effect(() => {
    return ctx.systemPrompt.section({
      name: 'plugin:dsh-workbench',
      order: 180,
      text: WORKBENCH_GUIDANCE,
    })
  }, 'dsh-workbench: guidance')

  // ---- model-facing tools ----
  const widgetSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      type: { type: 'string', required: true, enum: ['markdown', 'metrics', 'table', 'text'], description: '组件类型：markdown 富文本 / metrics 指标卡组 / table 数据表 / text 纯文本' },
      title: { type: 'string', description: '组件标题（可省略）' },
      span: { type: 'integer', description: '占栅格列数，默认 1（1-4），不超过看板 columns' },
      content: { type: 'string', description: 'markdown 或 text 类型的正文内容' },
      items: { type: 'array', description: 'metrics 类型的指标项', items: { type: 'object', additionalProperties: false, properties: { label: { type: 'string', required: true, description: '指标名' }, value: { type: 'string', required: true, description: '指标值，如 12.4%' } } } },
      columns: { type: 'array', description: 'table 类型的列名', items: { type: 'string' } },
      rows: { type: 'array', description: 'table 类型的行，每行数组与 columns 对齐', items: { type: 'array', items: { type: 'string' } } },
    },
  }

  ctx.tools.register(defineTool({
    name: 'workbench_save',
    description: '保存一个自定义看板/工作台：把对话中整理出的关键指标、结论、明细等设计为组件（markdown/metrics/table/text），调用本工具持久化保存（一个看板一个独立文件夹）。保存后出现在会话头部「看板」视图标签页中，用户可随时全屏查看。',
    parameters: {
      title: { type: 'string', required: true, description: '看板标题，如「本周运营周报」' },
      description: { type: 'string', description: '一句话说明看板用途' },
      columns: { type: 'integer', description: '栅格列数，默认 2（1-4）' },
      widgets: { type: 'array', required: true, description: '看板组件列表', items: widgetSchema },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, id: { type: 'string', required: true }, title: { type: 'string', required: true }, widgetCount: { type: 'integer', required: true } } },
      render(_args, value) {
        return [{ type: 'text', text: '已保存看板「' + value.title + '」（' + value.widgetCount + ' 个组件，id: ' + value.id + '）' }]
      },
    },
    execute(args) {
      const data = sanitizeDashboard(args || {})
      const maxOrder = readAll().reduce((m, d) => Math.max(m, Number.isInteger(d.order) ? d.order : 0), 0)
      const dashboard = {
        id: 'wb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
        title: data.title,
        description: data.description,
        columns: data.columns,
        widgets: data.widgets,
        order: maxOrder + 1,
        createdAt: Date.now(),
      }
      writeDashboard(dashboard)
      return { ok: true, id: dashboard.id, title: dashboard.title, widgetCount: dashboard.widgets.length }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'workbench_list',
    description: '列出所有已保存的自定义看板（id、标题、说明、组件数），供用户选择查看或管理。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, dashboards: { type: 'array', required: true } } },
      render(_args, value) {
        const list = (value.dashboards || []).map((d) => '- ' + d.title + '（' + d.widgetCount + ' 个组件，id: ' + d.id + '）').join('\n') || '（暂无看板）'
        return [{ type: 'text', text: '已保存看板：\n' + list }]
      },
    },
    execute() {
      return { ok: true, dashboards: readAll().map(summaryOf) }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'workbench_delete',
    description: '按 id 删除一个已保存的自定义看板。',
    parameters: {
      id: { type: 'string', required: true, description: '要删除的看板 id（来自 workbench_list）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, removed: { type: 'boolean', required: true } } },
      render(args, value) {
        return [{ type: 'text', text: value.removed ? '已删除看板 ' + args.id : '未找到看板 ' + args.id }]
      },
    },
    execute(args) {
      const id = args && args.id
      if (typeof id !== 'string') return { ok: false, removed: false }
      const removed = removeDashboard(id)
      return { ok: removed, removed }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'workbench_tokens',
    description: '查询当前活跃会话的 token 消耗统计（总计 + 各会话明细，含输入/输出/缓存读/缓存写）。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, error: { type: 'string' }, totals: { type: 'object', additionalProperties: false, properties: { uncachedInputTokens: { type: 'integer' }, outputTokens: { type: 'integer' }, cacheReadTokens: { type: 'integer' }, cacheWriteTokens: { type: 'integer' }, total: { type: 'integer' } } }, sessionCount: { type: 'integer' }, sessions: { type: 'array' } } },
      render(_args, value) {
        if (!value || !value.ok) return [{ type: 'text', text: value && value.error ? value.error : 'token 计量不可用' }]
        const fmt = (n) => { n = Number(n) || 0; return n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)) }
        const t = value.totals || {}
        const lines = [
          'Token 消耗（活跃会话）：',
          '  总计 ' + fmt(t.total) + '（输入 ' + fmt(t.uncachedInputTokens) + ' / 输出 ' + fmt(t.outputTokens) + ' / 缓存读 ' + fmt(t.cacheReadTokens) + ' / 缓存写 ' + fmt(t.cacheWriteTokens) + '）',
          '  共 ' + (value.sessionCount || 0) + ' 个会话',
        ]
        ;(value.sessions || []).forEach((s) => { lines.push('  - ' + s.title + '：' + fmt(s.total)) })
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    execute() {
      return collectTokenUsage(ctx)
    },
  }))
}

export { API, apply, inject, name }
