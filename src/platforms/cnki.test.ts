import { describe, expect, test } from "bun:test";

import { extractFilenameFromContentDisposition, parseCnkiSearchHtml } from "./cnki.js";

describe("parseCnkiSearchHtml", () => {
  test("extracts papers with abstract-form hrefs and skips non-abstract rows", () => {
    const html = `
      <table class="result-table-list"><tbody>
        <tr>
          <td class="name">
            <a class="fz14" href="/kcms2/article/abstract?v=abc">A 论文标题</a>
          </td>
          <td class="author">
            <a class="KnowledgeNetLink">张三</a>
            <a class="KnowledgeNetLink">李四</a>
          </td>
          <td class="source">
            <a href="https://navi.cnki.net/knavi/detail?pcode=CJFD">建筑学报</a>
          </td>
        </tr>
        <tr>
          <td class="name">
            <a class="fz14" href="javascript:void(0)">should skip</a>
          </td>
        </tr>
        <tr>
          <td class="name">
            <a class="fz14" href="/kcms/something/else">non-abstract skip</a>
          </td>
        </tr>
      </tbody></table>
    `;

    const papers = parseCnkiSearchHtml(html, "https://kns.cnki.net/");
    expect(papers).toHaveLength(1);
    expect(papers[0]).toMatchObject({
      title: "A 论文标题",
      authors: ["张三", "李四"],
      source: "建筑学报",
    });
    expect(papers[0]?.href).toContain("/kcms2/article/abstract?v=abc");
    expect(papers[0]?.sourceLink).toContain("navi.cnki.net/knavi/detail");
  });

  test("falls back to plain-text source when no link is present", () => {
    const html = `
      <table class="result-table-list"><tbody>
        <tr>
          <td class="name">
            <a class="fz14" href="/kcms2/article/abstract?v=x">Title</a>
          </td>
          <td class="source"><span>Foreign Journal Name</span></td>
        </tr>
      </tbody></table>
    `;
    const papers = parseCnkiSearchHtml(html, "https://kns.cnki.net/");
    expect(papers[0]?.source).toBe("Foreign Journal Name");
    expect(papers[0]?.sourceLink).toBe("");
  });
});

describe("extractFilenameFromContentDisposition", () => {
  test("prefers RFC 5987 utf-8 filename* and decodes it", () => {
    const disposition =
      "attachment; filename=\"raw.pdf\"; filename*=utf-8''%E6%B5%8B%E8%AF%95.pdf";
    expect(extractFilenameFromContentDisposition(disposition)).toBe("测试.pdf");
  });

  test("falls back to plain filename when filename* is missing", () => {
    expect(extractFilenameFromContentDisposition('attachment; filename="paper.pdf"')).toBe(
      "paper.pdf",
    );
  });

  test("returns empty string when no filename is present", () => {
    expect(extractFilenameFromContentDisposition("inline")).toBe("");
    expect(extractFilenameFromContentDisposition("")).toBe("");
  });
});
