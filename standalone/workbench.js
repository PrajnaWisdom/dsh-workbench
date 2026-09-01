/* ============================================================
 * workbench.js — 看板渲染器（无依赖，纯原生 JS）
 *
 * 两种运行方式：
 * 1) 服务端托管（插件内）：通过 /api/dsh-workbench/* 取真实数据，
 *    支持「列表 → 详情」、返回、删除、上移/下移、拖拽排序。
 * 2) 本地离线预览（双击 index.html）：若 window.DASHBOARD 有数据
 *    则直接渲染示例，方便不改服务就调样式。
 * ============================================================ */

(function () {
  'use strict';

  var root = null;
  var IS_OFFLINE = location.protocol === 'file:';
  var dragId = null;

  // ---------- 工具 ----------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function api(path) {
    return fetch(path).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function fmtTokens(n) {
    n = Number(n);
    if (!isFinite(n) || n < 0) n = 0;
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
  }

  function fmtDate(ts) {
    var d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  // ---------- 行内 markdown ----------
  function renderInline(text) {
    var re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    var out = '';
    var last = 0;
    var m;
    while ((m = re.exec(String(text || ''))) !== null) {
      out += esc(String(text).slice(last, m.index));
      var token = m[0];
      if (token.indexOf('**') === 0) out += '<strong>' + esc(token.slice(2, -2)) + '</strong>';
      else out += '<code>' + esc(token.slice(1, -1)) + '</code>';
      last = m.index + token.length;
    }
    out += esc(String(text).slice(last));
    return out;
  }

  // ---------- 极简 markdown ----------
  function renderMarkdown(content) {
    var lines = String(content || '').split('\n');
    var html = '';
    var inList = false;
    function closeList() { if (inList) { html += '</ul>'; inList = false; } }

    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line) { closeList(); return; }
      var h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) {
        closeList();
        var level = h[1].length;
        var tag = level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5';
        html += '<' + tag + '>' + renderInline(h[2]) + '</' + tag + '>';
      } else if (/^[-*]\s+/.test(line)) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + renderInline(line.replace(/^[-*]\s+/, '')) + '</li>';
      } else {
        closeList();
        html += '<p>' + renderInline(line) + '</p>';
      }
    });
    closeList();
    return html;
  }

  // ---------- 组件渲染 ----------
  function renderMetrics(w) {
    var el = document.createElement('div');
    el.className = 'wbk-metrics';
    (w.items || []).forEach(function (it) {
      var card = document.createElement('div');
      card.className = 'wbk-metric';
      var v = document.createElement('span');
      v.className = 'wbk-metric-value';
      v.textContent = it.value;
      var l = document.createElement('span');
      l.className = 'wbk-metric-label';
      l.textContent = it.label;
      card.appendChild(v);
      card.appendChild(l);
      el.appendChild(card);
    });
    return el;
  }

  function renderTable(w) {
    var table = document.createElement('table');
    table.className = 'wbk-table';
    var cols = w.columns || [];

    var thead = document.createElement('thead');
    var trh = document.createElement('tr');
    cols.forEach(function (c) {
      var th = document.createElement('th');
      th.textContent = c;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    (w.rows || []).forEach(function (r) {
      var tr = document.createElement('tr');
      cols.forEach(function (c, i) {
        var td = document.createElement('td');
        td.textContent = r[i] == null ? '' : String(r[i]);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function renderWidget(w) {
    var el = document.createElement('div');
    el.className = 'wbk-widget' + (w.type === 'table' ? ' wbk-widget-wide' : '');
    if (w.type !== 'table') el.style.gridColumn = 'span ' + (w.span || 1);

    if (w.title) {
      var t = document.createElement('div');
      t.className = 'wbk-widget-title';
      t.textContent = w.title;
      el.appendChild(t);
    }

    var body;
    if (w.type === 'markdown') {
      body = document.createElement('div');
      body.className = 'wbk-md';
      body.innerHTML = renderMarkdown(w.content);
    } else if (w.type === 'metrics') {
      body = renderMetrics(w);
    } else if (w.type === 'table') {
      body = renderTable(w);
    } else {
      body = document.createElement('div');
      body.className = 'wbk-text';
      body.textContent = w.content || '';
    }
    el.appendChild(body);
    return el;
  }

  // ---------- 工具栏 ----------
  function btn(label, primary, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'wbk-btn' + (primary ? ' wbk-btn-primary' : '');
    b.textContent = label;
    b.onclick = onClick;
    return b;
  }

  function toolbar(title, buttons) {
    var bar = document.createElement('div');
    bar.className = 'wbk-toolbar';
    var t = document.createElement('div');
    t.className = 'wbk-toolbar-title';
    t.textContent = title;
    bar.appendChild(t);
    (buttons || []).forEach(function (item) { bar.appendChild(btn(item.label, item.primary, item.onClick)); });
    return bar;
  }

  // ---------- 详情视图 ----------
  function renderDashboard(container, data) {
    container.innerHTML = '';
    var page = document.createElement('div');
    page.className = 'wbk-page';

    page.appendChild(toolbar(data.title || '未命名看板', [
      { label: '← 返回列表', onClick: function () { goList(); } },
    ]));

    var title = document.createElement('h1');
    title.className = 'wbk-page-title';
    title.textContent = data.title || '未命名看板';
    page.appendChild(title);

    if (data.description) {
      var desc = document.createElement('p');
      desc.className = 'wbk-page-desc';
      desc.textContent = data.description;
      page.appendChild(desc);
    }

    var grid = document.createElement('div');
    grid.className = 'wbk-grid';
    grid.style.gridTemplateColumns = 'repeat(' + (data.columns || 2) + ', minmax(0, 1fr))';
    (data.widgets || []).forEach(function (w) { grid.appendChild(renderWidget(w)); });
    page.appendChild(grid);

    container.appendChild(page);
  }

  // ---------- SVG 箭头按钮 ----------
  function arrowBtn(dir, title, disabled, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'wbk-btn wbk-btn-move';
    b.title = title;
    b.disabled = disabled;
    b.innerHTML = dir === 'up'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>';
    b.onclick = onClick;
    return b;
  }

  // ---------- 列表视图 ----------
  function renderList(container, dashboards) {
    container.innerHTML = '';
    var page = document.createElement('div');
    page.className = 'wbk-page';

    page.appendChild(toolbar('看板 / 工作台', []));

    var list = document.createElement('div');
    list.className = 'wbk-list';

    if (!dashboards.length) {
      var empty = document.createElement('div');
      empty.className = 'wbk-empty';
      empty.innerHTML = '<p>还没有看板</p><p>在对话里告诉助手「把刚才的分析做成看板保存」，保存后会自动出现在这里。</p>';
      list.appendChild(empty);
    } else {
      var ids = dashboards.map(function (d) { return d.id; });

      list.addEventListener('dragover', function (e) {
        if (dragId == null || IS_OFFLINE) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        var target = e.target.closest ? e.target.closest('.wbk-item') : null;
        var items = list.querySelectorAll('.wbk-item');
        for (var k = 0; k < items.length; k++) items[k].classList.remove('wbk-insert-before', 'wbk-insert-after');
        if (!target) return;
        var rect = target.getBoundingClientRect();
        var before = (e.clientY - rect.top) < rect.height / 2;
        target.classList.add(before ? 'wbk-insert-before' : 'wbk-insert-after');
      });

      list.addEventListener('drop', function (e) {
        if (dragId == null || IS_OFFLINE) return;
        e.preventDefault();
        var items = list.querySelectorAll('.wbk-item');
        for (var k = 0; k < items.length; k++) items[k].classList.remove('wbk-insert-before', 'wbk-insert-after');
        var target = e.target.closest ? e.target.closest('.wbk-item') : null;
        var dragged = dragId;
        dragId = null;
        if (!target) return;
        var targetId = target.getAttribute('data-id');
        if (!targetId || targetId === dragged) return;
        var targetIndex = ids.indexOf(targetId);
        var fromIndex = ids.indexOf(dragged);
        if (targetIndex < 0 || fromIndex < 0) return;
        var rect = target.getBoundingClientRect();
        var before = (e.clientY - rect.top) < rect.height / 2;
        var targetPos = before ? targetIndex : targetIndex + 1;
        var to = fromIndex < targetPos ? targetPos - 1 : targetPos;
        api('/api/dsh-workbench/reorder?id=' + encodeURIComponent(dragged) + '&to=' + to).then(function () { refresh(); }).catch(function () { refresh(); });
      });

      dashboards.forEach(function (d, i) {
        var isToken = d.type === 'token';
        var item = document.createElement('div');
        item.className = 'wbk-item' + (isToken ? ' wbk-item-builtin' : '');
        item.setAttribute('data-id', d.id);
        if (!IS_OFFLINE) {
          item.draggable = true;
          item.addEventListener('dragstart', function (e) {
            dragId = d.id;
            item.classList.add('wbk-item-dragging');
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', d.id); } catch (err) {}
          });
          item.addEventListener('dragend', function () {
            dragId = null;
            item.classList.remove('wbk-item-dragging');
            var items = list.querySelectorAll('.wbk-item');
            for (var k = 0; k < items.length; k++) items[k].classList.remove('wbk-insert-before', 'wbk-insert-after');
          });
        }

        var icon = document.createElement('div');
        icon.className = 'wbk-item-icon';
        icon.textContent = isToken ? '⚡' : ((d.title || '看').trim().charAt(0));
        item.appendChild(icon);

        var main = document.createElement('div');
        main.className = 'wbk-item-main';

        var title = document.createElement('div');
        title.className = 'wbk-item-title';
        title.textContent = d.title;
        main.appendChild(title);
        if (d.description) {
          var desc = document.createElement('div');
          desc.className = 'wbk-item-desc';
          desc.textContent = d.description;
          main.appendChild(desc);
        }
        var meta = document.createElement('div');
        meta.className = 'wbk-item-meta';
        meta.textContent = isToken
          ? '内置看板 · 实时监控'
          : '创建于 ' + fmtDate(d.createdAt) + ' · ' + d.widgetCount + ' 个组件';
        main.appendChild(meta);

        var actions = document.createElement('div');
        actions.className = 'wbk-item-actions';
        if (!IS_OFFLINE) {
          var isFirst = i === 0;
          var isLast = i === dashboards.length - 1;

          var up = arrowBtn('up', '上移', isFirst, function (ev) {
            ev.stopPropagation();
            api('/api/dsh-workbench/move?id=' + encodeURIComponent(d.id) + '&dir=up').then(function () { refresh(); }).catch(function () { refresh(); });
          });
          actions.appendChild(up);

          var down = arrowBtn('down', '下移', isLast, function (ev) {
            ev.stopPropagation();
            api('/api/dsh-workbench/move?id=' + encodeURIComponent(d.id) + '&dir=down').then(function () { refresh(); }).catch(function () { refresh(); });
          });
          actions.appendChild(down);

          var del = btn('删除', false, function (ev) {
            ev.stopPropagation();
            if (!confirm('删除看板「' + d.title + '」？')) return;
            api('/api/dsh-workbench/remove?id=' + encodeURIComponent(d.id)).then(function () {
              refresh();
            }).catch(function () { refresh(); });
          });
          del.classList.add('wbk-btn-danger');
          actions.appendChild(del);
        }

        if (isToken) {
          var badge = document.createElement('div');
          badge.className = 'wbk-item-badge';
          badge.textContent = '实时';
          item.appendChild(badge);
        }
        item.appendChild(main);
        item.appendChild(actions);
        item.onclick = function () { openDetail(d.id); };
        list.appendChild(item);
      });
    }

    page.appendChild(list);
    container.appendChild(page);
  }

  // ---------- Token 消耗视图（作为内置看板详情） ----------
  function renderTokens(container, data) {
    container.innerHTML = '';
    var page = document.createElement('div');
    page.className = 'wbk-page';

    page.appendChild(toolbar('Token 消耗', [
      { label: '← 返回列表', onClick: function () { goList(); } },
      { label: '刷新', primary: true, onClick: function () { refresh(); } },
    ]));

    if (!data || !data.ok) {
      var err = document.createElement('div');
      err.className = 'wbk-error';
      err.textContent = (data && data.error) || 'token 计量不可用（需挂载 dsh-session-projection / dsh-token-meter）';
      page.appendChild(err);
      container.appendChild(page);
      return;
    }

    var totals = data.totals || {};
    var cards = document.createElement('div');
    cards.className = 'wbk-metrics wbk-token-cards';
    [
      ['总消耗', totals.total],
      ['输入（未缓存）', totals.uncachedInputTokens],
      ['输出', totals.outputTokens],
      ['缓存读', totals.cacheReadTokens],
      ['缓存写', totals.cacheWriteTokens],
    ].forEach(function (m) {
      var card = document.createElement('div');
      card.className = 'wbk-metric';
      var v = document.createElement('span');
      v.className = 'wbk-metric-value';
      v.textContent = fmtTokens(m[1]);
      var l = document.createElement('span');
      l.className = 'wbk-metric-label';
      l.textContent = m[0];
      card.appendChild(v);
      card.appendChild(l);
      cards.appendChild(card);
    });
    page.appendChild(cards);

    var table = document.createElement('table');
    table.className = 'wbk-table wbk-token-table';
    var thead = document.createElement('thead');
    var trh = document.createElement('tr');
    ['会话', '总 Token', '输入', '输出', '缓存读', '缓存写'].forEach(function (h) {
      var th = document.createElement('th');
      th.textContent = h;
      trh.appendChild(th);
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    var sessions = data.sessions || [];
    if (!sessions.length) {
      var trEmpty = document.createElement('tr');
      var tdEmpty = document.createElement('td');
      tdEmpty.colSpan = 6;
      tdEmpty.className = 'wbk-token-empty';
      tdEmpty.textContent = '暂无活跃会话的 token 记录（仅统计当前已加载的会话）';
      trEmpty.appendChild(tdEmpty);
      tbody.appendChild(trEmpty);
    } else {
      sessions.forEach(function (s) {
        var tr = document.createElement('tr');
        [s.title, s.total, s.uncachedInputTokens, s.outputTokens, s.cacheReadTokens, s.cacheWriteTokens].forEach(function (cell) {
          var td = document.createElement('td');
          td.textContent = typeof cell === 'number' ? fmtTokens(cell) : String(cell);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
    }
    table.appendChild(tbody);
    page.appendChild(table);

    var note = document.createElement('p');
    note.className = 'wbk-token-note';
    note.textContent = '口径：仅累计当前已加载（活跃）会话；「输入」为未命中缓存的 token，缓存读/写单独计。';
    page.appendChild(note);

    container.appendChild(page);
  }

  // ---------- 导航 ----------
  function currentId() {
    return new URLSearchParams(location.search).get('id');
  }

  function openDetail(id) {
    history.pushState(null, '', '?id=' + encodeURIComponent(id));
    refresh();
  }

  function goList() {
    history.pushState(null, '', location.pathname);
    refresh();
  }

  function refresh() {
    if (!root) return;
    if (window.DASHBOARD) { renderDashboard(root, window.DASHBOARD); return; } // 离线示例
    var id = currentId();
    if (id === '__tokens__') {
      api('/api/dsh-workbench/tokens').then(function (res) {
        renderTokens(root, res);
      }).catch(function () {
        root.innerHTML = '<div class="wbk-page"><div class="wbk-error">Token 数据加载失败——插件新路由尚未生效，请彻底退出并重启应用。</div></div>';
      });
    } else if (id) {
      api('/api/dsh-workbench/get?id=' + encodeURIComponent(id)).then(function (res) {
        if (res.ok && res.dashboard) renderDashboard(root, res.dashboard);
        else goList();
      }).catch(function () {
        root.innerHTML = '<div class="wbk-page"><div class="wbk-error">看板加载失败，请重试。</div></div>';
      });
    } else {
      api('/api/dsh-workbench/list').then(function (res) {
        renderList(root, res.dashboards || []);
      }).catch(function () {
        root.innerHTML = '<div class="wbk-page"><div class="wbk-error">看板列表加载失败，请彻底退出并重启应用后重试。</div></div>';
      });
    }
  }

  // ---------- 入口 ----------
  window.renderDashboard = renderDashboard;

  function boot() {
    root = document.getElementById('workbench');
    if (!root) return;
    window.addEventListener('popstate', refresh);
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
