#!/usr/bin/env node
/**
 * 由 tinygrail-lv-sort.user.js 生成 tinygrail-lv-sort.component.js（超合金组件版）。
 * 两份代码只有文件头不同，用本脚本保证不会写歪。
 *
 *   node build.js          生成 / 覆盖组件版
 *   node build.js --check  只校验组件版是否与油猴版同步
 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = __dirname;
var SRC = path.join(ROOT, 'tinygrail-lv-sort.user.js');
var OUT = path.join(ROOT, 'tinygrail-lv-sort.component.js');

var src = fs.readFileSync(SRC, 'utf8');
var m = src.match(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==[ \t]*\r?\n/m);
if (!m) {
    console.error('未找到 user.js 的 UserScript 头');
    process.exit(1);
}

var body = src.slice(m[0].length);
var ver = (src.match(/@version\s+(\S+)/) || [, '0.0.0'])[1];

var header = [
    '/* ==UserScript==',
    '   @name         小圣杯角色卡片 Lv 排序（超合金组件版）',
    '   @namespace    https://bgm.tv/',
    '   @version      ' + ver,
    '   @description  自动定位含角色卡片的(iframe)页面并按 Lv 排序；悬浮按钮切换升降序/关闭恢复原顺序',
    '   @match        *://bgm.tv/*',
    '   @match        *://bangumi.tv/*',
    '   @match        *://chii.in/*',
    '   ==/UserScript== */',
    ''
].join('\n');

var out = header + body;

if (process.argv.indexOf('--check') >= 0) {
    var cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
    if (cur !== out) {
        console.error('✗ tinygrail-lv-sort.component.js 与 user.js 不同步，请运行: node build.js');
        process.exit(1);
    }
    console.log('✓ component.js 与 user.js 同步 (v' + ver + ')');
    process.exit(0);
}

fs.writeFileSync(OUT, out);
console.log('✓ 已生成 tinygrail-lv-sort.component.js (v' + ver + ', ' + out.length + ' 字节)');
