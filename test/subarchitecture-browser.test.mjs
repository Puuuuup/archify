import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { desktopBrowser, desktopPointerCheck } from './helpers/desktop-browser.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const skillRoot = path.join(repoRoot, 'archify');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-subarchitecture-browser-'));
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;

function renderFixture({ withSubarchitecture = true } = {}) {
  const fixture = path.join(repoRoot, 'test', 'fixtures', 'transformer-subarchitecture.architecture.json');
  let input = fixture;
  if (!withSubarchitecture) {
    const parentOnly = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    delete parentOnly.components.find((component) => component.id === 'transformer').subarchitecture;
    input = path.join(scratch, 'transformer-parent-only.architecture.json');
    fs.writeFileSync(input, `${JSON.stringify(parentOnly, null, 2)}\n`);
  }
  const output = path.join(scratch, withSubarchitecture ? 'transformer.html' : 'transformer-parent-only.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'bin', 'archify.mjs'),
    'render',
    'architecture',
    input,
    output,
  ]);
  return output;
}

function renderBagel({ tall = false } = {}) {
  const source = JSON.parse(fs.readFileSync(path.join(repoRoot, 'website', 'examples', 'bagel-inference.architecture.json'), 'utf8'));
  // Exercise the checked-in geometry without fetching official code.
  delete source.meta.repository;
  for (const component of source.components) {
    delete component.sources;
    for (const local of component.subarchitecture?.components || []) {
      delete local.sources;
      if (tall && component.id === 'context') local.pos[1] *= 2;
    }
  }
  const stem = tall ? 'bagel-tall-context' : 'bagel-context';
  const input = path.join(scratch, stem + '.architecture.json');
  const output = path.join(scratch, stem + '.html');
  fs.writeFileSync(input, JSON.stringify(source));
  execFileSync(process.execPath, [path.join(skillRoot, 'bin', 'archify.mjs'), 'render', 'architecture', input, output]);
  return output;
}

async function evaluate(browser, sessionId, expression) {
  const response = await browser.cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description
      || response.exceptionDetails.text
      || 'Runtime.evaluate failed');
  }
  return response.result?.value;
}

async function load(browser, artifactPath, {
  width = 1440,
  height = 900,
  reducedMotion = false,
} = {}) {
  const sessionId = await browser.sessionPromise;
  await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
  await browser.cdp.send('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [{
      name: 'prefers-reduced-motion',
      value: reducedMotion ? 'reduce' : 'no-preference',
    }],
  }, sessionId);
  const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
  const navigation = await browser.cdp.send('Page.navigate', {
    url: pathToFileURL(artifactPath).href,
  }, sessionId);
  if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
  await loaded;
  await evaluate(browser, sessionId, `(async function () {
    document.documentElement.setAttribute('data-motion', 'still');
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    if (Archify.readerLayout && Archify.readerLayout.whenStable) await Archify.readerLayout.whenStable();
    await new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    });
    return true;
  })()`);
  return sessionId;
}

test('one-level internals support pointer, keyboard, exact deep links, Escape, and narrow layout', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture(), { width: 720, height: 900 });
    const opened = await evaluate(browser, sessionId, `(function () {
      var parent = document.querySelector('.diagram-container > svg [data-node-id="transformer"]');
      parent.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      var trigger = document.getElementById('btn-focus-internals');
      var triggerReady = !trigger.hidden && !trigger.disabled;
      var afterParentSelection = {
        parent: Archify.focus.active(),
        open: Archify.subarchitecture.active(),
        drawerHidden: document.getElementById('subarchitecture-drawer').hidden
      };
      trigger.click();
      var child = document.querySelector('#subarchitecture-mount [data-node-id="attention"]');
      child.focus();
      child.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      var columns = getComputedStyle(document.querySelector('.subarchitecture-drawer-content')).gridTemplateColumns;
      return {
        triggerReady: triggerReady,
        afterParentSelection: afterParentSelection,
        parent: Archify.focus.active(),
        open: Archify.subarchitecture.active(),
        child: Archify.subarchitecture.child(),
        hash: location.hash,
        drawerHidden: document.getElementById('subarchitecture-drawer').hidden,
        mountedSvgCount: document.querySelectorAll('#subarchitecture-mount > svg').length,
        columnTrackCount: columns.trim().split(/\\s+/).length
      };
    })()`);

    assert.deepEqual(opened, {
      triggerReady: true,
      afterParentSelection: { parent: 'transformer', open: null, drawerHidden: true },
      parent: 'transformer',
      open: 'transformer',
      child: 'attention',
      hash: '#subgraph=transformer&subfocus=attention',
      drawerHidden: false,
      mountedSvgCount: 1,
      columnTrackCount: 1,
    });

    const escaped = await evaluate(browser, sessionId, `(function () {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      var afterChild = {
        open: Archify.subarchitecture.active(),
        child: Archify.subarchitecture.child(),
        hash: location.hash
      };
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return {
        afterChild: afterChild,
        open: Archify.subarchitecture.active(),
        hash: location.hash,
        drawerHidden: document.getElementById('subarchitecture-drawer').hidden,
        restoredFocus: document.activeElement && document.activeElement.id
      };
    })()`);

    assert.deepEqual(escaped, {
      afterChild: { open: 'transformer', child: null, hash: '#subgraph=transformer' },
      open: null,
      hash: '#focus=transformer',
      drawerHidden: true,
      restoredFocus: 'btn-focus-internals',
    });
  } finally {
    await browser.close();
  }
});

test('a closed subarchitecture is layout-transparent to the complete parent Viewer', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  async function receipt(artifactPath) {
    const sessionId = await load(browser, artifactPath, { width: 1440, height: 900 });
    return evaluate(browser, sessionId, `(async function () {
      if (Archify.readerLayout && Archify.readerLayout.measure) Archify.readerLayout.measure();
      if (Archify.viewerChromeLayout && Archify.viewerChromeLayout.measure) Archify.viewerChromeLayout.measure();
      if (Archify.readerLayout && Archify.readerLayout.whenStable) await Archify.readerLayout.whenStable();
      await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
      var diagram = document.querySelector('.diagram-container');
      var svg = document.querySelector('.diagram-container > svg');
      var cards = document.querySelector('.cards');
      var diagramRect = diagram.getBoundingClientRect();
      var cardsRect = cards.getBoundingClientRect();
      return {
        parentSvg: svg.outerHTML,
        readerWidth: getComputedStyle(document.documentElement).getPropertyValue('--archify-reader-width'),
        diagram: [diagramRect.left, diagramRect.top, diagramRect.width, diagramRect.height],
        cardsTop: cardsRect.top,
        scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
        drawerHidden: document.getElementById('subarchitecture-drawer').hidden,
        disclosureCount: document.querySelectorAll('[data-subarchitecture-disclosure]').length
      };
    })()`);
  }

  try {
    const parentOnly = await receipt(renderFixture({ withSubarchitecture: false }));
    const additive = await receipt(renderFixture({ withSubarchitecture: true }));
    assert.deepEqual(additive, parentOnly);
    assert.equal(additive.drawerHidden, true);
    assert.equal(additive.disclosureCount, 0);
  } finally {
    await browser.close();
  }
});

test('the representative child expands below the parent and restores laptop reading position', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  const artifact = path.join(scratch, 'transformer-laptop.html');
  execFileSync(process.execPath, [path.join(skillRoot, 'bin', 'archify.mjs'), 'render', 'architecture',
    path.join(skillRoot, 'examples', 'transformer-layer.architecture.json'), artifact]);
  try {
    for (const [width, height] of [[1366, 768], [1280, 720]]) {
      const sessionId = await load(browser, artifact, { width, height });
      const receipt = await evaluate(browser, sessionId, `(async function () {
        var parent = document.querySelector('.diagram-container > svg');
        Archify.focus.set('transformer', { toggle: false, updateUrl: false });
        await Archify.readerLayout.whenStable();
        window.scrollTo({ top: 48, behavior: 'instant' });
        await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
        function parentState() {
          var rect = parent.getBoundingClientRect();
          return { viewBox: parent.getAttribute('viewBox'), transform: parent.style.transform, scroll: [scrollX, scrollY],
            width: rect.width, height: rect.height, documentTop: rect.top + scrollY };
        }
        var before = parentState();
        document.getElementById('btn-focus-internals').click();
        await Archify.readerLayout.whenStable();
        await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
        var svg = document.querySelector('#subarchitecture-mount > svg');
        var stage = document.querySelector('.subarchitecture-stage').getBoundingClientRect();
        var rect = svg.getBoundingClientRect();
        var vb = svg.viewBox.baseVal;
        var scale = Math.min(rect.width / vb.width, rect.height / vb.height);
        var primary = Math.min.apply(null, Array.from(svg.querySelectorAll('[data-node-label]')).map(function (n) { return parseFloat(getComputedStyle(n).fontSize) * scale; }));
        var contained = Array.from(svg.querySelectorAll('[data-node-id]')).every(function (n) {
          var r = n.getBoundingClientRect();
          return r.left >= stage.left && r.right <= stage.right && r.top >= stage.top && r.bottom <= stage.bottom;
        });
        var back = document.getElementById('subarchitecture-back').getBoundingClientRect();
        var backVisible = back.top >= 0 && back.bottom <= innerHeight && back.left >= 0 && back.right <= innerWidth;
        var exportButton = document.getElementById('btn-export').getBoundingClientRect();
        var exportVisible = exportButton.top >= 0 && exportButton.bottom <= innerHeight && exportButton.left >= 0 && exportButton.right <= innerWidth;
        var drawer = document.getElementById('subarchitecture-drawer');
        var inline = getComputedStyle(drawer).position !== 'fixed' &&
          drawer.getBoundingClientRect().top >= document.querySelector('.diagram-container').getBoundingClientRect().bottom;
        var entryScrolled = scrollY > before.scroll[1];
        var openParent = parentState();
        Archify.subarchitecture.focus('attention', { updateUrl: false });
        await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
        var selectedRect = svg.getBoundingClientRect();
        var graphSizeStable = selectedRect.width === rect.width && selectedRect.height === rect.height;
        document.getElementById('subarchitecture-back').click();
        await Archify.readerLayout.whenStable();
        await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
        return { contained: contained, primary: primary, backVisible: backVisible, exportVisible: exportVisible, closed: Archify.subarchitecture.active() === null,
          inline: inline, entryScrolled: entryScrolled, graphSizeStable: graphSizeStable,
          openParent: openParent, before: before, after: parentState() };
      })()`);
      assert.equal(receipt.contained, true, `${width}x${height}: every child node fits`);
      assert.ok(receipt.primary >= 10, `${width}x${height}: primary labels are ${receipt.primary}px`);
      assert.equal(receipt.backVisible, true);
      assert.equal(receipt.exportVisible, true);
      assert.equal(receipt.closed, true);
      assert.equal(receipt.inline, true);
      assert.equal(receipt.entryScrolled, true);
      assert.equal(receipt.graphSizeStable, true);
      assert.deepEqual({ ...receipt.openParent, scroll: receipt.before.scroll }, receipt.before);
      assert.deepEqual(receipt.after, receipt.before);
    }
  } finally { await browser.close(); }
});

test('the BAGEL context child fits desktop height and adapts when the viewport changes', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const artifact = renderBagel();
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, artifact, { width: 1366, height: 768 });
    await evaluate(browser, sessionId, `Archify.focus.set('context', { toggle: false, updateUrl: false });
      document.getElementById('btn-focus-internals').click();`);
    let first = true;
    for (const [width, height] of [[1366, 768], [1920, 1080], [1280, 720], [1366, 768]]) {
      await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
      const receipt = await evaluate(browser, sessionId, `(async function () {
        await new Promise(function (resolve) { setTimeout(resolve, 80); });
        await Archify.layoutStability.whenStable();
        ${first ? '' : "document.getElementById('subarchitecture-drawer').scrollIntoView({ block: 'start', behavior: 'instant' });"}
        await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
        var svg = document.querySelector('#subarchitecture-mount > svg');
        var matrix = svg.getScreenCTM();
        var rect = svg.getBoundingClientRect();
        return {
          visible: rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth,
          primary: Math.min.apply(null, Array.from(svg.querySelectorAll('[data-node-label]')).map(function (label) {
            return parseFloat(getComputedStyle(label).fontSize) * Math.hypot(matrix.a, matrix.b);
          })),
          pageWidth: document.documentElement.scrollWidth,
          nodes: svg.querySelectorAll('[data-node-id]').length,
          height: rect.height,
          top: rect.top,
          bottom: rect.bottom
        };
      })()`);
      assert.equal(receipt.visible, true, `${width}x${height}: complete context child fits the viewport (${JSON.stringify(receipt)})`);
      assert.ok(receipt.primary >= 10, `${width}x${height}: primary labels are ${receipt.primary}px`);
      assert.ok(receipt.pageWidth <= width);
      assert.equal(receipt.nodes, 8);
      first = false;
    }
  } finally { await browser.close(); }
});

test('taller desktop children keep readable labels and allow page scrolling', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderBagel({ tall: true }), { width: 1366, height: 640 });
    const receipt = await evaluate(browser, sessionId, `(async function () {
      Archify.focus.set('context', { toggle: false, updateUrl: false });
      document.getElementById('btn-focus-internals').click();
      await Archify.layoutStability.whenStable();
      var svg = document.querySelector('#subarchitecture-mount > svg');
      var matrix = svg.getScreenCTM();
      var primary = Math.min.apply(null, Array.from(svg.querySelectorAll('[data-node-label]')).map(function (label) {
        return parseFloat(getComputedStyle(label).fontSize) * Math.hypot(matrix.a, matrix.b);
      }));
      var before = scrollY;
      window.scrollBy({ top: 160, behavior: 'instant' });
      var back = document.getElementById('subarchitecture-back').getBoundingClientRect();
      return { primary: primary, scrolled: scrollY > before, backVisible: back.top >= 0 && back.bottom <= innerHeight,
        pageWidth: document.documentElement.scrollWidth, graphHeight: svg.getBoundingClientRect().height };
    })()`);
    assert.ok(receipt.primary >= 10, JSON.stringify(receipt));
    assert.equal(receipt.scrolled, true);
    assert.equal(receipt.backVisible, true);
    assert.ok(receipt.pageWidth <= 1366);
    assert.ok(receipt.graphHeight > 500);
  } finally { await browser.close(); }
});

test('narrow inline children scroll inside their stage and Escape restores the parent', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture(), { width: 720, height: 900 });
    const receipt = await evaluate(browser, sessionId, `(async function () {
      Archify.focus.set('transformer', { toggle: false, updateUrl: false });
      await Archify.readerLayout.whenStable();
      var before = [scrollX, scrollY];
      document.getElementById('btn-focus-internals').click();
      await Archify.readerLayout.whenStable();
      await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
      var stage = document.querySelector('.subarchitecture-stage');
      stage.scrollLeft = stage.scrollWidth;
      var overflowIsLocal = stage.scrollWidth > stage.clientWidth && stage.scrollLeft > 0 && document.documentElement.scrollWidth <= innerWidth;
      window.scrollBy({ top: 160, behavior: 'instant' });
      var back = document.getElementById('subarchitecture-back').getBoundingClientRect();
      var backVisible = back.top >= 0 && back.bottom <= innerHeight;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await Archify.readerLayout.whenStable();
      await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
      return { before: before, after: [scrollX, scrollY], overflowIsLocal: overflowIsLocal, backVisible: backVisible,
        closed: Archify.subarchitecture.active() === null, focus: document.activeElement.id };
    })()`);
    assert.equal(receipt.overflowIsLocal, true);
    assert.equal(receipt.backVisible, true);
    assert.equal(receipt.closed, true);
    assert.equal(receipt.focus, 'btn-focus-internals');
    assert.deepEqual(receipt.after, receipt.before);
  } finally { await browser.close(); }
});

test('local Semantic Passport reuses parent relationship colors and row styling', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture(), { width: 1440, height: 900 });
    const receipt = await evaluate(browser, sessionId, `(function () {
      Archify.focus.set('transformer', { toggle: false, updateUrl: false });
      Archify.subarchitecture.open('transformer', { updateUrl: false });
      var child = document.querySelector('#subarchitecture-mount [data-node-id="attention"]');
      child.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));

      function relationshipReceipt(root, direction) {
        var row = root.querySelector('.relationship-lens-row[data-direction="' + direction + '"]');
        var glyph = row && row.querySelector('.relationship-lens-direction');
        var rowStyle = row && getComputedStyle(row);
        return {
          exists: Boolean(row && glyph),
          glyphColor: glyph ? getComputedStyle(glyph).color : '',
          border: rowStyle ? rowStyle.borderTopWidth + ' ' + rowStyle.borderTopStyle : '',
          radius: rowStyle ? rowStyle.borderRadius : '',
          background: rowStyle ? rowStyle.backgroundColor : '',
          font: rowStyle ? rowStyle.fontFamily : '',
          ariaHidden: glyph ? glyph.getAttribute('aria-hidden') : null,
          hasAriaLabel: Boolean(row && row.getAttribute('aria-label'))
        };
      }

      var parent = document.getElementById('focus-chip');
      var local = document.getElementById('subarchitecture-passport');
      return {
        parentOut: relationshipReceipt(parent, 'out'),
        localOut: relationshipReceipt(local, 'out'),
        parentIn: relationshipReceipt(parent, 'in'),
        localIn: relationshipReceipt(local, 'in'),
        parentBorder: getComputedStyle(parent).borderTopColor,
        localBorder: getComputedStyle(local).borderTopColor
      };
    })()`);

    assert.equal(receipt.parentOut.exists, true);
    assert.equal(receipt.parentIn.exists, true);
    assert.deepEqual(receipt.localOut, receipt.parentOut);
    assert.deepEqual(receipt.localIn, receipt.parentIn);
    assert.notEqual(receipt.localOut.glyphColor, receipt.localIn.glyphColor);
    assert.equal(receipt.localBorder, receipt.parentBorder);
    assert.equal(receipt.localOut.ariaHidden, 'true');
    assert.equal(receipt.localOut.hasAriaLabel, true);
  } finally {
    await browser.close();
  }
});

test('local hover reuses the parent Intent Trace animation, colors, and one-hop directions', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = desktopBrowser(chromePath);
  try {
    const checkPointer = await desktopPointerCheck(browser, await browser.sessionPromise);
    const sessionId = await load(browser, renderFixture(), { width: 1440, height: 900 });
    await checkPointer();
    const receipt = await evaluate(browser, sessionId, `(async function () {
      document.documentElement.removeAttribute('data-motion');

      function flowReceipt(svg, direction) {
        var flow = svg.querySelector('.intent-trace-flow[data-direction="' + direction + '"]');
        var style = flow && getComputedStyle(flow);
        return {
          exists: Boolean(flow),
          stroke: style ? style.stroke : '',
          strokeWidth: style ? style.strokeWidth : '',
          linecap: style ? style.strokeLinecap : '',
          dasharray: style ? style.strokeDasharray : '',
          animationName: style ? style.animationName : '',
          animationDuration: style ? style.animationDuration : '',
          animationTiming: style ? style.animationTimingFunction : '',
          animationDirection: style ? style.animationDirection : '',
          pathLength: flow ? flow.getAttribute('pathLength') : null
        };
      }

      var parentSvg = document.querySelector('.diagram-container > svg');
      Archify.intentTrace.show('transformer');
      var parent = {
        out: flowReceipt(parentSvg, 'out'),
        in: flowReceipt(parentSvg, 'in')
      };
      Archify.intentTrace.clear({ announce: false });

      Archify.focus.set('transformer', { toggle: false, updateUrl: false });
      Archify.subarchitecture.open('transformer', { updateUrl: false });
      var localSvg = document.querySelector('#subarchitecture-mount > svg');
      var child = localSvg.querySelector('[data-node-id="attention"]');
      child.dispatchEvent(new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'mouse'
      }));
      await new Promise(function (resolve, reject) {
        var start = performance.now();
        function sample() {
          if (localSvg.getAttribute('data-intent-trace-active') === 'attention') return resolve();
          if (performance.now() - start > 5000) return reject(new Error('Child hover did not activate Intent Trace'));
          requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });

      var local = {
        active: localSvg.getAttribute('data-intent-trace-active'),
        overlays: localSvg.querySelectorAll('[data-intent-trace-overlay]').length,
        flows: localSvg.querySelectorAll('.intent-trace-flow').length,
        matchedEdges: localSvg.querySelectorAll('[data-edge-from][data-intent-trace-match]').length,
        matchedNodes: localSvg.querySelectorAll('[data-node-id][data-intent-trace-match]').length,
        selected: localSvg.querySelector('[data-intent-trace-selected]').getAttribute('data-node-id'),
        directions: Array.from(localSvg.querySelectorAll('.intent-trace-flow')).map(function (flow) {
          return flow.getAttribute('data-direction');
        }).sort(),
        out: flowReceipt(localSvg, 'out'),
        in: flowReceipt(localSvg, 'in')
      };

      child.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      local.afterClick = {
        intent: localSvg.getAttribute('data-intent-trace-active'),
        overlays: localSvg.querySelectorAll('[data-intent-trace-overlay]').length,
        focus: localSvg.getAttribute('data-focus-active')
      };
      return { parent: parent, local: local };
    })()`);

    assert.deepEqual(receipt.local.out, receipt.parent.out);
    assert.deepEqual(receipt.local.in, receipt.parent.in);
    assert.equal(receipt.local.active, 'attention');
    assert.equal(receipt.local.overlays, 1);
    assert.equal(receipt.local.flows, 2);
    assert.equal(receipt.local.matchedEdges, 2);
    assert.equal(receipt.local.matchedNodes, 3);
    assert.equal(receipt.local.selected, 'attention');
    assert.deepEqual(receipt.local.directions, ['in', 'out']);
    assert.equal(receipt.local.out.animationName, 'archify-intent-trace-flow');
    assert.equal(receipt.local.out.animationDuration, '1.15s');
    assert.deepEqual(receipt.local.afterClick, {
      intent: null,
      overlays: 0,
      focus: 'attention',
    });
  } finally {
    await browser.close();
  }
});

test('main and child export targets have readable labels on laptop and narrow screens', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const artifact = renderFixture();
    for (const [width, height] of [[1366, 768], [1280, 720], [390, 720]]) {
      const sessionId = await load(browser, artifact, { width, height });
      for (const theme of ['light', 'dark']) {
        const targets = await evaluate(browser, sessionId, `(async function () {
          document.documentElement.setAttribute('data-theme', '${theme}');
          Archify.subarchitecture.open('transformer', { updateUrl: false });
          await new Promise(function (resolve) {
            requestAnimationFrame(function () { requestAnimationFrame(resolve); });
          });
          document.getElementById('btn-export').click();
          return Array.from(document.querySelectorAll('#export-target-selector button')).map(function (button) {
            var label = button.querySelector('strong');
            var hint = button.querySelector('small');
            var labelRect = label.getBoundingClientRect();
            var hintRect = hint.getBoundingClientRect();
            return {
              target: button.getAttribute('data-export-target'),
              text: label.textContent,
              width: labelRect.width,
              height: labelRect.height,
              textFits: label.scrollWidth <= label.clientWidth + 1,
              separateLines: hintRect.top >= labelRect.bottom,
              visible: !button.hidden && labelRect.top >= 0 && labelRect.bottom <= innerHeight
                && labelRect.left >= 0 && labelRect.right <= innerWidth
            };
          });
        })()`);
        assert.deepEqual(targets.map((target) => target.target), ['main', 'subarchitecture']);
        assert.deepEqual(targets.map((target) => target.text), ['Main architecture', 'Transformer Layer Internals']);
        for (const target of targets) {
          const context = `${width}x${height} ${theme} ${target.target}`;
          assert.ok(target.width > 80 && target.height > 10, context);
          assert.equal(target.textFits, true, context);
          assert.equal(target.separateLines, true, context);
          assert.equal(target.visible, true, context);
        }
        await evaluate(browser, sessionId, `Archify.exportMenu.close(false)`);
      }
    }
  } finally {
    await browser.close();
  }
});

test('export target downloads only the selected subarchitecture and strips local viewer state', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    const sessionId = await load(browser, renderFixture(), { width: 1440, height: 900 });
    const receipt = await evaluate(browser, sessionId, `(async function () {
      var blobs = [];
      var filenames = [];
      var alerts = [];
      var originalCreateObjectUrl = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (blob) {
        blobs.push(blob);
        return originalCreateObjectUrl(blob);
      };
      document.addEventListener('click', function (event) {
        var anchor = event.target.closest('a[download]');
        if (anchor) filenames.push(anchor.download);
      }, true);
      window.alert = function (message) { alerts.push(String(message)); };

      var selector = document.getElementById('export-target-selector');
      var mainTarget = selector.querySelector('[data-export-target="main"]');
      var localTarget = selector.querySelector('[data-export-target="subarchitecture"]');
      var beforeOpen = {
        selectorHidden: selector.hidden,
        target: Archify.exportMenu.target()
      };

      Archify.focus.set('transformer', { toggle: false, updateUrl: false });
      Archify.subarchitecture.open('transformer', { updateUrl: false });
      Archify.subarchitecture.focus('attention', { updateUrl: false });
      document.getElementById('btn-export').click();
      var afterOpen = {
        selectorHidden: selector.hidden,
        target: Archify.exportMenu.target(),
        mainChecked: mainTarget.getAttribute('aria-checked'),
        localChecked: localTarget.getAttribute('aria-checked'),
        webmDisabled: document.querySelector('#export-menu [data-format="webm"]').disabled
      };
      localTarget.click();
      var selected = Archify.exportMenu.target() === 'subarchitecture';
      var selectedState = {
        target: Archify.exportMenu.target(),
        mainChecked: mainTarget.getAttribute('aria-checked'),
        localChecked: localTarget.getAttribute('aria-checked')
      };
      var localSvg = document.querySelector('#subarchitecture-mount > svg');
      var localViewBox = localSvg.viewBox.baseVal;
      var expectedPng = { width: localViewBox.width * 4, height: localViewBox.height * 4 };

      await Archify.exportMenu.run('svg');
      var svgBlob = blobs.filter(function (blob) { return blob.type.indexOf('image/svg+xml') === 0; }).slice(-1)[0];
      var exportedText = svgBlob ? await svgBlob.text() : '';
      var exportedSvg = new DOMParser().parseFromString(exportedText, 'image/svg+xml').documentElement;
      var svgState = {
        filename: filenames.slice(-1)[0] || '',
        type: svgBlob ? svgBlob.type : '',
        target: document.documentElement.getAttribute('data-last-export-target'),
        canonical: document.documentElement.getAttribute('data-last-export-canonical'),
        format: document.documentElement.getAttribute('data-last-export-format'),
        childIds: Array.from(exportedSvg.querySelectorAll('[data-node-id]')).map(function (node) {
          return node.getAttribute('data-node-id');
        }).sort(),
        hasParentTransformer: Boolean(exportedSvg.querySelector('[data-node-id="transformer"]')),
        focusResidue: exportedSvg.querySelectorAll('[data-focus-match], [data-focus-selected]').length,
        intentResidue: exportedSvg.querySelectorAll('[data-intent-trace-overlay], [data-intent-trace-match], [data-intent-trace-selected]').length,
        focusActive: exportedSvg.hasAttribute('data-focus-active'),
        pressedTrue: exportedSvg.querySelectorAll('[aria-pressed="true"]').length
      };

      blobs.length = 0;
      await Archify.exportMenu.run('png');
      var pngBlob = blobs.filter(function (blob) { return blob.type === 'image/png'; }).slice(-1)[0];
      var pngSize = await new Promise(function (resolve, reject) {
        var image = new Image();
        var url = originalCreateObjectUrl(pngBlob);
        image.onload = function () {
          URL.revokeObjectURL(url);
          resolve({ width: image.naturalWidth, height: image.naturalHeight });
        };
        image.onerror = reject;
        image.src = url;
      });
      var pngState = {
        filename: filenames.slice(-1)[0] || '',
        target: document.documentElement.getAttribute('data-last-export-target'),
        canonical: document.documentElement.getAttribute('data-last-export-canonical'),
        format: document.documentElement.getAttribute('data-last-export-format'),
        size: pngSize,
        expectedSize: expectedPng
      };

      blobs.length = 0;
      await Archify.exportMenu.run('share-card');
      var shareBlob = blobs.filter(function (blob) { return blob.type === 'image/png'; }).slice(-1)[0];
      var shareSize = await new Promise(function (resolve, reject) {
        var image = new Image();
        var url = originalCreateObjectUrl(shareBlob);
        image.onload = function () {
          URL.revokeObjectURL(url);
          resolve({ width: image.naturalWidth, height: image.naturalHeight });
        };
        image.onerror = reject;
        image.src = url;
      });
      var shareState = {
        filename: filenames.slice(-1)[0] || '',
        target: document.documentElement.getAttribute('data-last-export-target'),
        canonical: document.documentElement.getAttribute('data-last-export-canonical'),
        format: document.documentElement.getAttribute('data-last-export-format'),
        size: shareSize
      };

      document.getElementById('btn-export').click();
      mainTarget.click();
      await Archify.exportMenu.run('svg');
      var mainBlob = blobs.filter(function (blob) { return blob.type.indexOf('image/svg+xml') === 0; }).slice(-1)[0];
      var mainSvg = new DOMParser().parseFromString(await mainBlob.text(), 'image/svg+xml').documentElement;
      var mainState = {
        filename: filenames.slice(-1)[0] || '',
        target: document.documentElement.getAttribute('data-last-export-target'),
        hasParentTransformer: !!mainSvg.querySelector('[data-node-id="transformer"]'),
        hasChildAttention: !!mainSvg.querySelector('[data-node-id="attention"]'),
        childStillOpen: Archify.subarchitecture.active() === 'transformer',
        parentFocus: Archify.focus.active()
      };

      Archify.subarchitecture.close({ updateUrl: false, restoreFocus: false });
      var afterClose = {
        selectorHidden: selector.hidden,
        target: Archify.exportMenu.target(),
        localHidden: localTarget.hidden,
        parentFocus: Archify.focus.active()
      };
      return {
        beforeOpen: beforeOpen,
        afterOpen: afterOpen,
        selected: selected,
        selectedState: selectedState,
        svg: svgState,
        png: pngState,
        share: shareState,
        main: mainState,
        afterClose: afterClose,
        alerts: alerts
      };
    })()`);

    assert.deepEqual(receipt.beforeOpen, { selectorHidden: false, target: 'main' });
    assert.deepEqual(receipt.afterOpen, {
      selectorHidden: false,
      target: 'main',
      mainChecked: 'true',
      localChecked: 'false',
      webmDisabled: true,
    });
    assert.equal(receipt.selected, true);
    assert.deepEqual(receipt.selectedState, {
      target: 'subarchitecture',
      mainChecked: 'false',
      localChecked: 'true',
    });
    assert.match(receipt.svg.filename, /transformer-internals\.svg$/);
    assert.match(receipt.svg.type, /^image\/svg\+xml/);
    assert.equal(receipt.svg.target, 'subarchitecture');
    assert.equal(receipt.svg.canonical, 'true');
    assert.equal(receipt.svg.format, 'svg');
    assert.ok(receipt.svg.childIds.includes('attention'));
    assert.ok(receipt.svg.childIds.includes('layer_input'));
    assert.equal(receipt.svg.hasParentTransformer, false);
    assert.equal(receipt.svg.focusResidue, 0);
    assert.equal(receipt.svg.intentResidue, 0);
    assert.equal(receipt.svg.focusActive, false);
    assert.equal(receipt.svg.pressedTrue, 0);
    assert.match(receipt.png.filename, /transformer-internals\.png$/);
    assert.equal(receipt.png.target, 'subarchitecture');
    assert.equal(receipt.png.canonical, 'true');
    assert.equal(receipt.png.format, 'png');
    assert.deepEqual(receipt.png.size, receipt.png.expectedSize);
    assert.match(receipt.share.filename, /transformer-internals-share-card\.png$/);
    assert.equal(receipt.share.target, 'subarchitecture');
    assert.equal(receipt.share.canonical, 'true');
    assert.equal(receipt.share.format, 'share-card');
    assert.deepEqual(receipt.share.size, { width: 1200, height: 630 });
    assert.deepEqual(receipt.main, {
      filename: 'transformer-model-overview.svg',
      target: 'main',
      hasParentTransformer: true,
      hasChildAttention: false,
      childStillOpen: true,
      parentFocus: 'transformer',
    });
    assert.deepEqual(receipt.afterClose, {
      selectorHidden: false,
      target: 'main',
      localHidden: false,
      parentFocus: 'transformer',
    });
    assert.deepEqual(receipt.alerts, []);
  } finally {
    await browser.close();
  }
});

test('all authored children download independently without opening a child view', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  const downloads = fs.mkdtempSync(path.join(scratch, 'closed-child-download-'));
  const input = JSON.parse(fs.readFileSync(path.join(repoRoot, 'website/examples/bagel-inference.architecture.json'), 'utf8'));
  try {
    await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
    const sessionId = await load(browser, renderBagel(), { width: 1366, height: 768 });
    const before = await evaluate(browser, sessionId, `(async function () {
      window.exportBlobs = [];
      window.nativeDownloadClicks = [];
      var create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (blob) { window.exportBlobs.push(blob); return create(blob); };
      document.addEventListener('click', function (event) {
        var anchor = event.target.closest('a[download]');
        if (anchor) window.nativeDownloadClicks.push(anchor.download);
      }, true);
      document.documentElement.setAttribute('data-preset', 'blueprint');
      document.documentElement.setAttribute('data-theme', 'dark');
      await Archify.layoutStability.whenStable();
      Archify.focus.set('context', { toggle: false, updateUrl: false });
      var scroll = [scrollX, scrollY];
      document.getElementById('btn-export').click();
      return { scroll: scroll, hash: location.hash, parent: Archify.focus.active(), target: Archify.exportMenu.target(),
        labels: Array.from(document.querySelectorAll('#export-target-selector button')).filter(b => !b.hidden).map(b => b.querySelector('strong').textContent) };
    })()`);
    assert.deepEqual(before.labels, ['Main architecture', 'BAGEL Context Assembly', 'BAGEL MoT Decoder Layer']);
    assert.equal(before.target, 'main');
    assert.equal(before.parent, 'context');
    for (const parentId of ['context', 'mot']) {
      const started = browser.cdp.waitFor('Browser.downloadWillBegin');
      started.catch(() => {});
      const state = await evaluate(browser, sessionId, `(async function () {
        document.getElementById('btn-export').click();
        if (!Archify.exportMenu.isOpen()) document.getElementById('btn-export').click();
        document.querySelector('#export-menu [data-export-parent="${parentId}"]').click();
        await Archify.exportMenu.run('svg');
        var blob = window.exportBlobs.filter(b => b.type.startsWith('image/svg+xml')).at(-1);
        var svg = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml').documentElement;
        return { parent: Archify.focus.active(), child: Archify.subarchitecture.active(), targetParent: Archify.exportMenu.targetParent(),
          scroll: [scrollX, scrollY], hash: location.hash, preset: svg.getAttribute('data-preset'),
          mounted: document.querySelectorAll('#subarchitecture-mount > svg').length,
          nodeIds: Array.from(svg.querySelectorAll('[data-node-id]')).map(n => n.getAttribute('data-node-id')).sort(),
          clean: document.documentElement.getAttribute('data-last-export-canonical') };
      })()`);
      const download = await started;
      assert.match(download.suggestedFilename, new RegExp(parentId + '-internals\\.svg$'));
      const output = path.join(downloads, download.suggestedFilename);
      const deadline = Date.now() + 5000;
      while (!fs.existsSync(output) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
      assert.ok(fs.existsSync(output), 'Chrome must write each child SVG');
      const expectedIds = input.components.find(c => c.id === parentId).subarchitecture.components.map(c => c.id).sort();
      const actualIds = [...fs.readFileSync(output, 'utf8').matchAll(/data-node-id="([^"]+)"/g)].map(m => m[1]).sort();
      assert.deepEqual(actualIds, expectedIds);
      assert.deepEqual(state.nodeIds, expectedIds);
      assert.equal(state.child, null);
      assert.equal(state.mounted, 0);
      assert.equal(state.parent, before.parent);
      assert.equal(state.targetParent, parentId);
      assert.equal(state.preset, 'blueprint');
      assert.equal(state.hash, before.hash);
      assert.deepEqual(state.scroll, before.scroll);
      assert.equal(state.clean, 'true');
    }
    const raster = await evaluate(browser, sessionId, `(async function () {
      await Archify.exportMenu.run('png');
      var blob = window.exportBlobs.filter(b => b.type === 'image/png').at(-1);
      var bitmap = await createImageBitmap(blob);
      var template = document.querySelector('template[data-subarchitecture-parent="mot"]').content.querySelector('svg');
      var box = template.viewBox.baseVal;
      var size = [bitmap.width, bitmap.height]; bitmap.close();
      return { size: size, expected: [box.width * 4, box.height * 4], child: Archify.subarchitecture.active(), parent: Archify.focus.active(), clicks: window.nativeDownloadClicks };
    })()`);
    assert.deepEqual(raster.size, raster.expected);
    assert.equal(raster.child, null);
    assert.equal(raster.parent, 'context');
    assert.equal(raster.clicks.length, 3, 'every download uses the native anchor click');
  } finally { await browser.close(); }
});

test('export selection stays independent of the open child and survives closing it', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    const sessionId = await load(browser, renderBagel());
    const state = await evaluate(browser, sessionId, `(async function () {
      window.lastSvg = null;
      var create = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (blob) { if (blob.type.startsWith('image/svg+xml')) window.lastSvg = blob; return create(blob); };
      Archify.exportMenu.selectTarget('subarchitecture', 'context');
      Archify.focus.set('mot', { toggle: false, updateUrl: false });
      Archify.subarchitecture.open('mot', { updateUrl: false });
      await Archify.layoutStability.whenStable();
      await Archify.exportMenu.run('svg');
      var svg = new DOMParser().parseFromString(await window.lastSvg.text(), 'image/svg+xml').documentElement;
      var open = { view: Archify.subarchitecture.active(), target: Archify.exportMenu.targetParent(),
        nodeIds: Array.from(svg.querySelectorAll('[data-node-id]')).map(n => n.getAttribute('data-node-id')).sort() };
      Archify.exportMenu.selectTarget('subarchitecture', 'mot');
      Archify.subarchitecture.close({ updateUrl: false, restoreFocus: false });
      await Archify.exportMenu.run('svg');
      var closedSvg = new DOMParser().parseFromString(await window.lastSvg.text(), 'image/svg+xml').documentElement;
      return { open: open, closed: { view: Archify.subarchitecture.active(), target: Archify.exportMenu.targetParent(),
        nodeIds: Array.from(closedSvg.querySelectorAll('[data-node-id]')).map(n => n.getAttribute('data-node-id')).sort() } };
    })()`);
    const input = JSON.parse(fs.readFileSync(path.join(repoRoot, 'website/examples/bagel-inference.architecture.json'), 'utf8'));
    const ids = parent => input.components.find(c => c.id === parent).subarchitecture.components.map(c => c.id).sort();
    assert.deepEqual(state.open, { view: 'mot', target: 'context', nodeIds: ids('context') });
    assert.deepEqual(state.closed, { view: null, target: 'mot', nodeIds: ids('mot') });
  } finally { await browser.close(); }
});

test('a real child SVG download preserves parent selection through export and return', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  const downloads = fs.mkdtempSync(path.join(scratch, 'native-download-'));
  try {
    await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true });
    const sessionId = await load(browser, renderFixture(), { width: 1366, height: 768 });
    const before = await evaluate(browser, sessionId, `(async function () {
      window.nativeDownloadClicks = [];
      document.addEventListener('click', function (event) {
        var anchor = event.target.closest('a[download]');
        if (anchor) window.nativeDownloadClicks.push(anchor.download);
      }, true);
      document.querySelector('.diagram-container > svg [data-node-id="transformer"]').dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      var scroll = [scrollX, scrollY];
      document.getElementById('btn-focus-internals').click();
      await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
      return { parent: Archify.focus.active(), scroll: scroll };
    })()`);
    assert.equal(before.parent, 'transformer');
    const started = browser.cdp.waitFor('Browser.downloadWillBegin');
    started.catch(() => {});
    const afterDownload = await evaluate(browser, sessionId, `(async function () {
      document.getElementById('btn-export').click();
      document.querySelector('#export-menu [data-export-target="subarchitecture"]').click();
      document.querySelector('#export-menu [data-format="svg"]').click();
      await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
      return { parent: Archify.focus.active(), child: Archify.subarchitecture.active(), clicks: window.nativeDownloadClicks, target: document.documentElement.getAttribute('data-last-export-target') };
    })()`);
    const download = await started;
    assert.match(download.suggestedFilename, /transformer-internals\.svg$/);
    const output = path.join(downloads, download.suggestedFilename);
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(output) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(fs.existsSync(output), 'Chrome must write the real SVG download');
    const svg = fs.readFileSync(output, 'utf8');
    assert.match(svg, /data-node-id="attention"/);
    assert.doesNotMatch(svg, /data-node-id="transformer"/);
    assert.equal(afterDownload.clicks.length, 1, 'the native anchor click must reach the document observer');
    assert.equal(afterDownload.target, 'subarchitecture');
    assert.equal(afterDownload.child, 'transformer');
    assert.equal(afterDownload.parent, 'transformer');
    const returned = await evaluate(browser, sessionId, `(async function () {
      document.getElementById('subarchitecture-back').click();
      await Archify.readerLayout.whenStable();
      await new Promise(function (resolve) { requestAnimationFrame(function () { requestAnimationFrame(resolve); }); });
      return { parent: Archify.focus.active(), child: Archify.subarchitecture.active(), scroll: [scrollX, scrollY] };
    })()`);
    assert.equal(returned.parent, 'transformer');
    assert.equal(returned.child, null);
    assert.deepEqual(returned.scroll, before.scroll);
  } finally {
    await browser.close();
  }
});

test('subarchitecture export fails closed when the selected template is no longer unique', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture(), { width: 1440, height: 900 });
    const receipt = await evaluate(browser, sessionId, `(async function () {
      var alerts = [];
      var downloads = 0;
      window.alert = function (message) { alerts.push(String(message)); };
      document.addEventListener('click', function (event) {
        if (event.target.closest('a[download]')) downloads += 1;
      }, true);
      Archify.focus.set('transformer', { toggle: false, updateUrl: false });
      Archify.subarchitecture.open('transformer', { updateUrl: false });
      var selected = Archify.exportMenu.selectTarget('subarchitecture');
      var template = document.querySelector('template[data-subarchitecture-parent="transformer"]');
      template.after(template.cloneNode(true));
      await Archify.exportMenu.run('svg');
      return {
        selected: selected,
        downloads: downloads,
        alerts: alerts,
        errorFormat: document.documentElement.getAttribute('data-last-export-error-format'),
        error: document.documentElement.getAttribute('data-last-export-error'),
        receiptTarget: document.documentElement.getAttribute('data-last-export-target')
      };
    })()`);

    assert.equal(receipt.selected, true);
    assert.equal(receipt.downloads, 0);
    assert.equal(receipt.alerts.length, 1);
    assert.match(receipt.alerts[0], /Export failed/);
    assert.equal(receipt.errorFormat, 'svg');
    assert.match(receipt.error, /selected subarchitecture is no longer available/i);
    assert.equal(receipt.receiptTarget, null);
  } finally {
    await browser.close();
  }
});

test('desktop internals inherit every preset and theme without changing the parent camera', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture(), {
      width: 1440,
      height: 900,
      reducedMotion: true,
    });
    const receipt = await evaluate(browser, sessionId, `(function () {
      var parentSvg = document.querySelector('.diagram-container > svg');
      var viewBoxBefore = parentSvg.getAttribute('viewBox');
      Archify.focus.set('transformer', { toggle: false, updateUrl: false });
      Archify.subarchitecture.open('transformer', { updateUrl: false });
      var states = [];
      ['classic', 'signal-flow', 'blueprint', 'editorial'].forEach(function (preset) {
        Archify.preset.apply(preset);
        ['dark', 'light'].forEach(function (theme) {
          if (document.documentElement.getAttribute('data-theme') !== theme) Archify.theme.toggle();
          var localSvg = document.querySelector('#subarchitecture-mount > svg');
          states.push({
            preset: preset,
            theme: theme,
            htmlPreset: document.documentElement.getAttribute('data-preset'),
            parentPreset: parentSvg.getAttribute('data-preset'),
            localPreset: localSvg.getAttribute('data-preset'),
            htmlTheme: document.documentElement.getAttribute('data-theme'),
            parentTheme: parentSvg.getAttribute('data-theme'),
            localTheme: localSvg.getAttribute('data-theme')
          });
        });
      });
      var columns = getComputedStyle(document.querySelector('.subarchitecture-drawer-content')).gridTemplateColumns;
      return {
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        motionState: document.documentElement.getAttribute('data-motion'),
        columnTrackCount: columns.trim().split(/\\s+/).length,
        parentFocus: Archify.focus.active(),
        localFocus: Archify.subarchitecture.active(),
        parentViewBoxStable: parentSvg.getAttribute('viewBox') === viewBoxBefore,
        states: states
      };
    })()`);

    assert.equal(receipt.reducedMotion, true);
    assert.equal(receipt.motionState, 'still');
    assert.equal(receipt.columnTrackCount, 1);
    assert.equal(receipt.parentFocus, 'transformer');
    assert.equal(receipt.localFocus, 'transformer');
    assert.equal(receipt.parentViewBoxStable, true);
    assert.equal(receipt.states.length, 8);
    assert.ok(receipt.states.every((state) => (
      state.htmlPreset === state.preset
      && state.parentPreset === state.preset
      && state.localPreset === state.preset
      && state.htmlTheme === state.theme
      && state.parentTheme === state.theme
      && state.localTheme === state.theme
    )), JSON.stringify(receipt.states));
  } finally {
    await browser.close();
  }
});

test('runtime template tampering fails closed and leaves the parent graph usable', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  const artifact = renderFixture();
  const mutations = [
    `var template = document.querySelector('template[data-subarchitecture-parent="transformer"]');
     template.after(template.cloneNode(true));`,
    `var template = document.querySelector('template[data-subarchitecture-parent="transformer"]');
     template.content.querySelector('[data-edge-from][data-edge-to]').setAttribute('data-edge-to', 'missing-child');`,
    `var template = document.querySelector('template[data-subarchitecture-parent="transformer"]');
     template.content.appendChild(document.createElement('div'));`,
    `var template = document.querySelector('template[data-subarchitecture-parent="transformer"]');
     var nodes = template.content.querySelectorAll('[data-node-id]');
     nodes[1].setAttribute('data-node-id', nodes[0].getAttribute('data-node-id'));`,
  ];

  try {
    for (const mutation of mutations) {
      const sessionId = await load(browser, artifact);
      const receipt = await evaluate(browser, sessionId, `(function () {
        ${mutation}
        Archify.focus.set('transformer', { toggle: false, updateUrl: false });
        var opened = Archify.subarchitecture.open('transformer');
        var parentSvg = document.querySelector('.diagram-container > svg');
        var parentNode = parentSvg.querySelector('[data-node-id="transformer"]');
        return {
          opened: opened,
          active: Archify.subarchitecture.active(),
          drawerHidden: document.getElementById('subarchitecture-drawer').hidden,
          mountedSvgCount: document.querySelectorAll('#subarchitecture-mount > svg').length,
          parentConnected: parentSvg.isConnected && parentNode.isConnected,
          parentFocus: Archify.focus.active(),
          triggerHidden: document.getElementById('btn-focus-internals').hidden,
          triggerDisabled: document.getElementById('btn-focus-internals').disabled
        };
      })()`);
      assert.deepEqual(receipt, {
        opened: false,
        active: null,
        drawerHidden: true,
        mountedSvgCount: 0,
        parentConnected: true,
        parentFocus: 'transformer',
        triggerHidden: true,
        triggerDisabled: true,
      });
    }

    const sessionId = await load(browser, artifact);
    const destroyed = await evaluate(browser, sessionId, `(function () {
      Archify.subarchitecture.destroy();
      return {
        reopened: Archify.subarchitecture.open('transformer'),
        mountedSvgCount: document.querySelectorAll('#subarchitecture-mount > svg').length,
        disclosures: document.querySelectorAll('[data-subarchitecture-disclosure]').length
      };
    })()`);
    assert.deepEqual(destroyed, { reopened: false, mountedSvgCount: 0, disclosures: 0 });
  } finally {
    await browser.close();
  }
});

test('duplicate, conflicting, and unknown subarchitecture deep links fail closed', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  const artifact = renderFixture();
  const invalidHashes = [
    '#subgraph=transformer&subgraph=transformer',
    '#subgraph=transformer&subfocus=attention&subfocus=ffn',
    '#focus=transformer&subgraph=transformer',
    '#subgraph=transformer&subfocus=missing-child',
    '#subfocus=attention',
  ];
  try {
    for (const hash of invalidHashes) {
      const sessionId = await load(browser, artifact);
      const receipt = await evaluate(browser, sessionId, `(async function () {
        await new Promise(function (resolve) {
          window.addEventListener('hashchange', resolve, { once: true });
          location.hash = ${JSON.stringify(hash)};
        });
        await new Promise(function (resolve) { requestAnimationFrame(resolve); });
        return {
          active: Archify.subarchitecture.active(),
          child: Archify.subarchitecture.child(),
          drawerHidden: document.getElementById('subarchitecture-drawer').hidden,
          mountedSvgCount: document.querySelectorAll('#subarchitecture-mount > svg').length,
          parentConnected: document.querySelector('.diagram-container > svg').isConnected
        };
      })()`);
      assert.deepEqual(receipt, {
        active: null,
        child: null,
        drawerHidden: true,
        mountedSvgCount: 0,
        parentConnected: true,
      }, hash);
    }
  } finally {
    await browser.close();
  }
});

process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));

test('child PNG download and clipboard copy paint the current theme background', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture());
    const receipt = await evaluate(browser, sessionId, `(async function () {
      var blobs = [];
      var copied = null;
      var originalCreateObjectUrl = URL.createObjectURL;
      URL.createObjectURL = function (blob) { blobs.push(blob); return originalCreateObjectUrl(blob); };
      window.ClipboardItem = function (data) { this.getType = function (type) { return Promise.resolve(data[type]); }; };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        write: async function (items) { copied = await items[0].getType('image/png'); }
      } });
      document.querySelector('.diagram-container > svg [data-node-id="transformer"]').dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      document.getElementById('btn-focus-internals').click();
      document.getElementById('btn-export').click();
      document.querySelector('#export-menu [data-export-target="subarchitecture"]').click();
      async function pixels(blob) {
        var image = await createImageBitmap(blob);
        var canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        var context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        var data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        var transparent = 0;
        for (var index = 3; index < data.length; index += 4) if (data[index] !== 255) transparent += 1;
        return { corner: Array.from(data.slice(0, 4)), transparent: transparent };
      }
      var expectedCanvas = document.createElement('canvas');
      expectedCanvas.width = expectedCanvas.height = 1;
      var expectedContext = expectedCanvas.getContext('2d');
      expectedContext.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      expectedContext.fillRect(0, 0, 1, 1);
      var expected = Array.from(expectedContext.getImageData(0, 0, 1, 1).data);
      await Archify.exportMenu.run('png');
      var downloaded = await pixels(blobs.filter(function (blob) { return blob.type === 'image/png'; }).slice(-1)[0]);
      document.getElementById('btn-export').click();
      document.querySelector('#export-menu [data-action="copy"]').click();
      var deadline = Date.now() + 5000;
      while (!copied && Date.now() < deadline) await new Promise(function (resolve) { setTimeout(resolve, 25); });
      if (!copied) throw new Error('Clipboard copy must produce its PNG Blob');
      var clipboard = await pixels(copied);
      URL.createObjectURL = originalCreateObjectUrl;
      return { expected: expected, downloaded: downloaded, clipboard: clipboard };
    })()`);
    assert.deepEqual(receipt.downloaded.corner, receipt.expected);
    assert.equal(receipt.downloaded.transparent, 0);
    assert.deepEqual(receipt.clipboard.corner, receipt.expected);
    assert.equal(receipt.clipboard.transparent, 0);
  } finally {
    await browser.close();
  }
});

test('Escape clears child focus before a selected parent Semantic Lens', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, renderFixture());
    const receipt = await evaluate(browser, sessionId, `(function () {
      function state() { return { lens: Archify.semanticLens.active(), lensOpen: Archify.semanticLens.isOpen(), child: Archify.subarchitecture.child(), drawer: Archify.subarchitecture.active() }; }
      document.querySelector('.diagram-container > svg [data-node-id="transformer"]').dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      document.getElementById('btn-focus-internals').click();
      var child = document.querySelector('#subarchitecture-mount [data-node-id="attention"]');
      child.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      document.getElementById('btn-semantic-lens').click();
      document.querySelector('#semantic-lens-kinds [data-kind]').click();
      document.getElementById('semantic-lens-close').click();
      child.focus();
      document.getElementById('btn-semantic-lens').click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      var popupClosed = state();
      var before = state();
      child.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      var first = state();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { popupClosed: popupClosed, before: before, first: first, second: state() };
    })()`);
    assert.equal(receipt.popupClosed.lensOpen, false);
    assert.equal(receipt.popupClosed.child, 'attention');
    assert.equal(receipt.popupClosed.drawer, 'transformer');
    assert.ok(receipt.before.lens && receipt.before.lens.length);
    assert.equal(receipt.before.child, 'attention');
    assert.equal(receipt.first.child, null);
    assert.equal(receipt.first.drawer, 'transformer');
    assert.deepEqual(receipt.first.lens, receipt.before.lens);
    assert.equal(receipt.second.drawer, null);
  } finally {
    await browser.close();
  }
});
