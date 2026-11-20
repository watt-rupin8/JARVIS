import { RotateCcw, Save } from 'lucide-react';
import { FormEvent, useEffect, useState } from 'react';
import type { CommandLogEntry, UserPreferences } from '../types/jarvis';

interface LogsAndSettingsViewProps {
  preferences: UserPreferences;
  commandLogs: CommandLogEntry[];
  onSavePreferences: (patch: Partial<UserPreferences>) => Promise<void>;
  onResetSession: () => Promise<void>;
}

const STATUS_LABEL: Record<CommandLogEntry['status'], { text: string; className: string }> = {
  executed: { text: 'Exécutée', className: 'text-emerald-400' },
  pending: { text: 'Confirmation requise', className: 'text-amber-400' },
  cancelled: { text: 'Annulée', className: 'text-slate-400' },
  blocked_no_agent: { text: 'Agent PC requis', className: 'text-rose-400' },
};

export function LogsAndSettingsView({
  preferences,
  commandLogs,
  onSavePreferences,
  onResetSession,
}: LogsAndSettingsViewProps) {
  const [honorific, setHonorific] = useState(preferences.honorific);
  const [wakeWord, setWakeWord] = useState(preferences.wakeWord);
  const [voiceEnabled, setVoiceEnabled] = useState(preferences.voiceEnabled);
  const [speechRate, setSpeechRate] = useState(preferences.speechRate);
  const [saving, setSaving] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);

  useEffect(() => {
    setHonorific(preferences.honorific);
    setWakeWord(preferences.wakeWord);
    setVoiceEnabled(preferences.voiceEnabled);
    setSpeechRate(preferences.speechRate);
  }, [preferences]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onSavePreferences({
        honorific: honorific.trim() || 'Monsieur',
        wakeWord: wakeWord.trim().toLowerCase() || 'jarvis',
        voiceEnabled,
        speechRate,
      });
      setSavedFeedback(true);
      setTimeout(() => setSavedFeedback(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="border-b border-slate-800 pb-6">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-50">
          Préférences &amp; Journal
        </h1>
        <p className="mt-1.5 text-sm text-slate-400">
          Personnalisez l’adresse vocale de JARVIS et consultez l’historique des commandes système.
        </p>
      </div>

      {/* Formulaire préférences */}
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="rounded-xl border border-slate-800 bg-[#111827] p-6 space-y-6"
      >
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          <div>
            <label htmlFor="honorific" className="block text-sm font-medium text-slate-200">
              Appellation utilisée par JARVIS
            </label>
            <input
              id="honorific"
              type="text"
              value={honorific}
              onChange={(e) => setHonorific(e.target.value)}
              placeholder="Monsieur"
              className="mt-2 w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3.5 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Par défaut « Monsieur ». Vous pouvez aussi demander à la voix « Appelle-moi [prénom] ».
            </p>
          </div>

          <div>
            <label htmlFor="wakeWord" className="block text-sm font-medium text-slate-200">
              Mot-clé d’activation vocale
            </label>
            <input
              id="wakeWord"
              type="text"
              value={wakeWord}
              onChange={(e) => setWakeWord(e.target.value)}
              placeholder="jarvis"
              className="mt-2 w-full rounded-lg border border-slate-700 bg-[#0B0F17] px-3.5 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
            />
            <p className="mt-1.5 text-xs text-slate-500">
              Utilisé en mode veille continue pour déclencher l’écoute d’une commande.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-[#0E1420] px-4 py-3">
            <div>
              <div className="text-sm font-medium text-slate-200">Réponse vocale (TTS français)</div>
              <div className="text-xs text-slate-500">
                JARVIS lit ses réponses à haute voix automatiquement.
              </div>
            </div>
            <input
              type="checkbox"
              checked={voiceEnabled}
              onChange={(e) => setVoiceEnabled(e.target.checked)}
              aria-label="Activer la réponse vocale"
              className="h-4 w-4 accent-sky-500"
            />
          </div>

          <div className="rounded-lg border border-slate-800 bg-[#0E1420] px-4 py-3">
            <div className="flex items-center justify-between text-sm font-medium text-slate-200">
              <span>Cadence de la voix</span>
              <span className="font-mono text-xs tabular-nums text-sky-400">
                {speechRate.toFixed(2)}x
              </span>
            </div>
            <input
              type="range"
              min="0.8"
              max="1.35"
              step="0.05"
              value={speechRate}
              onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
              aria-label="Cadence de la voix"
              className="mt-2 w-full accent-sky-500"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-800 pt-4">
          <button
            type="button"
            onClick={() => void onResetSession()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-4 w-4" />
            Réinitialiser la conversation
          </button>

          <div className="flex items-center gap-3">
            {savedFeedback && (
              <span className="text-xs text-emerald-400">Préférences enregistrées.</span>
            )}
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </form>

      {/* Journal tabulaire des commandes PC */}
      <div className="rounded-xl border border-slate-800 bg-[#111827] overflow-hidden">
        <div className="border-b border-slate-800 px-5 py-4">
          <h2 className="font-display text-base font-semibold text-slate-100">
            Journal des commandes système
          </h2>
        </div>

        {commandLogs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">
            Aucune commande système enregistrée durant cette session.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-800 bg-[#0E1420] text-xs font-medium text-slate-400">
                <tr>
                  <th className="px-5 py-3">Horodatage</th>
                  <th className="px-5 py-3">Action</th>
                  <th className="px-5 py-3">Cible</th>
                  <th className="px-5 py-3">Statut</th>
                  <th className="px-5 py-3">Détail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {commandLogs.map((log) => {
                  const st = STATUS_LABEL[log.status];
                  return (
                    <tr key={log.id} className="hover:bg-slate-800/30">
                      <td className="px-5 py-3 font-mono text-xs tabular-nums text-slate-400 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleTimeString('fr-FR', {
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-200 whitespace-nowrap">
                        {log.action}
                      </td>
                      <td className="px-5 py-3 text-slate-300 max-w-[180px] truncate">
                        {log.target}
                      </td>
                      <td className={`px-5 py-3 text-xs font-medium whitespace-nowrap ${st.className}`}>
                        {st.text}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-400">{log.detail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
