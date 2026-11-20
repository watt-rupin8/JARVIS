export type JarvisActionType =
  | 'shutdown'
  | 'restart'
  | 'sleep'
  | 'lock'
  | 'open_app'
  | 'open_url'
  | 'list_files'
  | 'create_file'
  | 'delete_file'
  | 'set_volume'
  | 'system_info'
  | 'run_command';

export interface PendingPcAction {
  id: string;
  action: JarvisActionType;
  target: string;
  requiresConfirmation: boolean;
  riskSummary: string;
  status: 'pending_confirmation' | 'ready_to_execute' | 'executed' | 'cancelled' | 'bridge_unavailable';
  resultMessage?: string;
  createdAt: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  toolsUsed?: string[];
  sources?: GroundingSource[];
  pendingAction?: PendingPcAction;
}

export interface TaskItem {
  id: string;
  title: string;
  category: 'task' | 'note' | 'reminder';
  completed: boolean;
  createdAt: string;
}

export interface CommandLogEntry {
  id: string;
  action: string;
  target: string;
  status: 'executed' | 'cancelled' | 'blocked_no_agent' | 'pending';
  timestamp: string;
  detail: string;
}

export interface UserPreferences {
  honorific: string;
  wakeWord: string;
  voiceEnabled: boolean;
  speechRate: number;
  proactiveAlerts: boolean;
}

export interface JarvisStateSnapshot {
  preferences: UserPreferences;
  tasks: TaskItem[];
  commandLogs: CommandLogEntry[];
}

export interface LocalAgentStatus {
  connected: boolean;
  platform?: string;
  hostname?: string;
  version?: string;
  lastCheckedAt: string;
}
