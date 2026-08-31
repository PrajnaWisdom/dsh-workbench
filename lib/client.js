// @dsh-desktop/dsh-workbench — client half
// Served at /plugins/@dsh-desktop/dsh-workbench/client.js.
//
// Single additive seat: `conversation.view` "看板" — a full-page view tab in
// the session header (like 聊天 / 轨迹), rendered by an <iframe> that loads the
// host-served HTML/CSS/JS files (/dsh-workbench/view). Customizing styles means
// editing workbench.css, not plugin code.
//
// NOTE: the desktop shell is single-window (Route C, dsh:// protocol, no HTTP
// port), so window.open cannot open a second window. The view tab is the
// full-page experience in the current window.
window.__ModuleLoader__.load({
  id: "@dsh-desktop/dsh-workbench",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var React = require("react");
    var e = React.createElement;

    // ---------- view tab: full-page dashboard via host-served files ----------
    function WorkbenchView() {
      return e("iframe", {
        src: "/dsh-workbench/view",
        title: "看板 / 工作台",
        style: { flex: "1 1 0%", width: "100%", minWidth: "0", minHeight: "0", border: "0", display: "block", background: "transparent" },
      });
    }

    // ---------- mount ----------
    var inject = ["slots"];
    function apply(ctx) {
      ctx.slots.inject("conversation.view", function () {
        return ctx.slots.register(
          { name: "conversation.view", id: "workbench", order: 100, label: "看板" },
          function () { return e(WorkbenchView, null); }
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
