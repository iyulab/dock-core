/**
 * Styles for the shadow tree. Everything visual is a CSS custom property with a default, so a host themes the
 * element from outside (`dock-root { --dock-accent: ... }`) without a theming engine.
 */
export const STYLES = `
:host {
  --_bg: var(--dock-bg, #181b22);
  --_panel: var(--dock-panel, #1b1f27);
  --_bar: var(--dock-bar, #12151b);
  --_line: var(--dock-line, #2a2f3a);
  --_text: var(--dock-text, #d6dae3);
  --_dim: var(--dock-dim, #8b93a5);
  --_accent: var(--dock-accent, #4c8dff);
  --_accent-soft: var(--dock-accent-soft, rgba(76, 141, 255, 0.22));
  --_danger: var(--dock-danger, #ff6b6b);
  --_tab-h: var(--dock-tab-height, 34px);
  display: block;
  position: relative;
  min-width: 0;
  min-height: 0;
  color: var(--_text);
  background: var(--_bg);
  font: 13px/1.4 var(--dock-font, ui-sans-serif, system-ui, "Segoe UI", sans-serif);
}
* { box-sizing: border-box; }
.root { display: flex; position: relative; width: 100%; height: 100%; min-height: 0; }
.split { display: flex; flex: 1; min-width: 0; min-height: 0; }
.split.row { flex-direction: row; }
.split.column { flex-direction: column; }
.cell { display: flex; min-width: 0; min-height: 0; overflow: hidden; }
.gutter { flex: none; background: var(--_line); position: relative; z-index: 2; touch-action: none; }
.row > .gutter { width: 1px; cursor: col-resize; }
.column > .gutter { height: 1px; cursor: row-resize; }
.gutter::after { content: ""; position: absolute; inset: 0; }
.row > .gutter::after { left: -3px; right: -3px; }
.column > .gutter::after { top: -3px; bottom: -3px; }
.gutter:hover, .gutter.dragging { background: var(--_accent); }

.tabs { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; background: var(--_panel); }
.bar { position: relative; display: flex; height: var(--_tab-h); flex: none; overflow-x: auto; overflow-y: hidden; scrollbar-width: none;
       background: var(--_bar); border-bottom: 1px solid var(--_line); }
.bar::-webkit-scrollbar { display: none; }
.tab { display: flex; align-items: center; gap: 8px; flex: none; position: relative; padding: 0 10px 0 12px;
       white-space: nowrap; color: var(--_dim); cursor: pointer; user-select: none; outline: none;
       border-right: 1px solid var(--_line); touch-action: none; }
.tab:hover { color: var(--_text); background: #171b23; }
.tab[aria-selected="true"] { color: #fff; background: var(--_panel); }
.tab[aria-selected="true"]::before { content: ""; position: absolute; left: 0; right: 0; top: 0; height: 2px; background: var(--_accent); }
.tab:focus-visible { box-shadow: inset 0 0 0 2px var(--_accent); }
.tab.ghosted { opacity: 0.35; }
.close { width: 16px; height: 16px; display: grid; place-items: center; border-radius: 4px; font-size: 12px; opacity: 0; }
.tab:hover .close, .tab[aria-selected="true"] .close { opacity: 0.8; }
.close:hover { background: #2c3342; opacity: 1; }
.body { position: relative; flex: 1; min-height: 0; overflow: auto; }

.state { display: grid; place-items: center; flex: 1; padding: 24px; text-align: center; color: var(--_dim); }
.state .title { font-size: 15px; color: var(--_text); margin-bottom: 6px; }
.state.error .title { color: var(--_danger); }
.state button { margin-top: 12px; padding: 7px 14px; border: 0; border-radius: 6px; background: var(--_accent); color: #fff; font: inherit; cursor: pointer; }
.skeleton { display: grid; gap: 10px; padding: 12px 14px; }
.skeleton i { display: block; height: 12px; border-radius: 6px; background: linear-gradient(90deg, #222836, #2b3244, #222836);
              background-size: 200% 100%; animation: shimmer 1.1s linear infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }

.ghost { position: fixed; z-index: 50; display: none; pointer-events: none; padding: 6px 12px; border: 1px solid var(--_accent);
         border-radius: 6px; background: #243049; color: #fff; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); }
.overlay { position: fixed; z-index: 40; display: none; pointer-events: none; border: 2px solid var(--_accent);
           border-radius: 6px; background: var(--_accent-soft); }
.overlay span { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); white-space: nowrap;
                padding: 2px 8px; border-radius: 10px; background: #0b0d11cc; color: #fff; font-size: 11px; }
.insert { position: fixed; z-index: 45; display: none; pointer-events: none; width: 2px; background: var(--_accent); }
`;
