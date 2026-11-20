import { CheckSquare, Plus, Square, Trash2 } from 'lucide-react';
import { FormEvent, useState } from 'react';
import type { TaskItem } from '../types/jarvis';

interface TasksViewProps {
  tasks: TaskItem[];
  onAddTask: (title: string, category: TaskItem['category']) => Promise<void>;
  onToggleTask: (id: string, completed: boolean) => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
}

const CATEGORY_LABELS: Record<TaskItem['category'], string> = {
  task: 'Tâche',
  note: 'Note',
  reminder: 'Rappel',
};

export function TasksView({ tasks, onAddTask, onToggleTask, onDeleteTask }: TasksViewProps) {
  const [filter, setFilter] = useState<'all' | TaskItem['category']>('all');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<TaskItem['category']>('task');
  const [submitting, setSubmitting] = useState(false);

  const filtered = tasks.filter((t) => (filter === 'all' ? true : t.category === filter));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onAddTask(title.trim(), category);
      setTitle('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-50">
            Tâches &amp; Notes
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">
            Synchronisées avec la voix : dites simplement « Note que je dois appeler le garage » ou
            « Ajoute une tâche ».
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-[#111827] p-1 border border-slate-800 shrink-0">
          {(
            [
              ['all', 'Tout'],
              ['task', 'Tâches'],
              ['note', 'Notes'],
              ['reminder', 'Rappels'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                filter === key
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-[#111827] p-4 sm:flex-row"
      >
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ajouter une tâche, une note ou un rappel..."
          className="flex-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as TaskItem['category'])}
          aria-label="Catégorie"
          className="rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
        >
          <option value="task">Tâche</option>
          <option value="note">Note</option>
          <option value="reminder">Rappel</option>
        </select>
        <button
          type="submit"
          disabled={!title.trim() || submitting}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          Ajouter
        </button>
      </form>

      <div className="rounded-xl border border-slate-800 bg-[#111827] divide-y divide-slate-800/80">
        {filtered.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-slate-400">
              Aucun élément dans cette catégorie pour le moment.
            </p>
          </div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-slate-800/30"
            >
              <button
                type="button"
                onClick={() => void onToggleTask(item.id, !item.completed)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                {item.completed ? (
                  <CheckSquare className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <Square className="h-4 w-4 shrink-0 text-slate-500" />
                )}
                <div className="min-w-0 flex-1">
                  <div
                    className={`truncate text-sm ${
                      item.completed ? 'text-slate-500 line-through' : 'text-slate-100'
                    }`}
                  >
                    {item.title}
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    <span>{CATEGORY_LABELS[item.category]}</span>
                    <span aria-hidden="true" className="mx-1.5">·</span>
                    <span className="font-mono tabular-nums">
                      {new Date(item.createdAt).toLocaleDateString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => void onDeleteTask(item.id)}
                aria-label={`Supprimer ${item.title}`}
                className="rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-800 hover:text-rose-400 shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
