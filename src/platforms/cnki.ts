import { mkdir, writeFile } from "node:fs/promises";
import { parse, type HTMLElement } from "node-html-parser/dist/index.js";

import { directFetch as fetch } from "../proxy.js";
import type { CnkiPaper } from "../types.js";

// CNKI authenticates by institutional IP, so it must bypass SPIDER_PROXY and
// keep this host's real egress IP. Importing the un-proxied fetch as `fetch`
// shadows the global for this whole module, so every request below goes direct.

const CNKI_SEARCH_URL = "https://kns.cnki.net/kns8s/brief/grid";
const CNKI_LOGIN_URL = "https://login.cnki.net/TopLoginCore/api/loginapi/IpLoginFlushPo";
const CNKI_REFERER = "https://kns.cnki.net/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

let cachedCookie = "";

function defaultHeaders(cookie: string): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Referer: CNKI_REFERER,
  };
  if (cookie) {
    headers.Cookie = cookie;
  }
  return headers;
}

function collectSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

function buildCookieHeader(setCookieValues: string[]): string {
  const jar = new Map<string, string>();
  for (const raw of setCookieValues) {
    const head = raw.split(";", 1)[0] ?? "";
    const eq = head.indexOf("=");
    if (eq <= 0) continue;
    const name = head.slice(0, eq).trim();
    const value = head.slice(eq + 1);
    if (name) jar.set(name, value);
  }
  return Array.from(jar.entries()).map(([n, v]) => `${n}=${v}`).join("; ");
}

async function cnkiIpLogin(): Promise<string> {
  const response = await fetch(CNKI_LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return "";

  const raw = (await response.text()).trim().replace(/^\(/, "").replace(/\)$/, "");
  try {
    const payload = JSON.parse(raw) as { IsSuccess?: boolean };
    if (!payload.IsSuccess) return "";
  } catch {
    return "";
  }
  return buildCookieHeader(collectSetCookies(response));
}

async function ensureCookie(): Promise<string> {
  if (cachedCookie) return cachedCookie;
  cachedCookie = await cnkiIpLogin();
  return cachedCookie;
}

function resolveUrl(base: string, target: string): string {
  if (!target) return "";
  try {
    return new URL(target, base).toString();
  } catch {
    return target;
  }
}

function buildQueryJson(value: string): string {
  return JSON.stringify({
    Platform: "",
    Resource: "CROSSDB",
    Classid: "WD0FTY92",
    Products:
      "CJFQ,CAPJ,WWJD,CJTL,CDFD,CMFD,CPFD,IPFD,CPVD,WWPD,CCND,SCSF,SCHF,SCSD,SOSD,SNAD,CCJD,WBFD,WWBD,CCVD,CJFN",
    QNode: {
      QGroup: [
        {
          Key: "Subject",
          Title: "",
          Logic: 0,
          Items: [
            { Field: "SU", Value: value, Operator: "TOPRANK", Logic: 0, Title: "主题" },
          ],
          ChildItems: [],
        },
      ],
    },
    ExScope: 1,
    SearchType: 2,
    Rlang: "BOTH",
    KuaKuCode: "YSTT4HG0,LSTPFY1C,JUP3MUPD,MPMFIG1A,WQ0UVIAA,BLZOG7CK,PWFIRAGL,EMRPGLPA,NLBO1Z6R,NN3FJMUV",
    Expands: {},
    SearchFrom: 4,
  });
}

function extractSourceInfo(sourceElem: HTMLElement, baseUrl: string): { name: string; link: string } {
  for (const link of Array.from(sourceElem.querySelectorAll("a")) as HTMLElement[]) {
    const href = link.getAttribute("href") ?? "";
    if (href && (href.includes("knavi/detail") || href.includes("thinker.cnki.net"))) {
      return { name: link.text.trim(), link: resolveUrl(baseUrl, href) };
    }
  }
  const span = sourceElem.querySelector("span");
  if (span) {
    const text = span.text.trim();
    if (text && text !== "—") return { name: text, link: "" };
  }
  const fallback = sourceElem.text.replace(/\s+/g, " ").trim();
  if (fallback && fallback !== "—" && fallback !== "...") return { name: fallback, link: "" };
  return { name: "", link: "" };
}

export function parseCnkiSearchHtml(html: string, baseUrl = "https://kns.cnki.net/"): CnkiPaper[] {
  const document = parse(html);
  const rows = Array.from(document.querySelectorAll("table.result-table-list tbody tr")) as HTMLElement[];
  const papers: CnkiPaper[] = [];
  for (const row of rows) {
    const titleElem = row.querySelector("td.name a.fz14");
    if (!titleElem) continue;
    const href = titleElem.getAttribute("href") ?? "";
    const title = titleElem.text.trim();
    if (!href || href.startsWith("javascript:")) continue;
    if (!href.includes("/kcms2/article/abstract")) continue;

    const authors = (Array.from(row.querySelectorAll("td.author a.KnowledgeNetLink")) as HTMLElement[])
      .map((node) => node.text.trim())
      .filter(Boolean);

    const sourceCell = row.querySelector("td.source");
    const sourceInfo = sourceCell ? extractSourceInfo(sourceCell, baseUrl) : { name: "", link: "" };

    papers.push({
      title,
      authors,
      source: sourceInfo.name,
      sourceLink: sourceInfo.link,
      href: resolveUrl(baseUrl, href),
    });
  }
  return papers;
}

export async function searchCnkiPapers(
  value: string,
  options: { pageNum?: number; pageSize?: number } = {},
): Promise<CnkiPaper[]> {
  const cookie = await ensureCookie();
  if (!cookie) {
    throw new Error("CNKI login failed: this network does not appear to have IP-based access");
  }
  const pageNum = options.pageNum ?? 1;
  const pageSize = Math.min(Math.max(options.pageSize ?? 20, 1), 100);

  const body = new URLSearchParams({
    QueryJson: buildQueryJson(value),
    pageNum: String(pageNum),
    pageSize: String(pageSize),
    productStr:
      "YSTT4HG0,LSTPFY1C,RMJLXHZ3,JQIRZIYA,JUP3MUPD,1UR4K4HZ,BPBAFJ5S,R79MZMCB,MPMFIG1A,WQ0UVIAA,NB3BWEHK,XVLO76FD,HR1YT1Z9,BLZOG7CK,PWFIRAGL,EMRPGLPA,J708GVCE,ML4DRIDX,NLBO1Z6R,NN3FJMUV,",
    searchFrom: "资源范围：总库",
    turnpage: "vLP2bNpghntZLRq9Q5Y7Qg!!",
  });

  const response = await fetch(CNKI_SEARCH_URL, {
    method: "POST",
    headers: { ...defaultHeaders(cookie), "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`CNKI search failed: HTTP ${response.status}`);
  }
  return parseCnkiSearchHtml(await response.text(), CNKI_SEARCH_URL);
}

async function getCnkiPdfUrl(abstractHref: string, cookie: string): Promise<string> {
  const response = await fetch(abstractHref, {
    headers: defaultHeaders(cookie),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Failed to load CNKI abstract page: HTTP ${response.status}`);
  }
  const document = parse(await response.text());
  const pdf = document.querySelector("#pdfDown");
  const href = pdf?.getAttribute("href") ?? "";
  if (!href) return "";
  return resolveUrl(response.url || abstractHref, href);
}

export function extractFilenameFromContentDisposition(disposition: string): string {
  if (!disposition) return "";
  const utf8Match = /filename\*\s*=\s*([^']*)''([^;]+)/i.exec(disposition);
  if (utf8Match) {
    try {
      return decodeURIComponent(utf8Match[2]!.trim());
    } catch {
      // fall through
    }
  }
  const plainMatch = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  if (plainMatch) {
    const raw = plainMatch[1]!.trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return "";
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\/\\?%*:|"<>]/g, "_").replace(/\s+/g, " ").trim();
}

export async function downloadCnkiPaper(href: string, savePath = "./downloads"): Promise<string> {
  const cookie = await ensureCookie();
  if (!cookie) {
    throw new Error("CNKI login failed: this network does not appear to have IP-based access");
  }

  const pdfUrl = await getCnkiPdfUrl(href, cookie);
  if (!pdfUrl) {
    throw new Error("No PDF download link found on the CNKI abstract page");
  }

  const response = await fetch(pdfUrl, {
    headers: defaultHeaders(cookie),
    redirect: "follow",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`PDF download failed: HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("pdf")) {
    const preview = (await response.text()).slice(0, 200);
    throw new Error(`Expected PDF, got ${contentType || "unknown"}: ${preview}`);
  }

  const disposition = response.headers.get("content-disposition") ?? "";
  const suggested = extractFilenameFromContentDisposition(disposition);
  const filename = sanitizeFilename(suggested || `cnki_${Date.now()}.pdf`);
  await mkdir(savePath, { recursive: true });
  const fullPath = `${savePath.replace(/\/$/, "")}/${filename}`;
  await writeFile(fullPath, Buffer.from(await response.arrayBuffer()));
  return fullPath;
}
