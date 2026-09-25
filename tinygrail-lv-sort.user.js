// ==UserScript==
// @name         小圣杯人物/角色按 Lv 排序
// @namespace    https://bgm.tv/
// @version      1.1.1
// @description  小圣杯列表按 Lv 排序：适配新版个人主页人物网格与超展开英灵殿/交易榜卡片；悬浮按钮切换升/降序、关闭恢复原顺序；翻页/切标签/框架重绘后自动重排
// @author       you
// @match        *://bgm.tv/*
// @match        *://bangumi.tv/*
// @match        *://chii.in/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    var VERSION = '1.1.1';

    // 等级徽标：小圣杯卡片里的 Lv 标签
    var LV = '[id="tg-level-badge"][data-level]';
    // 人物项：新界面 cursor-pointer 卡片；兼容旧交易榜 data-character-id 卡片
    var ITEM_SEL = '[data-character-id], [class*="cursor-pointer"]';
    var K_DIR = 'tg_list_sort_dir';
    var K_ON = 'tg_list_sort_on';
    var K_DEBUG = 'tg_list_sort_debug';
    var K_MIN = 'tg_list_sort_min';

    var CSS = [
        '#tgLvPanel { position:fixed; left:12px; bottom:12px; z-index:2147483646;',
        ' display:flex; align-items:center; gap:6px; background:rgba(30,30,30,.82);',
        ' color:#fff; padding:5px 8px; border-radius:8px; font:12px/1.4 sans-serif;',
        ' box-shadow:0 2px 10px rgba(0,0,0,.35); user-select:none; }',
        '#tgLvPanel button { background:#f09199; color:#fff; border:0; border-radius:5px;',
        ' padding:4px 8px; cursor:pointer; font-size:12px; line-height:1; }',
        '#tgLvPanel button:hover { filter:brightness(1.1); }',
        '#tgLvPanel button.off { background:#888; }',
        '#tgLvState { color:#eee; white-space:nowrap; margin-right:2px; }',
        // 收起 / 展开：收起后只剩右侧一个小按钮（显隐同时用内联样式兜底，不依赖这段 CSS）
        '#tgLvPanel button#tgLvMin { background:#666; padding:4px 7px; }',
        '#tgLvPanel.min { padding:4px; gap:0; }',
        '#tgLvPanel.min .tg-main { display:none; }',
        '#tgLvPanel.min button#tgLvMin { background:#f09199; padding:6px 9px; font-weight:600; }'
    ].join('\n');

    function toArray(list) {
        var out = [], i;
        for (i = 0; i < list.length; i++) out.push(list[i]);
        return out;
    }

    // localStorage 在部分 iframe（第三方 Cookie 受限）里会抛异常，必须容错
    function getStore(win) {
        try {
            var s = win.localStorage;
            if (s) { s.getItem(K_ON); return s; }
        } catch (e) { }
        return null;
    }

    function initInWindow(win) {
        if (!win || win.__tgLvSortInit) return;
        var doc;
        try { doc = win.document; } catch (e) { return; }
        if (!doc) return;
        win.__tgLvSortInit = true;
        try {
            setup(win, doc);
        } catch (e) {
            // 初始化失败时允许后续重试（否则一次异常就永久失效）
            win.__tgLvSortInit = false;
            try { win.console.error('[LvSort] 初始化失败：', e); } catch (e2) { }
        }
    }

    function setup(win, doc) {
        var ls = getStore(win);
        var dir = (ls && ls.getItem(K_DIR) === 'desc') ? -1 : 1;
        var active = !(ls && ls.getItem(K_ON) === '0');
        var verbose = !!(ls && ls.getItem(K_DEBUG) === '1');
        var minimized = !!(ls && ls.getItem(K_MIN) === '1');

        var panel = null, stateEl = null, powerBtn = null, minBtn = null;
        var orderedEls = [];      // 被我们用 CSS order 调整过显示顺序的元素
        var snapshots = [];       // 被我们用 DOM 移动调整过顺序的容器 -> 原始子节点顺序
        var lastReport = '';
        var lastHref = '';

        function log() {
            if (!verbose) return;
            var a = toArray(arguments); a.unshift('[LvSort]');
            try { win.console.log.apply(win.console, a); } catch (e) { }
        }
        function warn() {
            var a = toArray(arguments); a.unshift('[LvSort]');
            try { win.console.warn.apply(win.console, a); } catch (e) { }
        }
        // 用户主动操作 / 版本确认时要看得见，不受 verbose 开关影响
        function say() {
            var a = toArray(arguments); a.unshift('[LvSort]');
            try { win.console.log.apply(win.console, a); } catch (e) { }
        }

        function ensureStyle() {
            if (!doc.documentElement) return;
            var s = doc.getElementById('tgLvStyle');
            if (s) {
                // 页面里可能残留旧版样式，内容不一致就更新
                if (s.textContent !== CSS) s.textContent = CSS;
                return;
            }
            s = doc.createElement('style');
            s.id = 'tgLvStyle';
            s.textContent = CSS;
            (doc.head || doc.documentElement).appendChild(s);
        }

        // ---------- 读取等级 ----------
        function lvOf(el) {
            var b = null;
            try { b = el && el.querySelector ? el.querySelector(LV) : null; } catch (e) { }
            if (!b && el && el.getAttribute && el.getAttribute('data-level') != null) b = el;
            var n = b ? parseInt(b.getAttribute('data-level'), 10) : NaN;
            return isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
        }

        function collectItems() {
            var items = [], i, it, badges;
            try { badges = doc.querySelectorAll(LV); } catch (e) { return items; }
            for (i = 0; i < badges.length; i++) {
                it = null;
                try { it = badges[i].closest(ITEM_SEL); } catch (e) { }
                if (!it) it = badges[i].parentElement;
                if (!it || items.indexOf(it) >= 0) continue;
                items.push(it);
            }
            return items;
        }

        // 用 === 比较 DOM 节点来分组。
        // 旧版用对象键存 DOM 元素，元素会被统一转成字符串 "[object HTMLElement]"：
        //   ① 所有容器被并成同一个 → 只排第一个容器，其余列表完全不动；
        //   ② 非人物子节点也被当成人物项 → 重排时算出 undefined，appendChild 抛异常，
        //      且页面原有的兄弟节点被顶到错误位置。
        function push(map, key, val) {
            for (var i = 0; i < map.length; i++) {
                if (map[i].key === key) { map[i].val.push(val); return; }
            }
            map.push({ key: key, val: [val] });
        }

        // 找出所有需要排序的容器
        function buildLists() {
            var items = collectItems();
            var lists = [], i;
            var byParent = [];
            for (i = 0; i < items.length; i++) {
                if (items[i].parentElement) push(byParent, items[i].parentElement, items[i]);
            }
            var loners = [];
            for (i = 0; i < byParent.length; i++) {
                if (byParent[i].val.length >= 2) {
                    lists.push({ container: byParent[i].key, elements: byParent[i].val, kind: 'items' });
                } else {
                    loners.push(byParent[i].val[0]);
                }
            }
            // 兜底：卡片被单独包了一层（例如 closest 命中了卡片内部的 cursor-pointer）
            // → 改成按"外层卡片"排序
            var byGrand = [];
            for (i = 0; i < loners.length; i++) {
                var wrap = loners[i].parentElement;
                var grand = wrap && wrap.parentElement;
                if (!grand || !wrap.children) continue;
                if (wrap.children.length > 8) continue;               // 外层太大，多半不是卡片
                try { if (wrap.querySelectorAll(LV).length !== 1) continue; } catch (e) { continue; }
                push(byGrand, grand, wrap);
            }
            for (i = 0; i < byGrand.length; i++) {
                if (byGrand[i].val.length >= 2) {
                    lists.push({ container: byGrand[i].key, elements: byGrand[i].val, kind: 'wrappers' });
                }
            }
            return lists;
        }

        // ---------- 应用顺序 ----------
        function kidsOf(container) { return toArray(container.children); }

        function sameOrder(a, b) {
            if (a.length !== b.length) return false;
            for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
            return true;
        }

        function sameSet(a, b) {
            if (a.length !== b.length) return false;
            for (var i = 0; i < b.length; i++) if (a.indexOf(b[i]) < 0) return false;
            return true;
        }

        // 把 elements（容器的直接子节点子集）按目标顺序摊回完整子节点序列
        function buildSequence(container, elements) {
            var i;
            for (i = 0; i < elements.length; i++) {
                if (elements[i].parentElement !== container) return null;
            }
            var children = kidsOf(container);
            var seq = [], idx = 0;
            for (i = 0; i < children.length; i++) {
                if (elements.indexOf(children[i]) >= 0) { seq.push(elements[idx]); idx++; }
                else seq.push(children[i]);
            }
            if (idx !== elements.length || seq.length !== children.length) return null;
            return seq;
        }

        // flex / grid 容器可以用 CSS order 改变显示顺序：完全不动物理 DOM，
        // 因此不会被 React/Vue 的重绘覆盖，也不会把框架的虚拟 DOM 弄乱
        // （这正是"翻页/切标签后排序失效甚至页面卡住"的常见原因）。
        function canUseCssOrder(container) {
            try {
                var d = win.getComputedStyle(container).display;
                if (!(d === 'flex' || d === 'inline-flex' || d === 'grid' || d === 'inline-grid')) return false;
                var first = container.firstElementChild;
                if (!first) return false;
                var cs = win.getComputedStyle(first);
                if (cs.position === 'absolute' || cs.position === 'fixed') return false;   // 脱离文档流，order 无效
                // 网格里被显式指定行列的子项也不吃 order
                if (cs.gridColumnStart && cs.gridColumnStart !== 'auto') return false;
                if (cs.gridRowStart && cs.gridRowStart !== 'auto') return false;
                return true;
            } catch (e) {
                return false;
            }
        }

        function rememberOriginal(container) {
            var children = kidsOf(container), i;
            for (i = 0; i < snapshots.length; i++) {
                if (snapshots[i].container === container) {
                    if (!sameSet(snapshots[i].order, children)) snapshots[i].order = children;
                    return;
                }
            }
            snapshots.push({ container: container, order: children });
        }

        // 返回 true 表示本次确实做了调整
        function applySequence(container, seq) {
            var i;
            if (canUseCssOrder(container)) {
                for (i = 0; i < seq.length; i++) {
                    var el = seq[i];
                    if (!el.style) continue;
                    var v = String(i);
                    if (el.style.order !== v) {
                        el.style.order = v;
                        if (orderedEls.indexOf(el) < 0) orderedEls.push(el);
                    }
                }
                return true;
            }
            if (sameOrder(kidsOf(container), seq)) return false;   // 已经是目标顺序，不再搬动 DOM
            rememberOriginal(container);
            for (i = 0; i < seq.length; i++) container.appendChild(seq[i]);
            return true;
        }

        function restoreAll() {
            var i, j;
            for (i = 0; i < orderedEls.length; i++) {
                try { orderedEls[i].style.order = ''; } catch (e) { }
            }
            orderedEls = [];
            for (i = 0; i < snapshots.length; i++) {
                var c = snapshots[i].container, orig = snapshots[i].order;
                if (!c || !c.isConnected) continue;
                if (!sameSet(orig, kidsOf(c))) continue;
                for (j = 0; j < orig.length; j++) c.appendChild(orig[j]);
            }
            snapshots = [];
            log('已恢复原始顺序');
        }

        function sortLists() {
            if (!active) return;
            var lists = buildLists(), changed = 0, i;
            for (i = 0; i < lists.length; i++) {
                try {
                    var list = lists[i];
                    var sorted = list.elements.slice().sort(function (a, b) {
                        return (lvOf(a) - lvOf(b)) * dir;
                    });
                    var seq = buildSequence(list.container, sorted);
                    if (!seq) continue;
                    if (applySequence(list.container, seq)) changed++;
                } catch (e) {
                    warn('排序出错：', e && e.message);
                }
            }
            var report = lists.length + '/' + changed;
            if (report !== lastReport) {
                lastReport = report;
                log('容器=' + lists.length + '，本次调整=' + changed + (lists.length ? '' : '（未发现可排序列表）'));
            }
        }

        // ---------- 控制条 ----------
        function minLabel() {
            if (!active) return '⇅ 已关';
            return dir === 1 ? '⇅ 升序' : '⇅ 降序';
        }

        // 收起 / 展开
        function applyMin() {
            if (panel) {
                panel.className = minimized ? 'min' : '';
                // 不依赖注入的 CSS（可能被旧样式或页面样式干扰）：直接内联控制显隐
                var kids = panel.children, i;
                for (i = 0; i < kids.length; i++) {
                    if (kids[i] === minBtn || !kids[i].style) continue;
                    kids[i].style.display = minimized ? 'none' : '';
                }
            }
            if (minBtn) {
                minBtn.textContent = minimized ? minLabel() : '—';
                minBtn.title = minimized ? '展开控制条（排序仍在生效）' : '收起为小按钮';
            }
        }

        // 页面上若残留旧版脚本创建的同名控制条（两个条叠在同一位置，容易误以为新功能没生效），清掉它
        function dropStalePanels() {
            if (!panel) return;   // 自己还没建出控制条时不要乱删
            var list;
            try { list = doc.querySelectorAll('#tgLvPanel'); } catch (e) { return; }
            for (var i = 0; i < list.length; i++) {
                if (list[i] === panel) continue;
                if (list[i].getAttribute && list[i].getAttribute('data-lvsort') === VERSION) continue;
                try {
                    var par = list[i].parentNode || list[i].parentElement;
                    if (par && par.removeChild) par.removeChild(list[i]);
                    say('已移除页面里残留的旧版控制条（请到油猴/组件里删掉旧脚本）');
                } catch (e) { }
            }
        }

        function refreshPanel() {
            if (!stateEl || !powerBtn) return;
            stateEl.textContent = active ? (dir === 1 ? '运行中 · Lv 升序' : '运行中 · Lv 降序') : '已关闭';
            powerBtn.textContent = active ? '关闭' : '开启';
            powerBtn.className = 'tg-main' + (active ? '' : ' off');
            applyMin();
        }

        function buildPanel() {
            if (panel || !doc.body) return;
            var p = doc.createElement('div');
            p.id = 'tgLvPanel';
            p.setAttribute('data-lvsort', VERSION);
            p.title = '小圣杯 Lv 排序 v' + VERSION + '（最右的 — 可收起 / 展开）';
            stateEl = doc.createElement('span'); stateEl.id = 'tgLvState'; stateEl.className = 'tg-main';
            var dirBtn = doc.createElement('button'); dirBtn.textContent = '⇅ 切换'; dirBtn.className = 'tg-main';
            var rescanBtn = doc.createElement('button'); rescanBtn.textContent = '↻ 重排'; rescanBtn.className = 'tg-main';
            powerBtn = doc.createElement('button');
            minBtn = doc.createElement('button');
            minBtn.id = 'tgLvMin';
            dirBtn.onclick = function () {
                if (!active) return;
                dir = dir === 1 ? -1 : 1;
                if (ls) { try { ls.setItem(K_DIR, dir === 1 ? 'asc' : 'desc'); } catch (e) { } }
                sortLists(); refreshPanel();
            };
            // 手动兜底：翻页后若没自动排上，点它强制重新扫描并排序
            rescanBtn.onclick = function () {
                lastReport = '';
                sortLists();
                refreshPanel();
                say('手动重排，当前识别到的列表：', buildDebugInfo());
            };
            powerBtn.onclick = function () {
                active = !active;
                if (ls) { try { ls.setItem(K_ON, active ? '1' : '0'); } catch (e) { } }
                if (active) sortLists(); else restoreAll();
                refreshPanel();
            };
            // 收起 / 展开（状态会被记住）
            minBtn.onclick = function () {
                minimized = !minimized;
                if (ls) { try { ls.setItem(K_MIN, minimized ? '1' : '0'); } catch (e) { } }
                applyMin();
                say(minimized ? '控制条已收起（排序继续生效，点小按钮可展开）' : '控制条已展开');
            };
            p.appendChild(stateEl); p.appendChild(dirBtn); p.appendChild(rescanBtn);
            p.appendChild(powerBtn); p.appendChild(minBtn);
            doc.body.appendChild(p);
            panel = p;
            refreshPanel();
            // 始终打印版本，方便确认到底哪一版在跑
            say('控制条已显示 v' + VERSION + '（' + (minimized ? '已收起' : '已展开') + '，按钮：⇅ 切换 / ↻ 重排 / 关闭 / — 收起）');
        }

        // ---------- 调试接口：控制台执行 __tgLvSortDebug() ----------
        function describe(el) {
            if (!el || !el.tagName) return '?';
            var s = el.tagName.toLowerCase();
            if (el.id) s += '#' + el.id;
            if (el.className && typeof el.className === 'string') {
                var cls = el.className.replace(/\s+/g, ' ').replace(/^ | $/g, '').split(' ').slice(0, 3).join('.');
                if (cls) s += '.' + cls;
            }
            return s;
        }

        function buildDebugInfo() {
            var lists = buildLists(), out = [], i, j;
            for (i = 0; i < lists.length; i++) {
                var lvs = [], tagSeq = [];
                for (j = 0; j < lists[i].elements.length; j++) lvs.push(lvOf(lists[i].elements[j]));
                var display = '?';
                try { display = win.getComputedStyle(lists[i].container).display; } catch (e) { }
                var ks = kidsOf(lists[i].container);
                for (j = 0; j < ks.length && j < 20; j++) tagSeq.push(describe(ks[j]));
                out.push({
                    container: describe(lists[i].container),
                    kind: lists[i].kind,
                    display: display,
                    children: ks.length,
                    items: lists[i].elements.length,
                    lv: lvs,
                    childrenTags: tagSeq
                });
            }
            return {
                version: VERSION,
                active: active,
                dir: dir === 1 ? 'asc' : 'desc',
                lists: out,
                cssOrdered: orderedEls.length,
                domMoved: snapshots.length,
                panel: !!panel,
                minimized: minimized,
                url: (function () { try { return win.location.href; } catch (e) { return '?'; } })()
            };
        }

        win.__tgLvSortDebug = function () {
            verbose = true;
            var info = buildDebugInfo();
            log('调试信息', info);
            return info;
        };

        // ---------- 调度 ----------
        function tick() {
            if (!doc.body) return;
            ensureStyle();
            var href = '';
            try { href = win.location.href; } catch (e) { }
            if (href !== lastHref) { lastHref = href; log('地址变化：', href); }
            // 面板被框架重绘掉时补回来
            if (panel && (!panel.isConnected || !doc.body.contains(panel))) panel = null;
            if (!panel && doc.querySelector(LV)) buildPanel();
            dropStalePanels();
            if (active) sortLists();
        }

        // 框架常在数据返回 / 翻页后再重绘一次，多追几拍
        var burstTimer = null;
        function scheduleBurst() {
            if (!active || burstTimer) return;
            burstTimer = setTimeout(function () {
                burstTimer = null;
                sortLists();
                setTimeout(function () { if (active) sortLists(); }, 150);
                setTimeout(function () { if (active) sortLists(); }, 500);
                setTimeout(function () { if (active) sortLists(); }, 1200);
            }, 80);
        }

        ensureStyle();
        if (doc.querySelector(LV)) buildPanel();
        dropStalePanels();
        if (active) sortLists();

        try {
            new win.MutationObserver(scheduleBurst)
                .observe(doc.documentElement || doc.body, { childList: true, subtree: true });
        } catch (e) { }

        setInterval(tick, 800);
        setTimeout(function () { if (active) sortLists(); }, 300);
        setTimeout(function () { if (active) sortLists(); }, 1000);
        setTimeout(function () { if (active) sortLists(); }, 2500);

        log('脚本载入 v' + VERSION + '：', win.location.href);
    }

    // 跨同源 iframe 扫描（组件只注入顶层时也能作用到内部榜单 / 人物网格）
    function scan(win, depth) {
        var doc;
        try { doc = win.document; } catch (e) { return; }
        if (!doc) return;
        initInWindow(win);
        if (depth > 4) return;
        var frames = doc.querySelectorAll('iframe'), i;
        for (i = 0; i < frames.length; i++) {
            try {
                var w = frames[i].contentWindow;
                if (w) scan(w, depth + 1);
            } catch (e) { }
        }
    }

    function topScan() {
        try { scan(window, 0); } catch (e) { }
    }

    setTimeout(topScan, 300);
    setTimeout(topScan, 1200);
    setTimeout(topScan, 3000);
    // 后加载的 iframe / 动态插入的榜单
    setInterval(function () {
        try { if (window === window.top) topScan(); } catch (e) { }
    }, 4000);
})();
