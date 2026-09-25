/* ============================================================================
 * 小圣杯 Lv 排序 · 页面结构诊断脚本（v1）
 *
 * 用法：
 *   1. 打开出问题的页面（例：超展开 → 英灵殿 → 第 15 页；或个人主页人物列表翻页后）
 *   2. 按 F12 → 切到 Console（控制台）
 *   3. 把本文件全部内容粘贴进去 → 回车
 *   4. 控制台会打印一段 ===LVSORT-DIAG v1 BEGIN=== ... END=== 的报告（同时已复制到剪贴板）
 *   5. 把这段内容整段发回来即可
 *
 * 说明：脚本只读取页面结构，不修改、不上传任何东西。
 * ========================================================================== */
(function () {
    'use strict';

    var MAX_DEPTH = 4;
    var OUT = [];
    var seen = 0;

    function push(s) { OUT.push(s); }

    function cls(el) {
        var c = el.getAttribute && el.getAttribute('class');
        if (!c) return '';
        var parts = String(c).replace(/\s+/g, ' ').replace(/^ | $/g, '').split(' ');
        return parts.slice(0, 4).join('.') + (parts.length > 4 ? '…' : '');
    }

    function describe(el) {
        if (!el || !el.tagName) return '?';
        var s = el.tagName.toLowerCase();
        if (el.id) s += '#' + el.id;
        var c = cls(el);
        if (c) s += '.' + c;
        return s;
    }

    function tagSeq(el, max) {
        var out = [], kids = el.children, i;
        for (i = 0; i < kids.length && i < max; i++) out.push(describe(kids[i]));
        if (kids.length > max) out.push('…共' + kids.length + '个');
        return out.join(' | ');
    }

    function lvOf(item) {
        var b = null;
        try { b = item.querySelector('[id="tg-level-badge"][data-level]'); } catch (e) { }
        if (!b) {
            try { b = item.querySelector('[data-level]'); } catch (e) { }
        }
        if (!b) return '?';
        var v = b.getAttribute('data-level');
        return v == null ? '?' : v;
    }

    function itemAttrs(item) {
        var a = [], at = item.attributes, i;
        for (i = 0; i < at.length && i < 8; i++) {
            if (at[i].name === 'class' || at[i].name === 'style') continue;
            a.push(at[i].name + '=' + String(at[i].value).slice(0, 30));
        }
        return a.join(' ');
    }

    function trimHtml(el, n) {
        var h = '';
        try { h = el.outerHTML || ''; } catch (e) { h = '(无法读取)'; }
        h = h.replace(/\s+/g, ' ');
        return h.length > n ? h.slice(0, n) + ' …(共' + h.length + '字符)' : h;
    }

    // 容器里的真实显示顺序：flex/grid 按 (order, DOM 序)
    function visualItems(container, items) {
        var display = '';
        try { display = container.ownerDocument.defaultView.getComputedStyle(container).display; } catch (e) { }
        var kids = Array.prototype.slice.call(container.children);
        if (!/flex|grid/.test(display)) return items.slice();
        var dec = kids.map(function (n, i) {
            var o = 0;
            try { o = parseInt(n.ownerDocument.defaultView.getComputedStyle(n).order, 10) || 0; } catch (e) { }
            return { n: n, i: i, o: o };
        });
        dec.sort(function (a, b) { return (a.o - b.o) || (a.i - b.i); });
        var out = [];
        dec.forEach(function (d) { if (items.indexOf(d.n) >= 0) out.push(d.n); });
        return out;
    }

    function scanDoc(win, depth, label) {
        var doc;
        try { doc = win.document; } catch (e) { return; }
        if (!doc || !doc.documentElement) return;

        var url = '?';
        try { url = win.location.href; } catch (e) { }
        var badges = [];
        try { badges = doc.querySelectorAll('[id="tg-level-badge"][data-level]'); } catch (e) { }
        var anyLevel = [];
        try { anyLevel = doc.querySelectorAll('[data-level]'); } catch (e) { }
        var charIds = [];
        try { charIds = doc.querySelectorAll('[data-character-id]'); } catch (e) { }
        var cursors = [];
        try { cursors = doc.querySelectorAll('[class*="cursor-pointer"]'); } catch (e) { }

        push('');
        push('[' + label + '] ' + url + '  readyState=' + doc.readyState);
        push('  badges(tg-level-badge[data-level])=' + badges.length +
            ' ; [data-level]=' + anyLevel.length +
            ' ; [data-character-id]=' + charIds.length +
            ' ; [class*=cursor-pointer]=' + cursors.length);

        // 徽标自身的属性，确认选择器是否命中
        if (badges.length) {
            push('  badge[0]: ' + describe(badges[0]) + '  attrs: ' + itemAttrs(badges[0]) +
                '  parents: ' + describe(badges[0].parentElement) + ' < ' + describe(badges[0].parentElement && badges[0].parentElement.parentElement));
        } else if (anyLevel.length) {
            push('  [!] 有 [data-level] 但没有 id="tg-level-badge"：' + describe(anyLevel[0]) + ' attrs: ' + itemAttrs(anyLevel[0]));
        }

        // 面板 / 脚本状态
        var panel = doc.getElementById('tgLvPanel');
        push('  panel=' + (panel ? '有（' + panel.textContent + '）' : '无') +
            ' ; __tgLvSortInit=' + !!win.__tgLvSortInit);

        // 按 closest 结果分组
        var items = [], i, it;
        for (i = 0; i < badges.length; i++) {
            it = null;
            try { it = badges[i].closest('[data-character-id], [class*="cursor-pointer"]'); } catch (e) { }
            if (!it) it = badges[i].parentElement;
            if (it && items.indexOf(it) < 0) items.push(it);
        }

        var groups = [];
        items.forEach(function (item) {
            var p = item.parentElement;
            if (!p) return;
            for (var k = 0; k < groups.length; k++) {
                if (groups[k].parent === p) { groups[k].items.push(item); return; }
            }
            groups.push({ parent: p, items: [item] });
        });

        var shown = 0;
        groups.forEach(function (g) {
            if (g.items.length < 2 || shown >= 4) return;
            shown++;
            var display = '?', pos = '?';
            try {
                var cs = g.parent.ownerDocument.defaultView.getComputedStyle(g.parent);
                display = cs.display; pos = cs.position;
            } catch (e) { }
            push('  --- 容器#' + shown + ': ' + describe(g.parent) +
                '  display=' + display + ' position=' + pos +
                ' children=' + g.parent.children.length + ' items=' + g.items.length);
            push('    item 示例: ' + describe(g.items[0]) + (itemAttrs(g.items[0]) ? '  [' + itemAttrs(g.items[0]) + ']' : ''));
            var domLv = g.items.map(lvOf);
            var viewLv = visualItems(g.parent, g.items).map(lvOf);
            push('    lv(dom顺序)  = ' + domLv.join(','));
            push('    lv(显示顺序) = ' + viewLv.join(','));
            push('    children = ' + tagSeq(g.parent, 12));
            push('    itemHTML = ' + trimHtml(g.items[0], 600));
            push('    containerHTML = ' + trimHtml(g.parent, 400));
        });

        // 每个卡片被单独包一层的情况（closest 命中卡片内部元素时会出现）
        var loners = groups.filter(function (g) { return g.items.length === 1; });
        if (loners.length >= 2) {
            push('  --- 疑似"卡片被包一层"结构（单条目父容器 ' + loners.length + ' 个）');
            var wrap = loners[0].items[0].parentElement;
            var grand = wrap && wrap.parentElement;
            push('    wrapper 示例: ' + describe(wrap) + ' children=' + (wrap ? wrap.children.length : '-') +
                ' 内含 badge 数=' + (wrap ? wrap.querySelectorAll('[data-level]').length : '-'));
            push('    wrapper 的父级: ' + describe(grand) + ' children=' + (grand ? grand.children.length : '-'));
            push('    wrapperHTML = ' + (wrap ? trimHtml(wrap, 400) : '-'));
        }

        // iframe 情况
        var frames = [];
        try { frames = doc.querySelectorAll('iframe'); } catch (e) { }
        if (frames.length) {
            var info = [];
            for (i = 0; i < frames.length && i < 8; i++) {
                var src = frames[i].getAttribute('src') || '(无 src)';
                var ok = false;
                try { ok = !!frames[i].contentDocument; } catch (e) { ok = false; }
                info.push('[' + i + '] ' + (ok ? '同源' : '跨域/不可读') + ' src=' + String(src).slice(0, 120));
            }
            push('  iframes(' + frames.length + '): ' + info.join(' ; '));
        }

        if (depth >= MAX_DEPTH) return;
        for (i = 0; i < frames.length; i++) {
            var w = null;
            try { w = frames[i].contentWindow; } catch (e) { w = null; }
            if (!w) continue;
            seen++;
            if (seen > 8) { push('  (iframe 太多，已省略)'); break; }
            try { scanDoc(w, depth + 1, label + '.' + i); } catch (e) {
                push('[' + label + '.' + i + '] 无法读取（跨域）：' + e.message);
            }
        }
    }

    var report;
    try {
        push('===LVSORT-DIAG v1 BEGIN===');
        push('UA: ' + navigator.userAgent);
        push('top: ' + location.href);
        scanDoc(window, 0, 'frame#0');
        push('');
        push('说明：把上面 BEGIN/END 之间的全部内容发回来即可。');
        push('===LVSORT-DIAG v1 END===');
        report = OUT.join('\n');
    } catch (e) {
        report = '===LVSORT-DIAG v1 BEGIN===\n诊断脚本出错：' + (e && e.message) + '\n===LVSORT-DIAG v1 END===';
    }

    try { console.log(report); } catch (e) { }
    try { copy(report); console.log('（报告已复制到剪贴板，直接粘贴发送即可）'); } catch (e) { }
    try { window.__lvsortDiag = report; } catch (e) { }
    return report;
})();
