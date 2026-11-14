import type * as acp from '@agentclientprotocol/sdk';
import type { TerminalChoice, TerminalConfigOption } from '@riccon-scrum/shared';

const MODEL_HINT = /model|模型/i;
const THOUGHT_HINT = /thought|think|reason|思考/i;

export function flattenSelectOptions(
  options: acp.SessionConfigSelectOptions | null | undefined,
): TerminalChoice[] {
  if (!options) return [];
  const out: TerminalChoice[] = [];
  for (const item of options) {
    if ('group' in item) {
      const group = item as acp.SessionConfigSelectGroup;
      for (const option of group.options) {
        out.push({ value: option.value, name: option.name, description: option.description ?? null, group: group.name });
      }
    } else {
      const option = item as acp.SessionConfigSelectOption;
      out.push({ value: option.value, name: option.name, description: option.description ?? null, group: null });
    }
  }
  return out;
}

export function toTerminalConfigOptions(
  options: acp.SessionConfigOption[] | null | undefined,
): TerminalConfigOption[] {
  return (options ?? []).map((option) => ({
    id: option.id,
    name: option.name,
    description: option.description ?? null,
    category: option.category ?? null,
    type: option.type,
    currentValue: option.currentValue,
    options: option.type === 'select' ? flattenSelectOptions(option.options) : [],
  }));
}

export function pickConfigOption(
  options: acp.SessionConfigOption[] | null | undefined,
  category: 'model' | 'thought_level',
  hint: RegExp,
): acp.SessionConfigOption | undefined {
  const list = options ?? [];
  return list.find((option) => option.category === category) ?? list.find((option) => hint.test(option.id) || hint.test(option.name));
}

export function modelConfigOption(options: acp.SessionConfigOption[] | null | undefined) {
  return pickConfigOption(options, 'model', MODEL_HINT);
}

export function thoughtConfigOption(options: acp.SessionConfigOption[] | null | undefined) {
  return pickConfigOption(options, 'thought_level', THOUGHT_HINT);
}
