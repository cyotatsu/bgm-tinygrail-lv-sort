/* ==UserScript==
   @name         小圣杯角色卡片 Lv 排序（超合金组件版）
   @namespace    https://bgm.tv/
   @version      1.0.0
   @description  自动定位含角色卡片的(iframe)页面并按 Lv 排序；悬浮按钮切换升降序/关闭恢复原顺序
   @match        *://bgm.tv/*
   @match        *://bangumi.tv/*
   @match        *://chii.in/*
   ==/UserScript== */
(function () {
    'use strict';

    var LV = '[id="tg-level-badge"][data-level]';
    // 人物项：新界面 cursor-pointer 卡片；兼容旧交易榜 data-character-id 卡片
    var ITEM_SEL = '[data-character-id], [class*="cursor-pointer"]';
    var K_DIR = 'tg_list_sort_dir';
    var K_ON = 'tg_list_sort_on';

    var CSS = [
        '#tgLvPanel { position:fixed; left:12px; bottom:12px; z-index:2147483646;',
        ' display:flex; align-items:center; gap:6px; background:rgba(30,30,30,.82);',
        ' color:#fff; padding:5px 8px; border-radius:8px; font:12px/1.4 sans-serif;',
        ' box-shadow:0 2px 10px rgba(0,0,0,.35); user-select:none; }',
        '#tgLvPanel button { background:#f09199; color:#fff; border:0; border-radius:5px;',
        ' padding:4px 8px; cursor:pointer; font-size:12px; line-height:1; }',
        '#tgLvPanel button:hover { filter:brightness(1.1); }',
        '#tgLvPanel button.off { background:#888; }',
        '#tgLvState { color:#eee; white-space:nowrap; margin-right:2px; }'
    ].join('\n');

    function initInWindow(win) {
        if (win.__tgLvSortInit) return;
        win.__tgLvSortInit = true;
        var doc;
        try { doc = win.document; } catch (e) { return; }
        if (!doc) return;
        console.log('[LvSort] 组件载入:', win.location.href);

        var dir = localStorage.getItem(K_DIR) === 'desc' ? -1 : 1;
        var active = localStorage.getItem(K_ON) !== '0';
        var snapshots = [];
        var panel = null, stateEl = null, powerBtn = null;

        // 样式
        (function () {
            if (doc.getElementById('tgLvStyle')) return;
            var s = doc.createElement('style');
            s.id = 'tgLvStyle';
            s.textContent = CSS;
            (doc.head || doc.documentElement).appendChild(s);
        })();

        function lvOf(item) {
            var b = item.querySelector(LV);
            var n = b ? parseInt(b.getAttribute('data-level'), 10) : NaN;
            return isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
        }

        // 找出所有列表：容器 -> 该容器内 >=2 个"带 Lv 徽标的人物项"
        function collectLists() {
            var groups = {}; // key: 容器元素 -> {parent, items:[]}
            var order = [];  // 保持容器顺序
            function add(item) {
                if (!item || !item.parentElement) return;
                var parent = item.parentElement;
                if (!groups[parent]) { groups[parent] = { parent: parent, items: [] }; order.push(parent); }
                // 去重
                if (groups[parent].items.indexOf(item) < 0) groups[parent].items.push(item);
            }
            // 锚点1：人物项内每个 Lv 徽标
            var badges = doc.querySelectorAll(LV);
            for (var i = 0; i < badges.length; i++) {
                add(badges[i].closest(ITEM_SEL));
            }
            // 锚点2：旧交易榜卡片（兜底）
            var cards = doc.querySelectorAll('[data-character-id]');
            for (var j = 0; j < cards.length; j++) add(cards[j]);

            var lists = [];
            for (var k = 0; k < order.length; k++) {
                var g = groups[order[k]];
                // 只保留真正是"父容器直接子节点"的项（防误伤嵌套）
                var items = [];
                var kids = g.parent.children;
                for (var m = 0; m < kids.length; m++) {
                    if (g.items.indexOf(kids[m]) >= 0) items.push(kids[m]);
                }
                if (items.length >= 2) lists.push({ parent: g.parent, items: items });
            }
            return lists;
        }

        function capture(parent, kids) {
            for (var i = 0; i < snapshots.length; i++) {
                if (snapshots[i].parent === parent) {
                    var old = snapshots[i].order;
                    if (old.length !== kids.length) { snapshots[i].order = kids.slice(); return; }
                    var set = {}, same = true;
                    for (var j = 0; j < old.length; j++) set[old[j]] = 1;
                    for (var k = 0; k < kids.length; k++) if (!set[kids[k]]) { same = false; break; }
                    if (!same) snapshots[i].order = kids.slice();
                    return;
                }
            }
            snapshots.push({ parent: parent, order: kids.slice() });
        }

        function sortLists() {
            if (!active) return;
            var lists = collectLists();
            if (!lists.length) return;
            for (var l = 0; l < lists.length; l++) {
                var parent = lists[l].parent;
                var items = lists[l].items;
                var kids = Array.prototype.slice.call(parent.children);
                capture(parent, kids);

                // 只在 items 中排序，非人物项位置不动
                var sorted = items.slice().sort(function (a, b) { return (lvOf(a) - lvOf(b)) * dir; });

                var changed = false;
                for (var i = 0; i < items.length; i++) if (items[i] !== sorted[i]) { changed = true; break; }
                if (!changed) continue;

                var itemSet = {};
                for (var s = 0; s < items.length; s++) itemSet[items[s]] = 1;
                var sortedIdx = 0;
                var finalOrder = [];
                for (var c = 0; c < kids.length; c++) {
                    if (itemSet[kids[c]]) { finalOrder.push(sorted[sortedIdx]); sortedIdx++; }
                    else finalOrder.push(kids[c]);
                }
                for (var f = 0; f < finalOrder.length; f++) parent.appendChild(finalOrder[f]);
                console.log('[LvSort] 已排序网格，人物数=' + items.length);
            }
        }

        function restoreAll() {
            for (var i = 0; i < snapshots.length; i++) {
                var parent = snapshots[i].parent;
                var kids = Array.prototype.slice.call(parent.children);
                var orig = snapshots[i].order;
                if (orig.length !== kids.length) continue;
                var set = {}, same = true;
                for (var j = 0; j < orig.length; j++) set[orig[j]] = 1;
                for (var k = 0; k < kids.length; k++) if (!set[kids[k]]) { same = false; break; }
                if (!same) continue;
                for (var r = 0; r < orig.length; r++) parent.appendChild(orig[r]);
            }
            snapshots = [];
            console.log('[LvSort] 已恢复原始顺序');
        }

        function refreshPanel() {
            if (!stateEl) return;
            stateEl.textContent = active ? (dir === 1 ? '运行中 · Lv 升序' : '运行中 · Lv 降序') : '已关闭';
            powerBtn.textContent = active ? '关闭' : '开启';
            powerBtn.className = active ? '' : 'off';
        }

        function buildPanel() {
            if (panel || !doc.body) return;
            var p = doc.createElement('div');
            p.id = 'tgLvPanel';
            stateEl = doc.createElement('span'); stateEl.id = 'tgLvState';
            var dirBtn = doc.createElement('button'); dirBtn.textContent = '⇅ 切换';
            powerBtn = doc.createElement('button');
            dirBtn.onclick = function () {
                if (!active) return;
                dir = dir === 1 ? -1 : 1;
                localStorage.setItem(K_DIR, dir === 1 ? 'asc' : 'desc');
                sortLists(); refreshPanel();
            };
            powerBtn.onclick = function () {
                active = !active;
                localStorage.setItem(K_ON, active ? '1' : '0');
                if (active) sortLists(); else restoreAll();
                refreshPanel();
            };
            p.appendChild(stateEl); p.appendChild(dirBtn); p.appendChild(powerBtn);
            doc.body.appendChild(p);
            panel = p;
            refreshPanel();
            console.log('[LvSort] 控制面板已显示');
        }

        // 变化自动重排（翻页/切tab/数据刷新）
        var timer = null;
        try {
            new win.MutationObserver(function () {
                if (!active || timer) return;
                timer = setTimeout(function () { timer = null; sortLists(); }, 300);
            }).observe(doc.body, { childList: true, subtree: true });
        } catch (e) { }

        // 等人物项出现 → 显示面板 + 排序
        var tries = 0;
        var iv = setInterval(function () {
            if (!doc.body) return;
            if (doc.querySelector(LV)) {
                clearInterval(iv);
                buildPanel();
                setTimeout(sortLists, 200);
            } else if (++tries >= 40) {
                clearInterval(iv);
            }
        }, 500);

        // 兜底：每 2 秒重排一次（React 频繁重绘也不怕）
        setInterval(function () { if (active && doc.body) sortLists(); }, 2000);
    }

    // 跨同源 iframe 扫描（组件若只注入顶层，也能作用到内部榜单/人物网格）
    function scan(win, depth) {
        var doc;
        try { doc = win.document; } catch (e) { return; }
        if (doc) initInWindow(win);
        if (depth > 4) return;
        var frames = doc ? doc.querySelectorAll('iframe') : [];
        for (var i = 0; i < frames.length; i++) {
            try { if (frames[i].contentWindow) scan(frames[i].contentWindow, depth + 1); }
            catch (e) { }
        }
    }

    setTimeout(function () { try { scan(window, 0); } catch (e) { } }, 300);
    setTimeout(function () { try { scan(window, 0); } catch (e) { } }, 1200);
    setTimeout(function () { try { scan(window, 0); } catch (e) { } }, 3000);
})();
