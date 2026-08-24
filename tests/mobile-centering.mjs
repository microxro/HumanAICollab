/* Check mobile interface centering */

import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE || "http://localhost:8899";
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${extra ? "\n       " + extra : ""}`); }
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
  });

  console.log("Mobile Centering Tests (390x844)");

  await page.goto(`${BASE}`, { waitUntil: 'networkidle' });

  // Check element positions on dashboard (main page)
  const elements = await page.evaluate(() => {
    const vw = window.innerWidth;
    const checks = [];

    // Check page-inner centering
    const pageInner = document.querySelector('.page-inner');
    if (pageInner) {
      const rect = pageInner.getBoundingClientRect();
      const style = window.getComputedStyle(pageInner);
      const isCentered = Math.abs(rect.left - (vw - rect.width) / 2) < 5;
      checks.push({
        element: '.page-inner',
        vw: vw,
        width: rect.width,
        left: rect.left,
        right: rect.right,
        marginLeft: style.marginLeft,
        marginRight: style.marginRight,
        isCentered: isCentered
      });
    }

    // Check page-head alignment
    const pageHead = document.querySelector('.page-head');
    if (pageHead) {
      const rect = pageHead.getBoundingClientRect();
      const style = window.getComputedStyle(pageHead);
      const parent = pageHead.parentElement.getBoundingClientRect();
      checks.push({
        element: '.page-head',
        width: rect.width,
        left: rect.left,
        parentWidth: parent.width,
        parentLeft: parent.left,
        justifyContent: style.justifyContent,
        alignItems: style.alignItems,
        display: style.display,
        isLeftAligned: rect.left > parent.left + 5
      });
    }

    // Check page-actions alignment
    const pageActions = document.querySelector('.page-actions');
    if (pageActions) {
      const rect = pageActions.getBoundingClientRect();
      const style = window.getComputedStyle(pageActions);
      checks.push({
        element: '.page-actions',
        width: rect.width,
        left: rect.left,
        justifyContent: style.justifyContent,
        alignItems: style.alignItems,
        display: style.display
      });
    }

    // Check buttons in page-actions
    document.querySelectorAll('.page-actions button').forEach((btn, i) => {
      const rect = btn.getBoundingClientRect();
      const style = window.getComputedStyle(btn);
      checks.push({
        element: `.page-actions button[${i}]`,
        text: btn.textContent.substring(0, 20),
        width: rect.width,
        left: rect.left,
        textAlign: style.textAlign,
        display: style.display
      });
    });

    return checks;
  });

  console.log("\nElement Positions and Styles:");
  console.log(JSON.stringify(elements, null, 2));

  // Check specific visual alignment
  const alignmentIssues = await page.evaluate(() => {
    const vw = window.innerWidth;
    const issues = [];

    // Check if page-head is not centered
    const pageHead = document.querySelector('.page-head');
    if (pageHead) {
      const rect = pageHead.getBoundingClientRect();
      const pageRect = document.querySelector('.page').getBoundingClientRect();
      if (rect.left < pageRect.left + 5) {
        issues.push('page-head appears left-aligned within page container');
      }
    }

    // Check page-inner margin
    const pageInner = document.querySelector('.page-inner');
    if (pageInner) {
      const style = window.getComputedStyle(pageInner);
      if (style.marginLeft !== style.marginRight) {
        issues.push(`page-inner has unequal margins: left=${style.marginLeft}, right=${style.marginRight}`);
      }
    }

    return issues;
  });

  alignmentIssues.forEach(issue => {
    console.log(`\nAlignment Issue: ${issue}`);
  });

  ok('page-inner exists', elements.some(e => e.element === '.page-inner'));
  ok('page-head exists', elements.some(e => e.element === '.page-head'));

  await browser.close();
  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
