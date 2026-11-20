import {
  AlertTriangle,
  Check,
  CheckSquare,
  Cpu,
  ExternalLink,
  Menu,
  Mic,
  MicOff,
  Send,
  Settings,
  Terminal,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AgentSetupView } from './components/AgentSetupView';
import { LogsAndSettingsView } from './components/LogsAndSettingsView';
import { TasksView } from './components/TasksView';
import { VoiceWaveform } from './components/VoiceWaveform';
import { type ListeningMode, useVoiceAssistant } from './hooks/useVoiceAssistant';
import type {
  ChatMessage,
  CommandLogEntry,
  GroundingSource,
  LocalAgentStatus,
  PendingPcAction,
  TaskItem,
  UserPreferences,
} from './types/jarvis';

type NavTab = 'console' | 'agent' | 'tasks' | 'settings';

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: typeof Terminal }> = [
  { id: 'console', label: 'Console vocale', icon: Terminal },
  { id: 'agent', label: 'Agent PC résident', icon: Cpu },
  { id: 'tasks', label: 'Tâches & notes', icon: CheckSquare },
  { id: 'settings', label: 'Journal & réglages', icon: Settings },
];

const QUICK_PROMPTS = [
  'Quelle heure est-il ?',
  'Météo à Paris aujourd’hui',
  'Note : vérifier les sauvegardes ce soir',
  'Ferme le PC',
];

const LOCAL_BRIDGE_URL = 'http://127.0.0.1:7474';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavTab>('console');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [sessionId] = useState(() => `jarvis-web-${Date.now()}`);
  const [preferences, setPreferences] = useState<UserPreferences>({
    honorific: 'Monsieur',
    wakeWord: 'jarvis',
    voiceEnabled: true,
    speechRate: 1.04,
    proactiveAlerts: true,
  });
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [commandLogs, setCommandLogs] = useState<CommandLogEntry[]>([]);
  const [agentStatus, setAgentStatus] = useState<LocalAgentStatus>({
    connected: false,
    lastCheckedAt: new Date().toISOString(),
  });
  const [checkingAgent, setCheckingAgent] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-1',
      role: 'assistant',
      text: 'Bonjour Monsieur. Je suis opérationnel et à votre écoute. Dites-moi ce dont vous avez besoin, ou installez l’Agent PC résident pour que je puisse piloter votre ordinateur en arrière-plan.',
      timestamp: new Date().toISOString(),
    },
  ]);
  const [inputText, setInputText] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const [listeningMode, setListeningMode] = useState<ListeningMode>('direct');
  const [nowTime, setNowTime] = useState(() => new Date());

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const pendingConfirmationMsg = messages.find(
    (m) => m.pendingAction?.status === 'pending_confirmation'
  );

  // Horloge en direct
  useEffect(() => {
    const timer = setInterval(() => setNowTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Chargement de l'état serveur initial
  const loadServerState = useCallback(async () => {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) return;
      const data = (await res.json()) as {
        preferences: UserPreferences;
        tasks: TaskItem[];
        commandLogs: CommandLogEntry[];
      };
      setPreferences(data.preferences);
      setTasks(data.tasks);
      setCommandLogs(data.commandLogs);
    } catch {
      // ignore initial fetch errors
    }
  }, []);

  // Vérification réelle du pont local PC sur 127.0.0.1:7474
  const checkLocalAgent = useCallback(async () => {
    setCheckingAgent(true);
    try {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 1400);
      const res = await fetch(`${LOCAL_BRIDGE_URL}/health`, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const data = (await res.json()) as {
          connected?: boolean;
          platform?: string;
          hostname?: string;
          version?: string;
        };
        setAgentStatus({
          connected: Boolean(data.connected),
          platform: data.platform,
          hostname: data.hostname,
          version: data.version,
          lastCheckedAt: new Date().toISOString(),
        });
      } else {
        setAgentStatus({ connected: false, lastCheckedAt: new Date().toISOString() });
      }
    } catch {
      setAgentStatus({ connected: false, lastCheckedAt: new Date().toISOString() });
    } finally {
      setCheckingAgent(false);
    }
  }, []);

  useEffect(() => {
    void loadServerState();
    void checkLocalAgent();
  }, [loadServerState, checkLocalAgent]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  const executeOnLocalBridge = useCallback(
    async (action: PendingPcAction): Promise<{ ok: boolean; message: string }> => {
      try {
        const res = await fetch(`${LOCAL_BRIDGE_URL}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: action.action, target: action.target }),
        });
        const data = (await res.json()) as { ok?: boolean; message?: string };
        const ok = Boolean(res.ok && data.ok);
        const msg =
          data.message ||
          (ok
            ? `C'est fait, ${preferences.honorific}.`
            : `Impossible d'exécuter l'action, ${preferences.honorific}.`);

        await fetch('/api/jarvis/command-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: action.action,
            target: action.target || '—',
            status: ok ? 'executed' : 'blocked_no_agent',
            detail: msg,
          }),
        });
        void loadServerState();
        return { ok, message: msg };
      } catch {
        const msg = `Le pont PC local ne répond plus, ${preferences.honorific}.`;
        await fetch('/api/jarvis/command-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: action.action,
            target: action.target || '—',
            status: 'blocked_no_agent',
            detail: msg,
          }),
        });
        void loadServerState();
        return { ok: false, message: msg };
      }
    },
    [loadServerState, preferences.honorific]
  );

  // Déclaration avancée pour le hook vocal
  const speakRef = useRef<(text: string) => void>(() => {});

  const handleConfirmPendingAction = useCallback(
    async (msgId: string, action: PendingPcAction, confirmed: boolean) => {
      if (!confirmed) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === msgId && m.pendingAction
              ? { ...m, pendingAction: { ...m.pendingAction, status: 'cancelled' } }
              : m
          )
        );
        await fetch('/api/jarvis/command-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: action.action,
            target: action.target || '—',
            status: 'cancelled',
            detail: 'Annulé par l’utilisateur',
          }),
        });
        const cancelText = `Bien compris, ${preferences.honorific}. Action annulée.`;
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: cancelText,
            timestamp: new Date().toISOString(),
          },
        ]);
        speakRef.current(cancelText);
        void loadServerState();
        return;
      }

      const result = await executeOnLocalBridge(action);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId && m.pendingAction
            ? {
                ...m,
                pendingAction: {
                  ...m.pendingAction,
                  status: result.ok ? 'executed' : 'bridge_unavailable',
                  resultMessage: result.message,
                },
              }
            : m
        )
      );
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: result.message,
          timestamp: new Date().toISOString(),
        },
      ]);
      speakRef.current(result.message);
    },
    [executeOnLocalBridge, loadServerState, preferences.honorific]
  );

  const sendToJarvis = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || isThinking) return;

      // Si une confirmation est en attente, permettre de répondre vocalement "oui / annule"
      if (pendingConfirmationMsg?.pendingAction) {
        const low = text.toLowerCase();
        if (/^(oui|confirme|vas-y|d'accord|ok|exécute|valide)/.test(low)) {
          setMessages((prev) => [
            ...prev,
            {
              id: `u-${Date.now()}`,
              role: 'user',
              text,
              timestamp: new Date().toISOString(),
            },
          ]);
          await handleConfirmPendingAction(
            pendingConfirmationMsg.id,
            pendingConfirmationMsg.pendingAction,
            true
          );
          return;
        }
        if (/^(non|annule|stop|arrête|laisse tomber)/.test(low)) {
          setMessages((prev) => [
            ...prev,
            {
              id: `u-${Date.now()}`,
              role: 'user',
              text,
              timestamp: new Date().toISOString(),
            },
          ]);
          await handleConfirmPendingAction(
            pendingConfirmationMsg.id,
            pendingConfirmationMsg.pendingAction,
            false
          );
          return;
        }
      }

      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        text,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsThinking(true);

      try {
        const res = await fetch('/api/jarvis/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            message: text,
            localAgentConnected: agentStatus.connected,
          }),
        });

        const data = (await res.json()) as {
          reply?: string;
          error?: string;
          toolsUsed?: string[];
          sources?: GroundingSource[];
          pendingAction?: PendingPcAction;
        };

        let finalAction = data.pendingAction;
        let replyText = data.reply || data.error || `À votre service, ${preferences.honorific}.`;

        // Si action non sensible prête pour le pont local connecté, on l'exécute directement
        if (finalAction && finalAction.status === 'ready_to_execute' && agentStatus.connected) {
          const execRes = await executeOnLocalBridge(finalAction);
          finalAction = {
            ...finalAction,
            status: execRes.ok ? 'executed' : 'bridge_unavailable',
            resultMessage: execRes.message,
          };
          replyText = execRes.message;
        }

        const assistantMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: replyText,
          timestamp: new Date().toISOString(),
          toolsUsed: data.toolsUsed,
          sources: data.sources,
          pendingAction: finalAction,
        };

        setMessages((prev) => [...prev, assistantMsg]);
        speakRef.current(replyText);
        void loadServerState();
      } catch {
        const errText = `Connexion au serveur interrompue, ${preferences.honorific}.`;
        setMessages((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: 'assistant',
            text: errText,
            timestamp: new Date().toISOString(),
          },
        ]);
      } finally {
        setIsThinking(false);
      }
    },
    [
      agentStatus.connected,
      executeOnLocalBridge,
      handleConfirmPendingAction,
      isThinking,
      loadServerState,
      pendingConfirmationMsg,
      preferences.honorific,
      sessionId,
    ]
  );

  const voice = useVoiceAssistant({
    wakeWord: preferences.wakeWord,
    voiceEnabled: preferences.voiceEnabled,
    speechRate: preferences.speechRate,
    listeningMode,
    awaitingConfirmation: Boolean(pendingConfirmationMsg),
    onCommand: (spoken) => {
      void sendToJarvis(spoken);
    },
  });

  speakRef.current = voice.speak;

  const handleFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    voice.unlockAudio();
    if (!inputText.trim() || isThinking) return;
    const text = inputText;
    setInputText('');
    void sendToJarvis(text);
  };

  const handleSavePreferences = async (patch: Partial<UserPreferences>) => {
    const res = await fetch('/api/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const updated = (await res.json()) as UserPreferences;
      setPreferences(updated);
    }
  };

  const handleAddTask = async (title: string, category: TaskItem['category']) => {
    const res = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, category }),
    });
    if (res.ok) {
      await loadServerState();
    }
  };

  const handleToggleTask = async (id: string, completed: boolean) => {
    const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed }),
    });
    if (res.ok) {
      await loadServerState();
    }
  };

  const handleDeleteTask = async (id: string) => {
    const res = await fetch(`/api/tasks/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      await loadServerState();
    }
  };

  const handleResetSession = async () => {
    await fetch('/api/jarvis/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    });
    setMessages([
      {
        id: `reset-${Date.now()}`,
        role: 'assistant',
        text: `Mémoire de conversation réinitialisée, ${preferences.honorific}. Je vous écoute.`,
        timestamp: new Date().toISOString(),
      },
    ]);
  };

  const currentTabLabel = NAV_ITEMS.find((i) => i.id === activeTab)?.label ?? 'Console vocale';

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex">
      {/* Sidebar Desktop */}
      <aside className="hidden lg:flex lg:w-[260px] lg:flex-col lg:border-r lg:border-slate-800/80 lg:bg-[#0E1420]">
        <div className="flex h-16 items-center border-b border-slate-800/80 px-6">
          <span className="font-display text-lg font-bold tracking-tight text-slate-50 whitespace-nowrap">
            JARVIS
          </span>
        </div>

        <nav className="flex-1 space-y-1 p-4" aria-label="Navigation principale">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-slate-800/90 text-sky-300'
                    : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-slate-800/80 p-5 space-y-3 text-xs">
          <div className="flex items-center justify-between text-slate-400">
            <span>Heure locale</span>
            <span className="font-mono tabular-nums text-slate-200">
              {nowTime.toLocaleTimeString('fr-FR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          </div>

          <div className="flex items-center justify-between text-slate-400">
            <span>Pont PC local</span>
            <span className={agentStatus.connected ? 'text-emerald-400' : 'text-slate-400'}>
              {agentStatus.connected ? 'Connecté' : 'Non détecté'}
            </span>
          </div>

          {!agentStatus.connected && (
            <button
              type="button"
              onClick={() => setActiveTab('agent')}
              className="w-full rounded-lg border border-slate-700 bg-[#111827] px-3 py-2 text-left text-xs font-medium text-slate-200 transition-colors hover:bg-slate-800"
            >
              Installer l’agent PC résident
            </button>
          )}
        </div>
      </aside>

      {/* Drawer Mobile */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />
          <aside className="relative z-10 flex w-72 flex-col border-r border-slate-800 bg-[#0E1420] p-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <span className="font-display text-lg font-bold text-slate-50">JARVIS</span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Fermer le menu"
                className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="mt-4 space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setActiveTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium ${
                      active
                        ? 'bg-slate-800 text-sky-300'
                        : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Colonne principale */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Bar Contract : Breadcrumb à gauche, 1 action primaire à droite */}
        <header className="flex h-16 items-center justify-between gap-8 border-b border-slate-800/80 bg-[#0B0F17] px-6 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Ouvrir la navigation"
              className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-100 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="font-medium text-slate-400 lg:hidden">JARVIS</span>
              <span className="text-slate-600 lg:hidden">/</span>
              <span className="font-medium text-slate-200 truncate">{currentTabLabel}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => (voice.isListening ? voice.stopListening() : voice.startListening())}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                voice.isListening
                  ? 'bg-rose-500/15 text-rose-300 border border-rose-500/40 hover:bg-rose-500/25'
                  : 'bg-sky-500 text-slate-950 hover:bg-sky-400'
              }`}
            >
              {voice.isListening ? (
                <>
                  <MicOff className="h-4 w-4" />
                  Arrêter le micro
                </>
              ) : (
                <>
                  <Mic className="h-4 w-4" />
                  Activer le micro
                </>
              )}
            </button>
          </div>
        </header>

        {/* Contenu principal */}
        <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-6">
          {activeTab === 'console' && (
            <div className="flex flex-1 flex-col gap-6">
              {/* Panneau acoustique & mode d'écoute */}
              <section className="rounded-xl border border-slate-800 bg-[#111827] p-5">
                <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-5">
                    <VoiceWaveform
                      isListening={voice.isListening}
                      isSpeaking={voice.isSpeaking}
                      isThinking={isThinking}
                      analyserNode={voice.analyserNode}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-1 rounded-lg border border-slate-800 bg-[#0B0F17] p-1">
                      <button
                        type="button"
                        onClick={() => setListeningMode('direct')}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                          listeningMode === 'direct'
                            ? 'bg-slate-800 text-slate-100'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Écoute directe
                      </button>
                      <button
                        type="button"
                        onClick={() => setListeningMode('wakeword')}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                          listeningMode === 'wakeword'
                            ? 'bg-slate-800 text-slate-100'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        Mot-clé « {preferences.wakeWord} »
                      </button>
                    </div>

                    {voice.isSpeaking ? (
                      <button
                        type="button"
                        onClick={voice.stopSpeaking}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
                      >
                        <VolumeX className="h-3.5 w-3.5" />
                        Couper la voix
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void handleSavePreferences({ voiceEnabled: !preferences.voiceEnabled })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
                        >
                          {preferences.voiceEnabled ? (
                            <>
                              <Volume2 className="h-3.5 w-3.5 text-sky-400" />
                              Voix activée
                            </>
                          ) : (
                            <>
                              <VolumeX className="h-3.5 w-3.5 text-slate-500" />
                              Mode silencieux
                            </>
                          )}
                        </button>
                        {preferences.voiceEnabled && (
                          <button
                            type="button"
                            onClick={() =>
                              voice.speak(
                                `Bonsoir ${preferences.honorific}. Tous les systèmes sont opérationnels. Que puis-je faire pour vous ?`
                              )
                            }
                            className="rounded-lg border border-slate-800 bg-[#0B0F17] px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
                          >
                            Tester la voix
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* État réel du microphone / transcription en direct */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3 text-xs text-slate-400">
                  <div>
                    {voice.isListening ? (
                      voice.interimTranscript ? (
                        <span className="text-sky-300">
                          Transcription : « {voice.interimTranscript} »
                        </span>
                      ) : listeningMode === 'wakeword' ? (
                        <span>
                          Microphone actif · Dites « {preferences.wakeWord} » suivi de votre
                          demande.
                        </span>
                      ) : (
                        <span>Microphone actif · Parlez naturellement en français.</span>
                      )
                    ) : (
                      <span>
                        Microphone en pause · Utilisez « Activer le micro » ou saisissez une
                        commande ci-dessous.
                      </span>
                    )}
                  </div>
                  <div className="font-mono tabular-nums text-slate-500">
                    {agentStatus.connected
                      ? `PC relié : ${agentStatus.hostname ?? 'local'}`
                      : 'Session navigateur'}
                  </div>
                </div>

                {(voice.voiceError || !voice.speechSupported) && (
                  <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300">
                    {voice.voiceError ||
                      'Reconnaissance vocale non disponible dans ce navigateur. Utilisez la saisie texte ou installez l’Agent PC résident.'}
                  </div>
                )}
              </section>

              {/* Fil de conversation */}
              <section className="flex flex-1 flex-col rounded-xl border border-slate-800 bg-[#111827] overflow-hidden">
                <div className="flex-1 space-y-4 overflow-y-auto p-5 max-h-[460px]">
                  {messages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${
                        msg.role === 'user' ? 'items-end' : 'items-start'
                      }`}
                    >
                      <div
                        className={`max-w-[82%] rounded-xl px-4 py-3 text-sm leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-sky-500/15 text-slate-100 border border-sky-500/25'
                            : 'bg-[#0E1420] text-slate-200 border border-slate-800'
                        }`}
                      >
                        <div className="mb-1 flex items-center justify-between gap-4 text-xs text-slate-500">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-400">
                              {msg.role === 'user' ? preferences.honorific : 'JARVIS'}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {new Date(msg.timestamp).toLocaleTimeString('fr-FR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          {msg.role === 'assistant' && (
                            <button
                              type="button"
                              onClick={() => voice.forceSpeak(msg.text)}
                              aria-label="Écouter ce message"
                              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-sky-300 shrink-0"
                            >
                              <Volume2 className="h-3 w-3" />
                              Écouter
                            </button>
                          )}
                        </div>

                        <p className="whitespace-pre-wrap">{msg.text}</p>

                        {/* Sources web issues de Google Search Grounding */}
                        {msg.sources && msg.sources.length > 0 && (
                          <div className="mt-3 border-t border-slate-800 pt-2.5 space-y-1">
                            <div className="text-xs font-medium text-slate-400">Sources</div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                              {msg.sources.slice(0, 4).map((src) => (
                                <a
                                  key={src.uri}
                                  href={src.uri}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline"
                                >
                                  <span className="max-w-[220px] truncate">{src.title}</span>
                                  <ExternalLink className="h-3 w-3 shrink-0" />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Demande de confirmation explicite avant action sensible */}
                        {msg.pendingAction &&
                          msg.pendingAction.status === 'pending_confirmation' && (
                            <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5">
                              <div className="flex items-start gap-2.5">
                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                                <div className="text-xs leading-relaxed text-amber-200">
                                  <div className="font-semibold">
                                    Confirmation requise : {msg.pendingAction.action}
                                  </div>
                                  <div className="mt-0.5 text-amber-200/80">
                                    {msg.pendingAction.riskSummary}
                                  </div>
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleConfirmPendingAction(
                                      msg.id,
                                      msg.pendingAction!,
                                      true
                                    )
                                  }
                                  className="inline-flex items-center gap-1.5 rounded-md bg-amber-400 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-300"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  Confirmer l’exécution
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleConfirmPendingAction(
                                      msg.id,
                                      msg.pendingAction!,
                                      false
                                    )
                                  }
                                  className="rounded-md border border-slate-700 bg-[#0B0F17] px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800"
                                >
                                  Annuler
                                </button>
                              </div>
                            </div>
                          )}

                        {/* Pont local absent : proposition directe d'installation */}
                        {msg.pendingAction &&
                          msg.pendingAction.status === 'bridge_unavailable' && (
                            <div className="mt-3 rounded-lg border border-slate-700 bg-[#111827] p-3.5">
                              <div className="text-xs text-slate-300">
                                Action système demandée :{' '}
                                <span className="font-mono text-sky-300">
                                  {msg.pendingAction.action}
                                  {msg.pendingAction.target ? ` (${msg.pendingAction.target})` : ''}
                                </span>
                              </div>
                              <div className="mt-2.5">
                                <button
                                  type="button"
                                  onClick={() => setActiveTab('agent')}
                                  className="inline-flex items-center gap-2 rounded-md bg-sky-500 px-3 py-1.5 text-xs font-medium text-slate-950 hover:bg-sky-400"
                                >
                                  <Cpu className="h-3.5 w-3.5" />
                                  Configurer l’Agent PC Résident
                                </button>
                              </div>
                            </div>
                          )}
                      </div>
                    </div>
                  ))}

                  {isThinking && (
                    <div className="flex items-start">
                      <div className="rounded-xl border border-slate-800 bg-[#0E1420] px-4 py-3 text-sm text-slate-400">
                        JARVIS analyse votre demande...
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Commandes rapides + Saisie texte */}
                <div className="border-t border-slate-800 bg-[#0E1420] p-4 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {QUICK_PROMPTS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        disabled={isThinking}
                        onClick={() => {
                          voice.unlockAudio();
                          void sendToJarvis(q);
                        }}
                        className="rounded-md border border-slate-800 bg-[#111827] px-3 py-1.5 text-xs text-slate-300 transition-colors hover:border-slate-700 hover:text-slate-100 disabled:opacity-50 whitespace-nowrap shrink-0"
                      >
                        {q}
                      </button>
                    ))}
                  </div>

                  <form onSubmit={handleFormSubmit} className="flex items-center gap-3">
                    <input
                      type="text"
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder={`Écrivez une instruction pour JARVIS, ${preferences.honorific}...`}
                      className="flex-1 rounded-lg border border-slate-700 bg-[#0B0F17] px-4 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-sky-500 focus:outline-none"
                    />
                    <button
                      type="submit"
                      disabled={!inputText.trim() || isThinking}
                      className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      <Send className="h-4 w-4" />
                      Envoyer
                    </button>
                  </form>
                </div>
              </section>
            </div>
          )}

          {activeTab === 'agent' && (
            <AgentSetupView
              agentStatus={agentStatus}
              onRefreshAgent={checkLocalAgent}
              checkingAgent={checkingAgent}
            />
          )}

          {activeTab === 'tasks' && (
            <TasksView
              tasks={tasks}
              onAddTask={handleAddTask}
              onToggleTask={handleToggleTask}
              onDeleteTask={handleDeleteTask}
            />
          )}

          {activeTab === 'settings' && (
            <LogsAndSettingsView
              preferences={preferences}
              commandLogs={commandLogs}
              onSavePreferences={handleSavePreferences}
              onResetSession={handleResetSession}
            />
          )}
        </main>
      </div>
    </div>
  );
}
