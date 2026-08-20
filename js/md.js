/* ==========================================================================
   md.js — a small, safe Markdown renderer

   Supports the subset a student actually writes in notes: headings, bold,
   italic, inline code, fenced code, links, bullet/numbered lists, blockquotes,
   task lists, horizontal rules, and tables.

   Safety: the input is HTML-escaped FIRST and only our own tags are emitted
   afterwards, so note content can never inject markup. Link hrefs are limited
   to http(s)/mailto.
   ========================================================================== */

App.md = (function () {
  const U = App.utils;

  function safeHref(url) {
    const u = String(url).trim();
    return /^(https?:\/\/|mailto:|#)/i.test(u) ? u : "#";
  }

  // Inline spans, applied to already-escaped text.
  function inline(s) {
    return s
      // `code` first so its contents aren't further formatted
      .replace(/`([^`\n]+)`/g, (_m, code) => `<code class="md-code">${code}</code>`)
      // [text](url)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) =>
        `<a href="${U.esc(safeHref(url))}" target="_blank" rel="noopener noreferrer">${text}</a>`)
      // ***bold italic***, **bold**, *italic* / _italic_
      .replace(/\*\*\*([^*\n]+)\*\*\*/g, "<strong><em>$1</em></strong>")
      .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<em>$2</em>")
      .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, "$1<em>$2</em>")
      // ~~strike~~
      .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
      // ==highlight==
      .replace(/==([^=\n]+)==/g, '<mark class="md-mark">$1</mark>');
  }

  function render(src) {
    const text = U.esc(String(src == null ? "" : src)).replace(/\r\n/g, "\n");
    const lines = text.split("\n");
    const out = [];

    let i = 0;
    let listType = null;     // "ul" | "ol" | null
    let inQuote = false;

    const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };
    const closeQuote = () => { if (inQuote) { out.push("</blockquote>"); inQuote = false; } };

    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();

      // Fenced code
      if (/^```/.test(trimmed)) {
        closeList(); closeQuote();
        const lang = trimmed.slice(3).trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
        i++;
        out.push(`<pre class="md-pre"${lang ? ` data-lang="${U.esc(lang)}"` : ""}><code>${buf.join("\n")}</code></pre>`);
        continue;
      }

      // Blank line
      if (!trimmed) { closeList(); closeQuote(); i++; continue; }

      // Horizontal rule
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        closeList(); closeQuote();
        out.push('<hr class="md-hr" />');
        i++; continue;
      }

      // Table — a header row followed by a |---|---| separator
      if (/^\|.*\|$/.test(trimmed) && i + 1 < lines.length && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
        closeList(); closeQuote();
        const cells = (row) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const head = cells(trimmed);
        i += 2;
        const body = [];
        while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { body.push(cells(lines[i].trim())); i++; }
        out.push(`<div class="table-wrap"><table class="table md-table"><thead><tr>${
          head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${
          body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")
        }</tbody></table></div>`);
        continue;
      }

      // Headings
      const h = trimmed.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        closeList(); closeQuote();
        const lvl = h[1].length + 2;   // #  → h3, so note titles stay dominant
        out.push(`<h${lvl} class="md-h">${inline(h[2])}</h${lvl}>`);
        i++; continue;
      }

      // Blockquote
      const q = trimmed.match(/^>\s?(.*)$/);
      if (q) {
        closeList();
        if (!inQuote) { out.push('<blockquote class="md-quote">'); inQuote = true; }
        out.push(`<p>${inline(q[1])}</p>`);
        i++; continue;
      }
      closeQuote();

      // Task list
      const task = trimmed.match(/^[-*+]\s+\[( |x|X)\]\s+(.*)$/);
      if (task) {
        if (listType !== "ul") { closeList(); out.push('<ul class="md-list md-tasks">'); listType = "ul"; }
        const done = task[1].toLowerCase() === "x";
        out.push(`<li class="md-task${done ? " done" : ""}"><span class="md-box">${done ? "☑" : "☐"}</span> ${inline(task[2])}</li>`);
        i++; continue;
      }

      // Bullets
      const ul = trimmed.match(/^[-*+]\s+(.*)$/);
      if (ul) {
        if (listType !== "ul") { closeList(); out.push('<ul class="md-list">'); listType = "ul"; }
        out.push(`<li>${inline(ul[1])}</li>`);
        i++; continue;
      }

      // Numbered
      const ol = trimmed.match(/^\d+[.)]\s+(.*)$/);
      if (ol) {
        if (listType !== "ol") { closeList(); out.push('<ol class="md-list">'); listType = "ol"; }
        out.push(`<li>${inline(ol[1])}</li>`);
        i++; continue;
      }

      // Paragraph — join consecutive plain lines
      closeList();
      const buf = [];
      while (i < lines.length && lines[i].trim() &&
             !/^(#{1,4}\s|[-*+]\s|\d+[.)]\s|>|```|\|)/.test(lines[i].trim()) &&
             !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())) {
        buf.push(lines[i].trim());
        i++;
      }
      if (buf.length) out.push(`<p>${inline(buf.join(" "))}</p>`);
      else i++;   // safety: never loop forever
    }

    closeList(); closeQuote();
    return out.join("\n");
  }

  /** Strip formatting for previews and search. */
  function plain(src) {
    return String(src || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#*_>`~=|-]/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Pull out "Front — Back" style lines for the notes → flashcards feature.
   * Recognizes "term: definition", "term — definition", "term - definition",
   * and bullet forms of the same.
   */
  function toCards(src) {
    const cards = [];
    String(src || "").split("\n").forEach((raw) => {
      let line = raw.trim().replace(/^[-*+]\s+/, "").replace(/^\d+[.)]\s+/, "");
      if (!line || /^#{1,4}\s/.test(line) || /^```/.test(line)) return;
      line = plain(line);
      const m = line.match(/^(.{2,80}?)\s*(?:—|–|:|\s-\s)\s*(.{2,})$/);
      if (!m) return;
      const front = m[1].trim(), back = m[2].trim();
      if (!front || !back || front.length > 90) return;
      cards.push({ front, back });
    });
    return cards;
  }

  return { render, plain, toCards };
})();
