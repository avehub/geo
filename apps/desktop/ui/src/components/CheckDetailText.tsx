import { useTranslation } from 'react-i18next';

import type { CheckDetail } from '../api/types';
import { enumLabel } from '../i18n/enum-label';

/**
 * 自检结论的渲染入口：`code` 查 `checkDetails.<code>`，查不到回落到 code 本身。
 *
 * 🔴 后端只回稳定码 + 语言中立 params（规则 7）；这里不允许在组件里写任何自然语言。
 */
export default function CheckDetailText({ detail }: { detail: CheckDetail | null }) {
  const { t } = useTranslation();
  if (detail === null) return null;
  return <>{enumLabel(t, 'common.checkDetails', detail.code, detail.params)}</>;
}
