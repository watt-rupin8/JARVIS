import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FolderArchive,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Volume2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { LocalAgentStatus } from '../types/jarvis';
import { createZipBlob } from '../utils/zipBuilder';

interface AgentFile {
  filename: string;
  label: string;
  platform: string;
  description: string;
  content: string;
}

interface AgentSetupViewProps {
  agentStatus: LocalAgentStatus;
  onRefreshAgent: () => Promise<void>;
  checkingAgent: boolean;
}

function triggerBlobDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function triggerClientDownload(filename: string, content: string) {
  triggerBlobDownload(filename, new Blob([content], { type: 'text/plain;charset=utf-8' }));
}

export function AgentSetupView({
  agentStatus,
  onRefreshAgent,
  checkingAgent,
}: AgentSetupViewProps) {
  const [files, setFiles] = useState<AgentFile[]>([]);
  const [selectedFilename, setSelectedFilename] = useState<string>('jarvis_pc.py');
  const [copied, setCopied] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [exportingFullZip, setExportingFullZip] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/agent/files')
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as { files?: AgentFile[] };
      })
      .then((data) => {
        if (!active) return;
        const list = data.files ?? [];
        setFiles(list);
        if (list.length > 0) {
          setSelectedFilename(list[0].filename);
        }
      })
      .catch((err) => {
        if (!active) return;
        setLoadError(
          err instanceof Error ? err.message : 'Impossible de charger les fichiers de l’agent.'
        );
      })
      .finally(() => {
        if (active) setLoadingFiles(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedFile = files.find((f) => f.filename === selectedFilename) ?? files[0];

  const handleDownloadByName = (filename: string) => {
    const file = files.find((f) => f.filename === filename);
    if (!file) return;
    triggerClientDownload(file.filename, file.content);
  };

  const handleDownloadAgentZip = () => {
    if (files.length === 0) return;
    const zipBlob = createZipBlob(
      files.map((f) => ({ name: f.filename, content: f.content }))
    );
    triggerBlobDownload('jarvis-pc-github.zip', zipBlob);
  };

  const handleDownloadFullProjectZip = async () => {
    setExportingFullZip(true);
    setLoadError(null);
    try {
      const r = await fetch('/api/project/export');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as { files?: Array<{ name: string; content: string }> };
      const list = data.files ?? [];
      if (list.length === 0) throw new Error('Aucun fichier trouvé à exporter.');
      const zipBlob = createZipBlob(list);
      triggerBlobDownload('jarvis-projet-complet.zip', zipBlob);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Impossible de générer le ZIP complet.'
      );
    } finally {
      setExportingFullZip(false);
    }
  };

  const handleCopy = async () => {
    if (!selectedFile) return;
    await navigator.clipboard.writeText(selectedFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 border-b border-slate-800 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-50">
            Installer JARVIS sur votre PC
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-400">
            Compatible avec toutes les versions de Python (3.6 à 3.14+). Deux petits fichiers
            propres à enregistrer dans le même dossier (par exemple Téléchargements).
          </p>
        </div>

        <button
          type="button"
          onClick={() => void onRefreshAgent()}
          disabled={checkingAgent}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#111827] px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`h-4 w-4 ${checkingAgent ? 'animate-spin' : ''}`} />
          Vérifier si actif
        </button>
      </div>

      {loadError && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
          {loadError}
        </div>
      )}

      {/* Téléchargement direct via Blob en mémoire (jamais intercepté par un proxy HTML) */}
      <div className="rounded-xl border border-slate-800 bg-[#111827] p-6 space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={loadingFiles || files.length === 0}
            onClick={handleDownloadAgentZip}
            className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2.5 text-sm font-medium text-slate-950 transition-colors hover:bg-sky-400 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <FolderArchive className="h-4 w-4" />
            Télécharger ZIP GitHub (Python PC)
          </button>

          <button
            type="button"
            disabled={loadingFiles || files.length === 0 || exportingFullZip}
            onClick={() => void handleDownloadFullProjectZip()}
            className="inline-flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-4 py-2.5 text-sm font-medium text-sky-300 transition-colors hover:bg-sky-500/20 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <FolderArchive className="h-4 w-4" />
            {exportingFullZip ? 'Création du ZIP...' : 'Télécharger ZIP Projet complet (Web + PC)'}
          </button>

          <button
            type="button"
            disabled={loadingFiles || files.length === 0}
            onClick={() => handleDownloadByName('jarvis_pc.py')}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0B0F17] px-4 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-4 w-4" />
            1. jarvis_pc.py
          </button>

          <button
            type="button"
            disabled={loadingFiles || files.length === 0}
            onClick={() => handleDownloadByName('lancer_jarvis.bat')}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0B0F17] px-4 py-2.5 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
          >
            <Download className="h-4 w-4" />
            2. lancer_jarvis.bat
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 border-t border-slate-800 pt-5 md:grid-cols-3">
          <div>
            <div className="font-mono text-xs font-medium text-sky-400">1. Télécharger</div>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Supprimez les anciens fichiers de votre dossier Téléchargements, puis téléchargez ces
              deux fichiers dans le même dossier.
            </p>
          </div>
          <div>
            <div className="font-mono text-xs font-medium text-sky-400">2. Lancer</div>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Double-cliquez sur{' '}
              <span className="font-mono text-xs text-slate-100">lancer_jarvis.bat</span> (ou
              tapez <span className="font-mono text-xs text-slate-100">python jarvis_pc.py</span>).
              Il installe tout seul la voix et le micro selon votre version de Python.
            </p>
          </div>
          <div>
            <div className="font-mono text-xs font-medium text-sky-400">3. Parler</div>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Dites « Jarvis, ferme le PC », « Jarvis, ouvre Chrome » ou « Jarvis, quelle heure
              est-il ».
            </p>
          </div>
        </div>
      </div>

      {/* 3 cartes simples */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-[#111827] p-5">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <Monitor className="h-4 w-4 text-slate-400" />
            <span>État sur ce PC</span>
          </div>
          <div className="mt-3 text-lg font-semibold text-slate-100">
            {agentStatus.connected ? 'JARVIS est actif sur votre PC' : 'Non lancé actuellement'}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            {agentStatus.connected
              ? `Connecté (${agentStatus.platform ?? 'PC local'} · ${agentStatus.hostname ?? 'Poste'})`
              : 'Dès que jarvis_pc.py tourne sur votre ordinateur, ce statut passe à « actif ».'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111827] p-5">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <Volume2 className="h-4 w-4 text-slate-400" />
            <span>Toutes versions Python</span>
          </div>
          <div className="mt-3 text-lg font-semibold text-slate-100">Python 3.6 à 3.14+</div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Lecture MP3 native Windows intégrée (winmm.dll) et secours audio sounddevice si PyAudio
            n’est pas disponible sur votre version de Python.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-[#111827] p-5">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400">
            <ShieldCheck className="h-4 w-4 text-slate-400" />
            <span>Sécurité</span>
          </div>
          <div className="mt-3 text-lg font-semibold text-slate-100">
            Confirmation vocale exigée
          </div>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">
            Pour éteindre, redémarrer ou supprimer un fichier, JARVIS attend toujours que vous
            disiez « Oui ».
          </p>
        </div>
      </div>

      {/* Code source consultable */}
      <div className="rounded-xl border border-slate-800 bg-[#111827] overflow-hidden">
        <button
          type="button"
          onClick={() => setShowCode((v) => !v)}
          className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium text-slate-200 hover:bg-slate-800/40"
        >
          <span>Voir le code source (Windows / Mac / Linux)</span>
          {showCode ? (
            <ChevronUp className="h-4 w-4 text-slate-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-400" />
          )}
        </button>

        {showCode && (
          <div className="border-t border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 px-5 py-3.5">
              <div className="flex flex-wrap items-center gap-1.5">
                {files.map((f) => (
                  <button
                    key={f.filename}
                    type="button"
                    onClick={() => setSelectedFilename(f.filename)}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      selectedFile?.filename === f.filename
                        ? 'bg-slate-800 text-sky-300'
                        : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                    }`}
                  >
                    {f.filename}
                  </button>
                ))}
              </div>

              {selectedFile && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    {copied ? 'Copié' : 'Copier'}
                  </button>
                  <button
                    type="button"
                    onClick={() => triggerClientDownload(selectedFile.filename, selectedFile.content)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Télécharger
                  </button>
                </div>
              )}
            </div>

            {loadingFiles ? (
              <div className="p-6 text-sm text-slate-400">Chargement des fichiers...</div>
            ) : selectedFile ? (
              <div>
                <div className="border-b border-slate-800/70 bg-[#0E1420] px-5 py-2.5 text-xs text-slate-400">
                  <span>{selectedFile.label}</span>
                  <span aria-hidden="true" className="mx-2">
                    ·
                  </span>
                  <span>{selectedFile.platform}</span>
                  <span aria-hidden="true" className="mx-2">
                    ·
                  </span>
                  <span>{selectedFile.description}</span>
                </div>
                <pre className="max-h-[400px] overflow-auto p-5 font-mono text-xs leading-relaxed text-slate-300">
                  <code>{selectedFile.content}</code>
                </pre>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
