import fs from 'fs';
import path from 'path';
import type {
  CommandLogEntry,
  JarvisStateSnapshot,
  TaskItem,
  UserPreferences,
} from '../src/types/jarvis.ts';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'jarvis_state.json');

const DEFAULT_STATE: JarvisStateSnapshot = {
  preferences: {
    honorific: 'Monsieur',
    wakeWord: 'jarvis',
    voiceEnabled: true,
    speechRate: 1.04,
    proactiveAlerts: true,
  },
  tasks: [
    {
      id: 'task-init-1',
      title: 'Installer l’agent PC résident pour activer les commandes système locales',
      category: 'task',
      completed: false,
      createdAt: new Date().toISOString(),
    },
  ],
  commandLogs: [],
};

function ensureStore(): JarvisStateSnapshot {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(STATE_FILE)) {
      fs.writeFileSync(STATE_FILE, JSON.stringify(DEFAULT_STATE, null, 2), 'utf-8');
      return structuredClone(DEFAULT_STATE);
    }
    const raw = fs.readFileSync(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<JarvisStateSnapshot>;
    return {
      preferences: { ...DEFAULT_STATE.preferences, ...(parsed.preferences ?? {}) },
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      commandLogs: Array.isArray(parsed.commandLogs) ? parsed.commandLogs : [],
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function saveStore(state: JarvisStateSnapshot): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
}

export function getStateSnapshot(): JarvisStateSnapshot {
  return ensureStore();
}

export function updatePreferences(patch: Partial<UserPreferences>): UserPreferences {
  const state = ensureStore();
  state.preferences = {
    ...state.preferences,
    ...patch,
    honorific: (patch.honorific ?? state.preferences.honorific).trim() || 'Monsieur',
    wakeWord: (patch.wakeWord ?? state.preferences.wakeWord).trim().toLowerCase() || 'jarvis',
  };
  saveStore(state);
  return state.preferences;
}

export function addTask(title: string, category: TaskItem['category'] = 'task'): TaskItem {
  const state = ensureStore();
  const item: TaskItem = {
    id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    title: title.trim(),
    category,
    completed: false,
    createdAt: new Date().toISOString(),
  };
  state.tasks.unshift(item);
  saveStore(state);
  return item;
}

export function toggleTask(id: string, completed?: boolean): TaskItem | null {
  const state = ensureStore();
  const found = state.tasks.find((t) => t.id === id);
  if (!found) return null;
  found.completed = typeof completed === 'boolean' ? completed : !found.completed;
  saveStore(state);
  return found;
}

export function findAndCompleteTaskByTitle(query: string): TaskItem | null {
  const state = ensureStore();
  const q = query.toLowerCase().trim();
  const found = state.tasks.find((t) => !t.completed && t.title.toLowerCase().includes(q));
  if (!found) return null;
  found.completed = true;
  saveStore(state);
  return found;
}

export function deleteTask(id: string): boolean {
  const state = ensureStore();
  const before = state.tasks.length;
  state.tasks = state.tasks.filter((t) => t.id !== id);
  if (state.tasks.length === before) return false;
  saveStore(state);
  return true;
}

export function deleteTaskByTitle(query: string): TaskItem | null {
  const state = ensureStore();
  const q = query.toLowerCase().trim();
  const found = state.tasks.find((t) => t.title.toLowerCase().includes(q));
  if (!found) return null;
  state.tasks = state.tasks.filter((t) => t.id !== found.id);
  saveStore(state);
  return found;
}

export function addCommandLog(entry: Omit<CommandLogEntry, 'id' | 'timestamp'>): CommandLogEntry {
  const state = ensureStore();
  const item: CommandLogEntry = {
    ...entry,
    id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp: new Date().toISOString(),
  };
  state.commandLogs = [item, ...state.commandLogs].slice(0, 50);
  saveStore(state);
  return item;
}
