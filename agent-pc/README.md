# JARVIS - Assistant PC Vocal (Python 3.6 a 3.14+)

Assistant personnel vocal en francais fonctionnant sur Windows, macOS et Linux.

## Fonctionnalites
- Ecoute vocale continue avec mot d'activation (`Jarvis`) sans PyAudio ni NumPy requis (compatible Python 3.13+).
- Voix neurale francaise (`fr-FR-HenriNeural`) avec cache local des reponses frequentes.
- Ouverture directe et rapide de sites sur Chrome (YouTube, Gmail, WhatsApp, ChatGPT, Google, etc.).
- Commandes systeme confirmees par la voix (eteindre, redemarrer, veille, verrouiller, fichiers).
- Mode conversation IA via cle API Gemini (optionnelle, stockee localement dans `~/.jarvis/gemini_key.txt`).

## Installation et lancement (Windows)
1. Installez **Python 3** depuis [python.org](https://www.python.org/downloads/) (cochez *Add Python to PATH*).
2. Double-cliquez sur `lancer_jarvis.bat`.
   Les dependances (`SpeechRecognition`, `edge-tts`, `sounddevice`, `pygame`) s'installent automatiquement au premier lancement.

## Lancement manuel
```bash
pip install -r requirements.txt
python jarvis_pc.py
```
