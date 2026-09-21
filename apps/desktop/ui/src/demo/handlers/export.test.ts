/**
 * `export_write_file` 的行为测试（Task 14 · 简报 §B / §A-1）。
 *
 * 计划钉法 ④：在 jsdom 下**触发一次 `URL.createObjectURL`**，且 CSV 内容**以 BOM 开头**。
 *
 * # 🔴 本环境的两条实测事实（造前提的方式由它们决定，别照搬"jsdom 没有 blob API"这句话）
 * ① `URL` 在 vitest 的 jsdom 环境里其实是 **Node 的** `URL`：它自带 `createObjectURL`，
 *    但只认 **Node 的** `Blob` ⇒ 拿到 jsdom 的 `Blob` 会抛
 *    `ERR_INVALID_ARG_TYPE`（`The "obj" argument must be an instance of Blob.
 *    Received an instance of Blob`，两个 realm 的 Blob 撞车）。
 *    ⇒「桩不在」并**不等于**「方法不在」，最后那条用例是**显式**把两个静态方法置成
 *    `undefined` 来造前提的，钉的是生产代码那道守卫本身。
 * ② jsdom 27 的 `Blob.prototype` 只有 `slice` / `size` / `type`（**没有** `text()` /
 *    `arrayBuffer()`）⇒ 读不回内容。所以这里用 `vi.stubGlobal` 换一个**记账用的** Blob：
 *    它把构造入参原样记下来，判据是「生产代码交给 Blob 的那份字节」，与读真 Blob 等价强度。
 *
 * `anchor.click()` 一律被 spy 掉：真点击会让 jsdom 去走「导航」，往 stderr 刷
 * `Not implemented: navigation` 噪音，而且拿不到「点了几次 / 点的时候在不在 DOM 里」这两个判据。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { isIpcErrorPayload } from '../../api/types';
import { demoInvoke } from '../backend';
import { getDemoDb, resetDemoDb } from '../db';

/** jsdom 里这两个静态方法要么缺失、要么是 Node 那一份 ⇒ 用一个只含可选成员的视图来装/卸桩。 */
interface BlobUrlApi {
  createObjectURL?: (blob: unknown) => string;
  revokeObjectURL?: (url: string) => void;
}

/** 记账用的 Blob 替身：jsdom 的 Blob 读不回内容（见文件头 ②）。 */
class RecordingBlob {
  /** 交给 Blob 构造器的字节（拼起来就是下载内容）。 */
  readonly body: string;
  /** 生产代码选的 MIME（只记账，不断言：真后端写的是裸字节，MIME 属浏览器细节）。 */
  readonly mime: string;

  constructor(parts: unknown[], options?: { type?: string }) {
    this.body = parts.map((part) => String(part)).join('');
    this.mime = options?.type ?? '';
  }
}

const urlApi = URL as unknown as BlobUrlApi;
const OBJECT_URL = 'blob:demo-export';
const BOM = '\uFEFF';
const CSV_BODY = 'brand,intent\nDemo Brand,pricing_plan\n';
const JSON_BODY = JSON.stringify({ format_version: 'geo-project-export-v1' }, null, 2);
const FILE_NAME = 'demo-prompts.csv';
const CJK = /[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef]/;

interface ClickRecord {
  download: string;
  href: string;
  attached: boolean;
}

let createObjectURL: Mock<(blob: unknown) => string>;
let revokeObjectURL: Mock<(url: string) => void>;
let click: ReturnType<typeof spyClick>;
let clicks: ClickRecord[] = [];
let bodies: RecordingBlob[] = [];

/**
 * 把 `HTMLElement.prototype.click` 换成记账桩。
 * 抽成函数只为了让变量类型由 TS 自己推（`ReturnType<typeof spyClick>`）：
 * `vi.fn` / `vi.spyOn` 的泛型手写起来又长又容易与 vitest 的版本对不上。
 */
function spyClick() {
  return vi
    .spyOn(HTMLElement.prototype, 'click')
    .mockImplementation(function recordClick(this: HTMLElement) {
      const anchor = this as HTMLAnchorElement;
      clicks.push({
        download: anchor.download,
        // 用 getAttribute 而不是 `.href`：后者是**解析后的绝对 URL**，会被文档 base 影响。
        href: anchor.getAttribute('href') ?? '',
        attached: document.body.contains(anchor),
      });
    });
}

function stub(): void {
  bodies = [];
  clicks = [];
  vi.stubGlobal('Blob', RecordingBlob);
  createObjectURL = vi.fn<(blob: unknown) => string>((blob) => {
    bodies.push(blob as RecordingBlob);
    return OBJECT_URL;
  });
  revokeObjectURL = vi.fn<(url: string) => void>(() => undefined);
  urlApi.createObjectURL = createObjectURL;
  urlApi.revokeObjectURL = revokeObjectURL;
  click = spyClick();
}

function unstub(): void {
  delete urlApi.createObjectURL;
  delete urlApi.revokeObjectURL;
}

/** 把 `click()` 之后排的那个宏任务跑掉（revoke 就挂在那儿）。 */
async function flushMacrotask(): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function bodyOf(index = 0): string {
  return bodies[index].body;
}

function capture(thunk: () => unknown): Promise<unknown> {
  return Promise.resolve()
    .then(thunk)
    .then(
      () => null,
      (cause: unknown) => cause,
    );
}

function write(args: Record<string, unknown>): Promise<string | null> {
  return demoInvoke<string | null>('export_write_file', args);
}

beforeEach(() => {
  resetDemoDb();
  stub();
});

afterEach(async () => {
  // 先把上一个用例排在 `click()` 之后的那个宏任务跑掉：不然它会落到**下一个用例**装的桩上（串味）。
  await flushMacrotask();
  unstub();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetDemoDb();
});

describe('demo/handlers/export · 下载这一支（浏览器里唯一可用的那条路）', () => {
  it('触发一次 createObjectURL，CSV 以 BOM 开头，返回值是**文件名**（计划钉法 ④ / §A-1）', async () => {
    const saved = await write({ default_name: FILE_NAME, content: CSV_BODY, with_bom: true });

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(saved).toBe(FILE_NAME);
    const body = bodyOf();
    expect(body.startsWith(BOM)).toBe(true);
    expect(body).toBe(`${BOM}${CSV_BODY}`);
  });

  it('BOM 幂等：已带 BOM 的内容再传 with_bom:true 也不双写（镜像 export.rs:101）', async () => {
    await write({ default_name: FILE_NAME, content: `${BOM}${CSV_BODY}`, with_bom: true });

    const body = bodyOf();
    expect(body).toBe(`${BOM}${CSV_BODY}`);
    expect(body.startsWith(`${BOM}${BOM}`)).toBe(false);
  });

  it('with_bom:false 一个 BOM 都不加（JSON 导出走这条，镜像 export.rs:16-22）', async () => {
    const saved = await write({ default_name: 'demo.json', content: JSON_BODY, with_bom: false });

    expect(saved).toBe('demo.json');
    const body = bodyOf();
    expect(body).toBe(JSON_BODY);
    expect(body).not.toContain(BOM);
  });

  it('锚点：download 就是 default_name、href 是那个 object URL、点击时在 DOM 里、点完摘掉', async () => {
    await write({ default_name: FILE_NAME, content: CSV_BODY, with_bom: true });

    expect(click).toHaveBeenCalledTimes(1);
    expect(clicks).toEqual([{ download: FILE_NAME, href: OBJECT_URL, attached: true }]);
    expect(document.body.querySelectorAll('a[download]')).toHaveLength(0);
  });

  it('revokeObjectURL 排在 click 之后的宏任务里（不立刻释放，免得掐断刚发起的下载）', async () => {
    await write({ default_name: FILE_NAME, content: CSV_BODY, with_bom: true });

    expect(revokeObjectURL).not.toHaveBeenCalled();
    await flushMacrotask();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith(OBJECT_URL);
  });

  it('永不返回 null：浏览器下载没有「取消」按钮（契约里 null 那一支在 demo 里不存在）', async () => {
    const csv = await write({ default_name: FILE_NAME, content: CSV_BODY, with_bom: true });
    const json = await write({ default_name: 'demo.json', content: JSON_BODY, with_bom: false });
    const unnamed = await write({ default_name: '', content: CSV_BODY, with_bom: true });

    for (const saved of [csv, json, unnamed]) {
      expect(saved).not.toBeNull();
      expect(typeof saved).toBe('string');
    }
    // `default_name` 给空串就原样回空串：demo 不替用户编文件名（编出来的是**假**信息）。
    expect(unnamed).toBe('');
    expect(createObjectURL).toHaveBeenCalledTimes(3);
  });

  it('入参键名是 snake_case：写成驼峰就读不到（`m1-contract.test.ts` 那条防线的同族守卫）', async () => {
    const saved = await write({ defaultName: FILE_NAME, content: CSV_BODY, withBom: true });

    expect(saved).toBe('');
    expect(bodyOf()).toBe(CSV_BODY);
  });

  it('导出不碰库（它只是把已经算好的内容写出去）', async () => {
    const before = structuredClone(getDemoDb());

    await write({ default_name: FILE_NAME, content: CSV_BODY, with_bom: true });

    expect(getDemoDb()).toStrictEqual(before);
  });
});

describe('demo/handlers/export · 异常路径', () => {
  it('运行环境不支持 blob 下载 ⇒ 抛英文开发者诊断（不是假成功、也不碰 DOM）', async () => {
    // 造前提见文件头 ①：这里**显式**卸掉两个静态方法（本环境里 `URL` 是 Node 那一份，
    // 单纯"不装桩"并不等于"方法不在"，只会撞出 ERR_INVALID_ARG_TYPE 那条 realm 错误）。
    urlApi.createObjectURL = undefined;
    urlApi.revokeObjectURL = undefined;

    const cause = await capture(() =>
      write({ default_name: FILE_NAME, content: CSV_BODY, with_bom: true }),
    );

    // 普通 Error（不是 IpcErrorPayload）⇒ 经 `api/client.ts` 的 `callVia` 归一化成
    // `ipc/invoke_failed`，与退休前那个 `notImplemented()` 占位同一条路：不新增错误码。
    expect(isIpcErrorPayload(cause)).toBe(false);
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('export_write_file');
    expect((cause as Error).message).not.toMatch(CJK);
    expect(bodies).toEqual([]);
    expect(document.body.querySelectorAll('a[download]')).toHaveLength(0);
  });
});
