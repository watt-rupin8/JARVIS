import {
  Content,
  FunctionDeclaration,
  GenerateContentResponse,
  GoogleGenAI,
  Part,
  ThinkingLevel,
  Type,
} from '@google/genai';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import type {
  GroundingSource,
  JarvisActionType,
  PendingPcAction,
} from '../src/types/jarvis.ts';
import {
  addCommandLog,
  addTask,
  deleteTaskByTitle,
  findAndCompleteTaskByTitle,
  getStateSnapshot,
  updatePreferences,
} from './store.ts';

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY manquante dans l’environnement serveur.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const getCurrentDatetimeDecl: FunctionDeclaration = {
  name: 'get_current_datetime',
  description: 'Retourne la date et l’heure actuelles exactes.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      timezone: {
        type: Type.STRING,
        description: 'Fuseau horaire IANA optionnel, par exemple Europe/Paris.',
      },
    },
  },
};

const getWeatherDecl: FunctionDeclaration = {
  name: 'get_weather',
  description: 'Obtient la météo en temps réel pour une ville donnée.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      city: {
        type: Type.STRING,
        description: 'Nom de la ville, par exemple Paris, Lyon, Montréal.',
      },
    },
    required: ['city'],
  },
};

const manageTasksDecl: FunctionDeclaration = {
  name: 'manage_tasks_and_notes',
  description: 'Ajoute, liste, termine ou supprime une tâche, note ou rappel personnel.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      operation: {
        type: Type.STRING,
        description: "Opération parmi: 'add', 'list', 'complete', 'delete'.",
      },
      title: {
        type: Type.STRING,
        description: 'Intitulé de la tâche, note ou rappel (ou mot-clé pour complete/delete).',
      },
      category: {
        type: Type.STRING,
        description: "Catégorie optionnelle: 'task', 'note' ou 'reminder'.",
      },
    },
    required: ['operation'],
  },
};

const updatePrefsDecl: FunctionDeclaration = {
  name: 'update_user_preferences',
  description:
    'Met à jour comment JARVIS s’adresse à l’utilisateur (par exemple son prénom au lieu de Monsieur) ou ses préférences.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      honorific: {
        type: Type.STRING,
        description: 'Titre ou prénom utilisé par JARVIS, par exemple Monsieur, Thomas, Madame.',
      },
      wakeWord: {
        type: Type.STRING,
        description: 'Mot-clé d’activation vocal.',
      },
    },
  },
};

const requestPcCommandDecl: FunctionDeclaration = {
  name: 'request_pc_command',
  description:
    "Prépare ou exécute une action système sur le PC de l'utilisateur (extinction, redémarrage, veille, verrouillage, ouvrir une application ou un site web, lister/créer/supprimer un fichier, régler le volume, infos système).",
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: {
        type: Type.STRING,
        description:
          "Type d'action: 'shutdown', 'restart', 'sleep', 'lock', 'open_app', 'open_url', 'list_files', 'create_file', 'delete_file', 'set_volume', 'system_info', 'run_command'.",
      },
      target: {
        type: Type.STRING,
        description: "Cible (nom de l'application, URL, chemin du fichier, niveau de volume, etc.).",
      },
      requires_confirmation: {
        type: Type.BOOLEAN,
        description:
          'OBLIGATOIREMENT true pour toute action sensible ou irréversible (shutdown, restart, delete_file, run_command).',
      },
      risk_summary: {
        type: Type.STRING,
        description: 'Brève description en français des risques ou conséquences avant confirmation.',
      },
    },
    required: ['action', 'requires_confirmation', 'risk_summary'],
  },
};

const WEATHER_CODES: Record<number, string> = {
  0: 'ciel dégagé',
  1: 'principalement dégagé',
  2: 'partiellement nuageux',
  3: 'couvert',
  45: 'brouillard',
  48: 'brouillard givrant',
  51: 'bruine légère',
  53: 'bruine modérée',
  61: 'pluie faible',
  63: 'pluie modérée',
  65: 'pluie forte',
  71: 'neige faible',
  73: 'neige modérée',
  80: 'averses légères',
  95: 'orage',
};

async function fetchWeather(city: string): Promise<string> {
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr`
    );
    if (!geoRes.ok) {
      return `Erreur de géolocalisation météo (${geoRes.status}).`;
    }
    const geoData = (await geoRes.json()) as {
      results?: Array<{ name: string; country?: string; latitude: number; longitude: number }>;
    };
    const place = geoData.results?.[0];
    if (!place) {
      return `Ville « ${city} » introuvable.`;
    }
    const weatherRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`
    );
    if (!weatherRes.ok) {
      return `Service météo indisponible (${weatherRes.status}).`;
    }
    const wData = (await weatherRes.json()) as {
      current?: {
        temperature_2m: number;
        apparent_temperature: number;
        relative_humidity_2m: number;
        wind_speed_10m: number;
        weather_code: number;
      };
    };
    const c = wData.current;
    if (!c) return 'Données météo indisponibles.';
    const desc = WEATHER_CODES[c.weather_code] ?? 'conditions variables';
    return `${place.name}${place.country ? ` (${place.country})` : ''} : ${c.temperature_2m}°C (ressenti ${c.apparent_temperature}°C), ${desc}, humidité ${c.relative_humidity_2m}%, vent ${c.wind_speed_10m} km/h.`;
  } catch (err) {
    return `Impossible de récupérer la météo : ${err instanceof Error ? err.message : 'erreur réseau'}.`;
  }
}

function buildSystemInstruction(honorific: string, localAgentConnected: boolean): string {
  return `Tu es JARVIS (« Just A Rather Very Intelligent System »), l’assistant personnel intelligent de ton utilisateur, installé sur son ordinateur.
Tu t’adresses à lui avec respect, en l’appelant « ${honorific} ».
Ta personnalité est polie, calme, loyale et efficace, avec une pointe d’humour sec et d’ironie élégante, jamais vulgaire ni agressive.
Tu parles en français, avec des phrases courtes, claires et naturelles, comme un majordome high-tech : tu vas droit au but, tu évites les longs discours, et tu donnes des détails seulement si on te les demande.
Tu comprends le langage naturel, même quand la demande est floue ou incomplète, et tu te souviens du contexte de la conversation pour ne pas faire répéter l’utilisateur.
Tu es proactif : tu proposes la prochaine étape logique, tu signales les risques, les erreurs ou les oublis avant qu’on te le demande.
Tu peux agir grâce à tes outils (date/heure, météo, recherche web, tâches/notes, préférences, commandes PC) et tu confirmes toujours brièvement ce que tu as fait (« C’est fait, ${honorific}. »).
RÈGLES STRICTES D'HONNÊTETÉ ET DE SÉCURITÉ :
1. Avant toute action sensible ou irréversible (éteindre ou redémarrer le PC, supprimer des fichiers, exécuter une commande système critique, envoyer un message, installer un programme, dépenser de l'argent), tu appelles l'outil \`request_pc_command\` avec \`requires_confirmation: true\` et tu demandes une confirmation explicite en signalant les risques.
2. État actuel du pont PC local : ${localAgentConnected ? "CONNECTÉ (l'agent PC résident répond sur le poste local — les actions non sensibles peuvent être lancées immédiatement et les actions sensibles attendent confirmation)." : "NON CONNECTÉ (cette session s'exécute uniquement dans le navigateur web, sans accès direct au système d'exploitation)."}
3. Tu ne prétends JAMAIS avoir fait quelque chose que tu n’as pas fait. Si le pont PC local est NON CONNECTÉ et que l'utilisateur demande d'éteindre le PC, ouvrir une application locale ou gérer des fichiers locaux, tu peux appeler \`request_pc_command\` pour enregistrer l'intention, mais tu dois dire honnêtement que le navigateur seul ne peut pas piloter l'ordinateur et proposer d'installer/lancer l'Agent PC Résident (disponible dans l'onglet « Agent PC ») afin qu'il puisse écouter en arrière-plan sans ouvrir de site.
4. Tu protèges la vie privée de l’utilisateur et tu ne partages jamais ses données.`;
}

// Mémoire conversationnelle côté serveur (par sessionId)
const sessionHistories = new Map<string, Content[]>();
let hydrogenCooldownUntil = 0;

export interface JarvisTurnRequest {
  sessionId: string;
  message: string;
  localAgentConnected: boolean;
}

export interface JarvisTurnResponse {
  reply: string;
  toolsUsed: string[];
  sources: GroundingSource[];
  pendingAction?: PendingPcAction;
}

export async function processJarvisTurn(req: JarvisTurnRequest): Promise<JarvisTurnResponse> {
  const ai = getAiClient();
  const snapshot = getStateSnapshot();
  const honorific = snapshot.preferences.honorific || 'Monsieur';

  const history = sessionHistories.get(req.sessionId) ?? [];
  const userContent: Content = {
    role: 'user',
    parts: [{ text: req.message }],
  };

  const workingContents: Content[] = [...history.slice(-16), userContent];

  const tools = [
    { googleSearch: {} },
    {
      functionDeclarations: [
        getCurrentDatetimeDecl,
        getWeatherDecl,
        manageTasksDecl,
        updatePrefsDecl,
        requestPcCommandDecl,
      ],
    },
  ];

  const toolsUsed: string[] = [];
  let pendingAction: PendingPcAction | undefined;
  const sourcesMap = new Map<string, GroundingSource>();

  const collectSources = (candidate: unknown) => {
    const c = candidate as {
      groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
      };
    };
    const chunks = c?.groundingMetadata?.groundingChunks ?? [];
    for (const ch of chunks) {
      if (ch.web?.uri) {
        sourcesMap.set(ch.web.uri, {
          uri: ch.web.uri,
          title: ch.web.title || ch.web.uri,
        });
      }
    }
  };

  let finalText = '';

  const functionOnlyTools = [
    {
      functionDeclarations: [
        getCurrentDatetimeDecl,
        getWeatherDecl,
        manageTasksDecl,
        updatePrefsDecl,
        requestPcCommandDecl,
      ],
    },
  ];

  const callModelWithFallback = async (): Promise<GenerateContentResponse> => {
    const sysInst = buildSystemInstruction(honorific, req.localAgentConnected);
    if (Date.now() < hydrogenCooldownUntil) {
      return await ai.models.generateContent({
        model: 'gemini-3.1-flash-lite',
        contents: workingContents,
        config: {
          systemInstruction: sysInst,
          tools: functionOnlyTools,
        },
      });
    }
    try {
      return await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: workingContents,
        config: {
          systemInstruction: sysInst,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          tools,
          toolConfig: { includeServerSideToolInvocations: true },
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isQuotaOrBadReq =
        msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('400');
      const isTransient = msg.includes('503') || msg.includes('UNAVAILABLE');
      if (isQuotaOrBadReq || isTransient) {
        if (isQuotaOrBadReq) {
          hydrogenCooldownUntil = Date.now() + 5 * 60_000;
        }
        // Repli sur gemini-3.1-flash-lite sans googleSearch
        return await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: workingContents,
          config: {
            systemInstruction: sysInst,
            tools: functionOnlyTools,
          },
        });
      }
      throw err;
    }
  };

  // Boucle de function calling (max 4 tours)
  for (let step = 0; step < 4; step++) {
    const response = await callModelWithFallback();

    const candidate = response.candidates?.[0];
    collectSources(candidate);

    const modelContent = candidate?.content;
    if (modelContent) {
      workingContents.push(modelContent);
    }

    const calls = response.functionCalls;
    if (!calls || calls.length === 0) {
      finalText = (response.text ?? '').trim();
      break;
    }

    const responseParts: Part[] = [];

    for (const fc of calls) {
      const args = (fc.args ?? {}) as Record<string, unknown>;
      toolsUsed.push(fc.name ?? 'tool');
      let toolResult: Record<string, unknown> = {};

      if (fc.name === 'get_current_datetime') {
        const tz = typeof args.timezone === 'string' && args.timezone ? args.timezone : 'Europe/Paris';
        try {
          const formatted = new Intl.DateTimeFormat('fr-FR', {
            dateStyle: 'full',
            timeStyle: 'medium',
            timeZone: tz,
          }).format(new Date());
          toolResult = { datetime: formatted, timezone: tz };
        } catch {
          toolResult = { datetime: new Date().toLocaleString('fr-FR'), timezone: 'local' };
        }
      } else if (fc.name === 'get_weather') {
        const city = typeof args.city === 'string' && args.city ? args.city : 'Paris';
        const weatherText = await fetchWeather(city);
        toolResult = { report: weatherText };
      } else if (fc.name === 'manage_tasks_and_notes') {
        const op = String(args.operation ?? 'list');
        const title = typeof args.title === 'string' ? args.title : '';
        const cat =
          args.category === 'note' || args.category === 'reminder' ? args.category : 'task';

        if (op === 'add' && title) {
          const item = addTask(title, cat);
          toolResult = { ok: true, added: item };
        } else if (op === 'complete' && title) {
          const item = findAndCompleteTaskByTitle(title);
          toolResult = item
            ? { ok: true, completed: item }
            : { ok: false, error: 'Aucune tâche correspondante trouvée.' };
        } else if (op === 'delete' && title) {
          const item = deleteTaskByTitle(title);
          toolResult = item
            ? { ok: true, deleted: item }
            : { ok: false, error: 'Élément introuvable.' };
        } else {
          const current = getStateSnapshot().tasks;
          toolResult = { ok: true, items: current };
        }
      } else if (fc.name === 'update_user_preferences') {
        const updated = updatePreferences({
          ...(typeof args.honorific === 'string' && args.honorific.trim()
            ? { honorific: args.honorific.trim() }
            : {}),
          ...(typeof args.wakeWord === 'string' && args.wakeWord.trim()
            ? { wakeWord: args.wakeWord.trim() }
            : {}),
        });
        toolResult = { ok: true, preferences: updated };
      } else if (fc.name === 'request_pc_command') {
        const action = (String(args.action ?? 'system_info') as JarvisActionType);
        const target = typeof args.target === 'string' ? args.target : '';
        const sensitive =
          Boolean(args.requires_confirmation) ||
          ['shutdown', 'restart', 'delete_file', 'run_command'].includes(action);
        const riskSummary =
          typeof args.risk_summary === 'string' && args.risk_summary
            ? args.risk_summary
            : sensitive
            ? 'Cette action est sensible ou irréversible sur le poste.'
            : 'Action système locale.';

        if (!req.localAgentConnected) {
          pendingAction = {
            id: `act-${Date.now()}`,
            action,
            target,
            requiresConfirmation: sensitive,
            riskSummary,
            status: 'bridge_unavailable',
            resultMessage:
              "Agent PC local non connecté : impossible d'exécuter une commande OS depuis le navigateur seul.",
            createdAt: new Date().toISOString(),
          };
          addCommandLog({
            action,
            target: target || '—',
            status: 'blocked_no_agent',
            detail: 'Agent PC résident non détecté sur 127.0.0.1:7474',
          });
          toolResult = {
            executed: false,
            reason:
              "L'agent PC résident n'est pas connecté à ce navigateur. Ne prétends pas avoir exécuté l'action ; explique honnêtement la limite du navigateur et propose d'installer l'Agent PC Résident dans l'onglet dédié.",
          };
        } else if (sensitive) {
          pendingAction = {
            id: `act-${Date.now()}`,
            action,
            target,
            requiresConfirmation: true,
            riskSummary,
            status: 'pending_confirmation',
            createdAt: new Date().toISOString(),
          };
          addCommandLog({
            action,
            target: target || '—',
            status: 'pending',
            detail: `En attente de confirmation : ${riskSummary}`,
          });
          toolResult = {
            executed: false,
            awaiting_confirmation: true,
            instruction:
              'Demande une confirmation explicite à l’utilisateur avant exécution et rappelle brièvement le risque.',
          };
        } else {
          pendingAction = {
            id: `act-${Date.now()}`,
            action,
            target,
            requiresConfirmation: false,
            riskSummary,
            status: 'ready_to_execute',
            createdAt: new Date().toISOString(),
          };
          toolResult = {
            ready_for_local_bridge: true,
            action,
            target,
            instruction:
              "Indique brièvement que tu lances l'action demandée sur le poste local (elle est transmise au pont local).",
          };
        }
      }

      responseParts.push({
        functionResponse: {
          id: fc.id,
          name: fc.name ?? 'tool',
          response: toolResult,
        },
      });
    }

    workingContents.push({
      role: 'user',
      parts: responseParts,
    });
  }

  // Enregistre uniquement les tours texte propres pour éviter de gonfler le contexte
  const updatedHistory: Content[] = [
    ...history.slice(-14),
    userContent,
    {
      role: 'model',
      parts: [{ text: finalText || `À votre service, ${honorific}.` }],
    },
  ];
  sessionHistories.set(req.sessionId, updatedHistory);

  return {
    reply: finalText || `À votre service, ${honorific}.`,
    toolsUsed: Array.from(new Set(toolsUsed)),
    sources: Array.from(sourcesMap.values()),
    pendingAction,
  };
}

export function clearSessionMemory(sessionId: string): void {
  sessionHistories.delete(sessionId);
}

export async function synthesizeJarvisSpeech(
  text: string,
  voiceName = 'fr-FR-HenriNeural'
): Promise<Buffer> {
  const cleanText = text
    .trim()
    .slice(0, 1200)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  if (!cleanText) {
    throw new Error('Texte vide pour la synthèse vocale.');
  }

  const tts = new MsEdgeTTS();
  await tts.setMetadata(voiceName, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = await tts.toStream(cleanText, {
    rate: '-5%',
    pitch: '-8Hz',
  });

  return await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    audioStream.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    audioStream.on('end', () => {
      try {
        tts.close();
      } catch {
        // ignore
      }
      resolve(Buffer.concat(chunks));
    });
    audioStream.on('error', (err: Error) => {
      try {
        tts.close();
      } catch {
        // ignore
      }
      reject(err);
    });
  });
}

