import type { GlobalSettings, Project } from '@riccon-scrum/shared';

export type SettingsTab = 'runtime' | 'embedding' | 'tasks' | 'project' | 'delivery' | 'knowledge' | 'projects';

export type SettingsToast = (kind: 'success' | 'error', text: string) => void;

export interface GlobalPaneProps {
  g: GlobalSettings;
  onChange: (patch: Partial<GlobalSettings>) => void;
  agentKinds: string[];
  saving: boolean;
  onSave: () => void;
}

export interface ProjectPaneProps {
  project: Project;
  onToast: SettingsToast;
  onChanged: () => Promise<void>;
}

export interface ProjectConfigProps extends ProjectPaneProps {
  agentKinds: string[];
}
