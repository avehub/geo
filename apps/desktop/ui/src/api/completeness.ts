/**
 * 枚举「值清单 ↔ 字面量联合」的**编译期完整性网**（原住 `types.ts`，M3–M7 的 DTO 模块拆出后
 * 变成共享叶子模块，避免每个新模块各抄一份）。
 *
 * 用**类型层**断言而不是「`const _check: T = true`」那种值层写法：`tsconfig.app.json` 开了
 * `noUnusedLocals`，值层的检查常量要么得导出（凭空多出一堆运行时噪音），要么就得指望下划线
 * 前缀被豁免——而 TS 的 `noUnusedLocals` 并不像本仓 ESLint 的 `varsIgnorePattern: '^_'`
 * 那样豁免 `_` 前缀。约束 `T extends true` 不成立时，错误就落在类型别名自身，不需要任何值。
 */

/** 联合里存在没被值清单收录的成员 ⇒ 结果是 `false`，下游的 `AssertComplete` 当场编译不过。 */
export type ValuesAreComplete<Union extends string, Values extends readonly string[]> =
  Exclude<Union, Values[number]> extends never ? true : false;

/** 把「完整性」变成一条约束：只有 `true` 能通过。 */
export type AssertComplete<T extends true> = T;
