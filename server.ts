import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  clearSessionMemory,
  processJarvisTurn,
  synthesizeJarvisSpeech,
} from './server/jarvisBrain.ts';
import { getAgentFileByName, getAgentFiles } from './server/pcAgentGenerator.ts';
import {
  addCommandLog,
  addTask,
  deleteTask,
  getStateSnapshot,
  toggleTask,
  updatePreferences,
} from './server/store.ts';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '1mb' }));

  // Etat global (préférences, tâches, journal des commandes)
  app.get('/api/state', (_req, res) => {
    res.json(getStateSnapshot());
  });

  app.patch('/api/preferences', (req, res) => {
    const updated = updatePreferences(req.body ?? {});
    res.json(updated);
  });

  app.post('/api/tasks', (req, res) => {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const category =
      req.body?.category === 'note' || req.body?.category === 'reminder'
        ? req.body.category
        : 'task';
    if (!title) {
      res.status(400).json({ error: 'Intitulé requis.' });
      return;
    }
    const created = addTask(title, category);
    res.status(201).json(created);
  });

  app.patch('/api/tasks/:id', (req, res) => {
    const updated = toggleTask(req.params.id, req.body?.completed);
    if (!updated) {
      res.status(404).json({ error: 'Tâche introuvable.' });
      return;
    }
    res.json(updated);
  });

  app.delete('/api/tasks/:id', (req, res) => {
    const ok = deleteTask(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Tâche introuvable.' });
      return;
    }
    res.json({ ok: true });
  });

  // Conversation JARVIS via Gemini
  app.post('/api/jarvis/chat', async (req, res) => {
    try {
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      const sessionId =
        typeof req.body?.sessionId === 'string' && req.body.sessionId
          ? req.body.sessionId
          : 'default';
      const localAgentConnected = Boolean(req.body?.localAgentConnected);

      if (!message) {
        res.status(400).json({ error: 'Message vide.' });
        return;
      }

      const result = await processJarvisTurn({
        sessionId,
        message,
        localAgentConnected,
      });

      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur serveur inconnue';
      console.error('[/api/jarvis/chat] Error:', msg);
      const isQuota = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
      res.status(isQuota ? 429 : 500).json({
        error: msg,
        reply: isQuota
          ? "Monsieur, le quota de la clé API Gemini est actuellement épuisé (erreur 429). Vous pouvez vérifier votre limite ou sélectionner une clé API avec facturation activée dans Settings > Secrets."
          : "Je rencontre une difficulté technique pour joindre mon module de raisonnement, Monsieur. Veuillez vérifier la configuration de la clé API.",
      });
    }
  });

  app.post('/api/jarvis/tts', async (req, res) => {
    try {
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
      const voice =
        typeof req.body?.voice === 'string' && req.body.voice.includes('Neural')
          ? req.body.voice
          : 'fr-FR-HenriNeural';

      if (!text) {
        res.status(400).json({ error: 'Texte requis.' });
        return;
      }

      const mp3Buffer = await synthesizeJarvisSpeech(text, voice);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'no-store');
      res.send(mp3Buffer);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur synthèse vocale';
      console.error('[/api/jarvis/tts] Error:', msg);
      res.status(500).json({ error: msg });
    }
  });

  app.get('/api/jarvis/health', (_req, res) => {
    res.json({
      ok: true,
      hasServerKey: Boolean(process.env.GEMINI_API_KEY),
      endpoints: ['/api/jarvis/chat', '/api/jarvis/tts'],
    });
  });

  app.post('/api/jarvis/reset', (req, res) => {
    const sessionId =
      typeof req.body?.sessionId === 'string' && req.body.sessionId
        ? req.body.sessionId
        : 'default';
    clearSessionMemory(sessionId);
    res.json({ ok: true });
  });

  app.post('/api/jarvis/command-log', (req, res) => {
    const action = typeof req.body?.action === 'string' ? req.body.action : 'system';
    const target = typeof req.body?.target === 'string' ? req.body.target : '—';
    const status =
      req.body?.status === 'executed' ||
      req.body?.status === 'cancelled' ||
      req.body?.status === 'blocked_no_agent'
        ? req.body.status
        : 'pending';
    const detail = typeof req.body?.detail === 'string' ? req.body.detail : '';
    const entry = addCommandLog({ action, target, status, detail });
    res.status(201).json(entry);
  });

  // Fichiers téléchargeables de l'Agent PC Résident
  app.get('/api/agent/files', (_req, res) => {
    res.json({ files: getAgentFiles() });
  });

  app.get('/api/agent/download/:filename', (req, res) => {
    const file = getAgentFileByName(req.params.filename);
    if (!file) {
      res.status(404).json({ error: 'Fichier introuvable.' });
      return;
    }
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(file.content);
  });

  app.get('/api/project/export', (_req, res) => {
    try {
      const rootDir = process.cwd();
      const collected: Array<{ name: string; content: string }> = [];

      const rootFiles = [
        'index.html',
        'metadata.json',
        'package.json',
        'package-lock.json',
        'server.ts',
        'tsconfig.json',
        'vite.config.ts',
        '.env.example',
      ];
      for (const rel of rootFiles) {
        const abs = path.join(rootDir, rel);
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          collected.push({ name: rel, content: fs.readFileSync(abs, 'utf-8') });
        }
      }

      const walkDir = (subDir: string) => {
        const absDir = path.join(rootDir, subDir);
        if (!fs.existsSync(absDir)) return;
        for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
          const relPath = `${subDir}/${entry.name}`;
          if (entry.isDirectory()) {
            if (['node_modules', 'dist', '.git', 'data', 'assets'].includes(entry.name)) continue;
            walkDir(relPath);
          } else if (entry.isFile()) {
            if (/\.(ts|tsx|css|html|json|md|txt|py|bat|sh)$/i.test(entry.name)) {
              collected.push({
                name: relPath,
                content: fs.readFileSync(path.join(rootDir, relPath), 'utf-8'),
              });
            }
          }
        }
      };

      walkDir('src');
      walkDir('server');

      for (const agentFile of getAgentFiles()) {
        collected.push({
          name: `agent-pc/${agentFile.filename}`,
          content: agentFile.content,
        });
      }

      collected.push({
        name: '.gitignore',
        content: `node_modules/\ndist/\ndata/\n.env\n.env.local\n__pycache__/\n*.pyc\n.jarvis/\ngemini_key.txt\n`,
      });

      res.json({ files: collected });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur export projet';
      res.status(500).json({ error: msg });
    }
  });

  // Vite middleware en dev ou fichiers statiques en prod
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build manquant. Exécutez npm run build.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur JARVIS actif sur http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Échec du démarrage du serveur:', err);
  process.exit(1);
});
