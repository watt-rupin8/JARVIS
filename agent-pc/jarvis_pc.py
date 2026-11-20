#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
JARVIS - Assistant PC Vocal Resident
Compatible avec toutes les versions de Python (3.6 a 3.14+).
"""

import os
import sys
import json
import time
import math
import array
import ctypes
import hashlib
import asyncio
import tempfile
import platform
import traceback
import subprocess
import threading
import webbrowser
import urllib.request
import urllib.parse
import urllib.error
import http.client
from collections import deque
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer

WAKE_WORD = os.environ.get("JARVIS_WAKE_WORD", "jarvis").lower()
HONORIFIC = os.environ.get("JARVIS_HONORIFIC", "Monsieur")
VOICE_EDGE = os.environ.get("JARVIS_VOICE", "fr-FR-HenriNeural")
LOCAL_BRIDGE_PORT = int(os.environ.get("JARVIS_PORT", "7474"))
CONFIG_DIR = os.path.join(os.path.expanduser("~"), ".jarvis")
KEY_FILE = os.path.join(CONFIG_DIR, "gemini_key.txt")
DEPS_CACHE_FILE = os.path.join(CONFIG_DIR, "deps_cache.json")
TTS_CACHE_DIR = os.path.join(CONFIG_DIR, "tts_cache")


def _load_failed_deps():
    try:
        if os.path.exists(DEPS_CACHE_FILE):
            with open(DEPS_CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if data.get("py") == platform.python_version():
                return set(data.get("failed", []))
    except Exception:
        pass
    return set()


def _save_failed_deps(failed_set):
    try:
        os.makedirs(CONFIG_DIR, exist_ok=True)
        with open(DEPS_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump({"py": platform.python_version(), "failed": sorted(failed_set)}, f)
    except Exception:
        pass


_FAILED_DEPS = _load_failed_deps()


def ensure_package(import_name, pip_name):
    try:
        __import__(import_name)
        return True
    except ImportError:
        if pip_name in _FAILED_DEPS:
            return False
        print(f"[Installation] Telechargement de {pip_name}...")
        try:
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "--upgrade", pip_name],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            __import__(import_name)
            return True
        except Exception:
            _FAILED_DEPS.add(pip_name)
            _save_failed_deps(_FAILED_DEPS)
            return False


print("=================================================")
print("  JARVIS - Initialisation de l'assistant PC")
print(f"  Python {platform.python_version()} ({platform.system()})")
print("=================================================")

HAS_SR = ensure_package("speech_recognition", "SpeechRecognition")
HAS_EDGE_TTS = ensure_package("edge_tts", "edge-tts")
HAS_PYAUDIO = ensure_package("pyaudio", "pyaudio")
HAS_SOUNDDEVICE = False if HAS_PYAUDIO else ensure_package("sounddevice", "sounddevice")
HAS_PYGAME = ensure_package("pygame", "pygame")
HAS_PYTTSX3 = False if HAS_EDGE_TTS else ensure_package("pyttsx3", "pyttsx3")

if HAS_SR:
    import speech_recognition as sr
else:
    sr = None

if HAS_EDGE_TTS:
    import edge_tts

if HAS_PYGAME:
    import pygame

if HAS_SOUNDDEVICE:
    import sounddevice as sd

if HAS_PYTTSX3:
    import pyttsx3


def get_api_key():
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if key:
        return key
    if os.path.exists(KEY_FILE):
        with open(KEY_FILE, "r", encoding="utf-8") as f:
            return f.read().strip()
    return ""


def play_mp3_windows_native(mp3_path):
    """Lit un MP3 sur Windows via winmm.dll sans aucune dependance externe."""
    winmm = ctypes.windll.winmm
    alias = "jarvis_tts_audio"
    winmm.mciSendStringW(f"close {alias}", None, 0, None)
    rc = winmm.mciSendStringW(f'open "{mp3_path}" type mpegvideo alias {alias}', None, 0, None)
    if rc != 0:
        return False
    winmm.mciSendStringW(f"play {alias} wait", None, 0, None)
    winmm.mciSendStringW(f"close {alias}", None, 0, None)
    return True


_TTS_LOOP = None


def _play_mp3(mp3_path):
    if HAS_PYGAME:
        try:
            if not pygame.mixer.get_init():
                pygame.mixer.init()
            pygame.mixer.music.load(mp3_path)
            pygame.mixer.music.play()
            while pygame.mixer.music.get_busy():
                pygame.time.wait(20)
            pygame.mixer.music.unload()
            return True
        except Exception:
            pass
    if platform.system() == "Windows":
        return play_mp3_windows_native(mp3_path)
    if platform.system() == "Darwin":
        subprocess.run(["afplay", mp3_path], check=False)
        return True
    return False


def speak(text):
    """Voix neurale fr-FR-HenriNeural avec cache MP3 pour reponses instantanees."""
    global _TTS_LOOP
    print(f"\n[JARVIS] {text}")
    if HAS_EDGE_TTS:
        try:
            mp3_path = None
            if len(text) <= 140:
                os.makedirs(TTS_CACHE_DIR, exist_ok=True)
                key_hash = hashlib.sha1(f"{VOICE_EDGE}:{text}".encode("utf-8")).hexdigest()
                cached_path = os.path.join(TTS_CACHE_DIR, f"{key_hash}.mp3")
                if os.path.exists(cached_path) and os.path.getsize(cached_path) > 512:
                    mp3_path = cached_path

            if not mp3_path:
                target_path = cached_path if len(text) <= 140 else os.path.join(tempfile.gettempdir(), "jarvis_speech.mp3")
                if _TTS_LOOP is None or _TTS_LOOP.is_closed():
                    _TTS_LOOP = asyncio.new_event_loop()

                async def _synth():
                    await edge_tts.Communicate(text, VOICE_EDGE, rate="-5%", pitch="-8Hz").save(target_path)

                _TTS_LOOP.run_until_complete(asyncio.wait_for(_synth(), timeout=6.0))
                mp3_path = target_path

            if _play_mp3(mp3_path):
                return
        except Exception:
            pass

    if HAS_PYTTSX3:
        try:
            engine = pyttsx3.init()
            engine.setProperty("rate", 172)
            engine.say(text)
            engine.runAndWait()
            return
        except Exception:
            pass

    system = platform.system()
    if system == "Windows":
        safe = text.replace("'", "''").replace('"', " ")
        ps_cmd = (
            "Add-Type -AssemblyName System.Speech; "
            "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
            f"$s.Speak('{safe}')"
        )
        subprocess.run(["powershell", "-NoProfile", "-Command", ps_cmd], check=False)
    elif system == "Darwin":
        subprocess.run(["say", "-v", "Thomas", text], check=False)
    else:
        subprocess.run(["espeak", "-v", "fr", text], check=False)


def execute_os_action(action, target=""):
    """Execute reellement les commandes sur le PC."""
    system = platform.system()
    t = (target or "").strip()

    try:
        if action == "shutdown":
            if system == "Windows":
                subprocess.Popen(["shutdown", "/s", "/t", "5"])
            elif system == "Darwin":
                subprocess.Popen(["osascript", "-e", 'tell app "System Events" to shut down'])
            else:
                subprocess.Popen(["shutdown", "-h", "now"])
            return {"ok": True, "message": f"Extinction de l'ordinateur lancee, {HONORIFIC}."}

        if action == "restart":
            if system == "Windows":
                subprocess.Popen(["shutdown", "/r", "/t", "5"])
            elif system == "Darwin":
                subprocess.Popen(["osascript", "-e", 'tell app "System Events" to restart'])
            else:
                subprocess.Popen(["reboot"])
            return {"ok": True, "message": f"Redemarrage lance, {HONORIFIC}."}

        if action == "sleep":
            if system == "Windows":
                subprocess.Popen(["rundll32.exe", "powrprof.dll,SetSuspendState", "0,1,0"])
            elif system == "Darwin":
                subprocess.Popen(["pmset", "sleepnow"])
            else:
                subprocess.Popen(["systemctl", "suspend"])
            return {"ok": True, "message": f"Mise en veille effectuee, {HONORIFIC}."}

        if action == "lock":
            if system == "Windows":
                subprocess.Popen(["rundll32.exe", "user32.dll,LockWorkStation"])
            elif system == "Darwin":
                subprocess.Popen(["pmset", "displaysleepnow"])
            else:
                subprocess.Popen(["loginctl", "lock-session"])
            return {"ok": True, "message": f"Session verrouillee, {HONORIFIC}."}

        if action == "open_url":
            browser = ""
            url_part = t
            if "|" in t and t.split("|", 1)[0] in ("chrome", "edge", "firefox"):
                browser, url_part = t.split("|", 1)
            url = url_part if url_part.startswith("http") else f"https://{url_part}"
            if browser == "chrome" and system == "Windows":
                subprocess.Popen(f'start "" chrome "{url}"', shell=True)
            elif browser == "chrome" and system == "Darwin":
                subprocess.Popen(["open", "-a", "Google Chrome", url])
            elif system == "Windows":
                os.startfile(url)
            else:
                webbrowser.open(url)
            return {"ok": True, "message": f"C'est ouvert, {HONORIFIC}."}

        if action == "open_app":
            app_low = t.lower().strip()
            if app_low in SITE_URLS:
                url = SITE_URLS[app_low]
                if system == "Windows":
                    os.startfile(url)
                else:
                    webbrowser.open(url)
                return {"ok": True, "message": f"C'est ouvert, {HONORIFIC}."}
            app_map_win = {
                "chrome": "chrome",
                "google chrome": "chrome",
                "edge": "msedge",
                "firefox": "firefox",
                "explorateur": "explorer",
                "fichiers": "explorer",
                "bloc-notes": "notepad",
                "notepad": "notepad",
                "calculatrice": "calc",
                "paint": "mspaint",
                "terminal": "wt",
                "cmd": "cmd",
                "powershell": "powershell",
                "spotify": "spotify",
                "discord": "discord",
                "code": "code",
                "vscode": "code",
            }
            if system == "Windows":
                cmd = app_map_win.get(app_low, t)
                subprocess.Popen(f'start "" "{cmd}"', shell=True)
            elif system == "Darwin":
                subprocess.Popen(["open", "-a", t])
            else:
                subprocess.Popen([app_low])
            return {"ok": True, "message": f"C'est fait, {HONORIFIC}."}

        if action == "list_files":
            folder = os.path.expanduser(t) if t else os.path.expanduser("~/Desktop")
            if not os.path.exists(folder):
                return {"ok": False, "message": f"Dossier introuvable : {folder}"}
            entries = sorted(os.listdir(folder))[:20]
            return {"ok": True, "message": f"{len(entries)} elements dans {folder} : " + ", ".join(entries)}

        if action == "create_file":
            path = os.path.expanduser(t) if os.path.isabs(os.path.expanduser(t)) else os.path.join(os.path.expanduser("~/Desktop"), t)
            with open(path, "w", encoding="utf-8") as f:
                f.write("")
            return {"ok": True, "message": f"Fichier cree : {path}, {HONORIFIC}."}

        if action == "delete_file":
            path = os.path.expanduser(t)
            if not os.path.exists(path):
                return {"ok": False, "message": f"Le fichier {path} n'existe pas, {HONORIFIC}."}
            os.remove(path)
            return {"ok": True, "message": f"Fichier supprime : {path}, {HONORIFIC}."}

        if action == "system_info":
            return {
                "ok": True,
                "message": f"Systeme {platform.system()} {platform.release()} sur {platform.node()}, {HONORIFIC}."
            }

        return {"ok": False, "message": f"Action '{action}' non prise en charge, {HONORIFIC}."}
    except Exception as exc:
        return {"ok": False, "message": f"Erreur lors de l'execution : {exc}"}


def fetch_weather_fr(city):
    try:
        geo_url = f"https://geocoding-api.open-meteo.com/v1/search?name={urllib.parse.quote(city)}&count=1&language=fr"
        with urllib.request.urlopen(geo_url, timeout=6) as r:
            geo = json.loads(r.read().decode("utf-8"))
        if not geo.get("results"):
            return f"Ville '{city}' introuvable."
        place = geo["results"][0]
        w_url = (
            f"https://api.open-meteo.com/v1/forecast?latitude={place['latitude']}&longitude={place['longitude']}"
            f"&current=temperature_2m,apparent_temperature,wind_speed_10m&timezone=auto"
        )
        with urllib.request.urlopen(w_url, timeout=6) as r:
            w = json.loads(r.read().decode("utf-8"))
        cur = w.get("current", {})
        return f"{place['name']} : {cur.get('temperature_2m')}°C (ressenti {cur.get('apparent_temperature')}°C), vent {cur.get('wind_speed_10m')} km/h."
    except Exception as e:
        return f"Impossible d'obtenir la meteo : {e}"


_WORKING_GEMINI_URL = None
_HTTPS_CONNS = {}


def _post_json_keepalive(url, body_bytes, timeout=10):
    parsed = urllib.parse.urlsplit(url)
    host = parsed.netloc
    path = parsed.path + (f"?{parsed.query}" if parsed.query else "")
    headers = {"Content-Type": "application/json", "Connection": "keep-alive"}
    for attempt in range(2):
        conn = _HTTPS_CONNS.get(host)
        if conn is None:
            conn = http.client.HTTPSConnection(host, timeout=timeout)
            _HTTPS_CONNS[host] = conn
        try:
            conn.request("POST", path, body=body_bytes, headers=headers)
            resp = conn.getresponse()
            raw = resp.read().decode("utf-8", errors="ignore")
            if resp.status >= 400:
                detail = raw
                try:
                    detail = json.loads(raw).get("error", {}).get("message", raw)
                except Exception:
                    pass
                return resp.status, None, detail
            return resp.status, json.loads(raw), ""
        except Exception:
            try:
                conn.close()
            except Exception:
                pass
            _HTTPS_CONNS.pop(host, None)
            if attempt == 1:
                raise


def call_gemini_rest(api_key, history):
    """Appel REST ultra-rapide avec connexion HTTPS persistante et cache d'endpoint."""
    global _WORKING_GEMINI_URL
    system_text = (
        f"Tu es JARVIS, l'assistant personnel intelligent installe sur le PC de {HONORIFIC}. "
        f"Personnalite : poli, calme, loyal, efficace, avec une pointe d'humour sec. "
        f"Reponds en francais en 1 ou 2 phrases tres courtes et directes. "
        f"Si l'utilisateur demande une action PC, reponds uniquement au format JSON : "
        f'{{"tool": "pc_action", "action": "...", "target": "...", "confirm": true/false, "reply": "..."}}. '
        f"Actions possibles : shutdown, restart, sleep, lock, open_app, open_url, list_files, create_file, delete_file. "
        f"Mets confirm=true pour shutdown, restart, delete_file. Sinon reponds en texte naturel."
    )
    qkey = urllib.parse.quote(api_key)
    if api_key.startswith("AQ."):
        urls = [
            f"https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.1-flash-lite:generateContent?key={qkey}",
            f"https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.8-flash:generateContent?key={qkey}",
            f"https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-4-hydrogen:generateContent?key={qkey}",
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key={qkey}",
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key={qkey}",
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent?key={qkey}",
        ]
    else:
        urls = [
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key={qkey}",
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key={qkey}",
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent?key={qkey}",
        ]

    if _WORKING_GEMINI_URL and _WORKING_GEMINI_URL in urls:
        urls = [_WORKING_GEMINI_URL] + [u for u in urls if u != _WORKING_GEMINI_URL]

    last_err = None
    for url in urls:
        payload = {
            "system_instruction": {"parts": [{"text": system_text}]},
            "contents": history,
        }
        if "gemini-4-hydrogen" in url or "gemini-3.8-flash" in url:
            payload["generationConfig"] = {"thinkingConfig": {"thinkingLevel": "LOW"}}
        data = json.dumps(payload).encode("utf-8")
        try:
            status, res, detail = _post_json_keepalive(url, data, timeout=10)
            if status == 400 and "generationConfig" in payload and "thinking" in detail.lower():
                del payload["generationConfig"]
                status, res, detail = _post_json_keepalive(url, json.dumps(payload).encode("utf-8"), timeout=10)
            if status >= 400 or res is None:
                last_err = RuntimeError(f"HTTP {status}: {detail}")
                continue
            _WORKING_GEMINI_URL = url
            parts = res.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            return "".join(p.get("text", "") for p in parts).strip()
        except Exception as exc:
            last_err = exc
    raise last_err


SITE_URLS = {
    "youtube": "https://www.youtube.com",
    "gmail": "https://mail.google.com",
    "mail": "https://mail.google.com",
    "boite mail": "https://mail.google.com",
    "boîte mail": "https://mail.google.com",
    "messagerie": "https://mail.google.com",
    "google": "https://www.google.com",
    "facebook": "https://www.facebook.com",
    "instagram": "https://www.instagram.com",
    "insta": "https://www.instagram.com",
    "whatsapp": "https://web.whatsapp.com",
    "tiktok": "https://www.tiktok.com",
    "netflix": "https://www.netflix.com",
    "twitch": "https://www.twitch.tv",
    "twitter": "https://x.com",
    "x": "https://x.com",
    "linkedin": "https://www.linkedin.com",
    "github": "https://github.com",
    "chatgpt": "https://chatgpt.com",
    "claude": "https://claude.ai",
    "gemini": "https://gemini.google.com",
    "ai studio": "https://aistudio.google.com",
    "aistudio": "https://aistudio.google.com",
    "drive": "https://drive.google.com",
    "google drive": "https://drive.google.com",
    "maps": "https://maps.google.com",
    "google maps": "https://maps.google.com",
    "traduction": "https://translate.google.com",
    "google traduction": "https://translate.google.com",
    "translate": "https://translate.google.com",
    "amazon": "https://www.amazon.fr",
    "wikipedia": "https://fr.wikipedia.org",
    "wikipédia": "https://fr.wikipedia.org",
    "outlook": "https://outlook.live.com",
    "canva": "https://www.canva.com",
    "disney plus": "https://www.disneyplus.com",
    "prime video": "https://www.primevideo.com",
    "spotify web": "https://open.spotify.com",
    "deezer": "https://www.deezer.com",
    "soundcloud": "https://soundcloud.com",
    "reddit": "https://www.reddit.com",
    "pinterest": "https://www.pinterest.fr",
    "leboncoin": "https://www.leboncoin.fr",
    "vinted": "https://www.vinted.fr",
    "sncf": "https://www.sncf-connect.com",
    "doctolib": "https://www.doctolib.fr",
    "notion": "https://www.notion.so",
    "figma": "https://www.figma.com",
    "crunchyroll": "https://www.crunchyroll.com",
    "allocine": "https://www.allocine.fr",
    "allociné": "https://www.allocine.fr",
    "yahoo": "https://fr.yahoo.com",
    "bing": "https://www.bing.com",
    "imdb": "https://www.imdb.com",
}

DESKTOP_APPS = {
    "chrome", "google chrome", "edge", "firefox", "explorateur", "fichiers",
    "bloc-notes", "notepad", "calculatrice", "paint", "terminal", "cmd",
    "powershell", "spotify", "discord", "code", "vscode", "word", "excel",
    "powerpoint", "steam", "vlc", "obs",
}


def parse_local_commands(text):
    raw = text.strip()
    t = raw.lower()
    for polite in [
        "s'il te plait", "s'il te plaît", "svp", "stp",
        "est-ce que tu peux ", "peux-tu ", "tu peux ", "pourrais-tu ",
        "je veux que tu ", "j'aimerais que tu ", "vas-y ",
        "pour moi", "maintenant", "rapidement", "vite",
    ]:
        t = t.replace(polite, " ").strip()
    t = " ".join(t.split())

    if any(k in t for k in ["eteins le pc", "éteins le pc", "ferme le pc", "eteindre le pc", "éteindre le pc", "éteins l'ordinateur", "eteins l'ordinateur"]):
        return ("confirm", "shutdown", "", f"Confirmez-vous l'extinction de l'ordinateur, {HONORIFIC} ? Dites oui ou non.")
    if any(k in t for k in ["redemarre", "redémarre"]):
        return ("confirm", "restart", "", f"Confirmez-vous le redemarrage de l'ordinateur, {HONORIFIC} ?")
    if "veille" in t:
        return ("exec", "sleep", "", "")
    if "verrouille" in t:
        return ("exec", "lock", "", "")
    if "quelle heure" in t or "quel jour" in t:
        now = datetime.now().strftime("%d/%m/%Y a %H heures %M")
        return ("say", "", "", f"Nous sommes le {now}, {HONORIFIC}.")
    if t.startswith("meteo ") or t.startswith("météo "):
        city = t[6:].replace("a ", "").replace("à ", "").strip() or "Paris"
        return ("say", "", "", fetch_weather_fr(city))

    chrome_markers = [
        "dans mon chrome", "sur mon chrome", "dans google chrome", "sur google chrome",
        "dans chrome", "sur chrome", "avec chrome",
    ]
    use_chrome = any(b in t for b in chrome_markers)
    for m in chrome_markers:
        if t.startswith(m + " ") or t.startswith(m + ", "):
            t = t[len(m):].lstrip(" ,")

    if "sur youtube" in t and (t.startswith("cherche ") or t.startswith("recherche ") or t.startswith("mets ") or t.startswith("trouve ") or t.startswith("regarde ")):
        q = t.split(" ", 1)[1].replace("sur youtube", "").strip()
        for m in chrome_markers:
            q = q.replace(m, "").strip()
        url = "https://www.youtube.com/results?search_query=" + urllib.parse.quote(q)
        return ("exec", "open_url", f"chrome|{url}" if use_chrome else url, "")

    if t.startswith("cherche ") or t.startswith("recherche "):
        q = t.split(" ", 1)[1].strip()
        for m in chrome_markers:
            q = q.replace(m, "").strip()
        url = "https://www.google.com/search?q=" + urllib.parse.quote(q)
        return ("exec", "open_url", f"chrome|{url}" if use_chrome else url, "")

    open_prefixes = [
        "ouvre-moi ", "ouvre moi ", "ouvre ", "m'ouvrir ", "ouvrir ",
        "va sur ", "aller sur ", "lance ", "lancer ", "mets-moi ", "mets ",
        "affiche-moi ", "affiche ", "montre-moi ", "montre ", "demarre ", "démarre ",
    ]
    for pref in open_prefixes:
        if t.startswith(pref):
            target = t[len(pref):].strip(" .!?")
            for suffix in chrome_markers + [" sur internet", " dans le navigateur", " sur le navigateur"]:
                if target.endswith(suffix):
                    target = target[:-len(suffix)].strip()
                    use_chrome = True
            changed = True
            while changed:
                changed = False
                for filler in ["le site de ", "la page de ", "le site ", "la page ", "un onglet ", "l'onglet ", "site ", "page ", "mon ", "ma ", "le ", "la ", "l'", "un ", "une "]:
                    if target.startswith(filler):
                        target = target[len(filler):].strip()
                        changed = True
                        break
            if target in SITE_URLS:
                url = SITE_URLS[target]
                return ("exec", "open_url", f"chrome|{url}" if use_chrome else url, "")
            if "." in target and " " not in target:
                return ("exec", "open_url", f"chrome|{target}" if use_chrome else target, "")
            if use_chrome and target and target not in DESKTOP_APPS:
                url = "https://www.google.com/search?q=" + urllib.parse.quote(target)
                return ("exec", "open_url", f"chrome|{url}", "")
            return ("exec", "open_app", target, "")

    return None


class LocalBridgeHandler(BaseHTTPRequestHandler):
    def _send_json(self, code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self._send_json(204, {})

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {
                "connected": True,
                "platform": f"{platform.system()} {platform.release()}",
                "hostname": platform.node(),
                "version": "1.1.0",
            })
            return
        self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path == "/execute":
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length).decode("utf-8") if length > 0 else "{}"
            data = json.loads(raw)
            res = execute_os_action(data.get("action", ""), data.get("target", ""))
            self._send_json(200 if res["ok"] else 400, res)
            return
        self._send_json(404, {"error": "Not found"})

    def log_message(self, fmt, *args):
        return


def start_bridge_server():
    server = HTTPServer(("127.0.0.1", LOCAL_BRIDGE_PORT), LocalBridgeHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()


class JarvisBrain:
    def __init__(self):
        self.api_key = get_api_key()
        self.history = []
        self.pending_confirmation = None

    def handle_utterance(self, user_text):
        if self.pending_confirmation:
            low = user_text.lower()
            if any(w in low for w in ["oui", "confirme", "vas-y", "d'accord", "ok"]):
                act, tgt = self.pending_confirmation
                self.pending_confirmation = None
                return execute_os_action(act, tgt)["message"]
            if any(w in low for w in ["non", "annule", "stop", "arrete", "arrête"]):
                self.pending_confirmation = None
                return f"Action annulee, {HONORIFIC}."
            return f"Repondez par oui ou par non, {HONORIFIC}."

        local = parse_local_commands(user_text)
        if local:
            kind, act, tgt, msg = local
            if kind == "confirm":
                self.pending_confirmation = (act, tgt)
                return msg
            if kind == "exec":
                return execute_os_action(act, tgt)["message"]
            return msg

        if not self.api_key:
            return f"Commande locale non reconnue, {HONORIFIC}. Ajoutez une cle Gemini dans ~/.jarvis/gemini_key.txt pour la conversation libre."

        self.history.append({"role": "user", "parts": [{"text": user_text}]})
        self.history = self.history[-12:]
        try:
            reply = call_gemini_rest(self.api_key, self.history)
            cleaned = reply.strip()
            if cleaned.startswith("```"):
                lines = cleaned.splitlines()
                if len(lines) >= 3:
                    cleaned = "\n".join(lines[1:-1]).strip()
            if cleaned.startswith("{") and '"pc_action"' in cleaned:
                obj = json.loads(cleaned)
                act = obj.get("action", "")
                tgt = obj.get("target", "")
                if obj.get("confirm") or act in ("shutdown", "restart", "delete_file"):
                    self.pending_confirmation = (act, tgt)
                    return obj.get("reply") or f"Confirmez-vous {act}, {HONORIFIC} ?"
                return execute_os_action(act, tgt)["message"]
            self.history.append({"role": "model", "parts": [{"text": reply}]})
            return reply or f"A votre service, {HONORIFIC}."
        except Exception as exc:
            return f"Erreur de connexion IA : {exc}"


def chunk_rms(raw_bytes):
    """Calcule le volume RMS d'un bloc PCM 16-bit sans NumPy ni audioop (compatible Python 3.6-3.14+)."""
    if not raw_bytes:
        return 0.0
    samples = array.array("h")
    samples.frombytes(raw_bytes)
    if not samples:
        return 0.0
    total = 0
    for s in samples:
        total += s * s
    return math.sqrt(total / len(samples))


def prewarm_tts_cache():
    """Pre-genere en arriere-plan les reponses vocales courtes pour une latence nulle."""
    if not HAS_EDGE_TTS:
        return
    phrases = [
        f"Oui, {HONORIFIC} ?",
        f"C'est ouvert, {HONORIFIC}.",
        f"C'est fait, {HONORIFIC}.",
        f"Action annulee, {HONORIFIC}.",
    ]
    def _worker():
        try:
            os.makedirs(TTS_CACHE_DIR, exist_ok=True)
            loop = asyncio.new_event_loop()
            try:
                for p in phrases:
                    key_hash = hashlib.sha1(f"{VOICE_EDGE}:{p}".encode("utf-8")).hexdigest()
                    path = os.path.join(TTS_CACHE_DIR, f"{key_hash}.mp3")
                    if not (os.path.exists(path) and os.path.getsize(path) > 512):
                        async def _gen(txt=p, dst=path):
                            await edge_tts.Communicate(txt, VOICE_EDGE, rate="-5%", pitch="-8Hz").save(dst)
                        loop.run_until_complete(asyncio.wait_for(_gen(), timeout=5.0))
            finally:
                loop.close()
        except Exception:
            pass
    threading.Thread(target=_worker, daemon=True).start()


def calibrate_sounddevice_threshold(stream, blocksize=1280):
    """Mesure le bruit ambiant sur 0.4s via RawInputStream deja ouvert."""
    levels = []
    for _ in range(5):
        data, _ = stream.read(blocksize)
        levels.append(chunk_rms(bytes(data)))
    ambient = sum(levels) / len(levels) if levels else 120.0
    threshold = max(240.0, min(1600.0, ambient * 2.1))
    return ambient, threshold


def drain_stream(stream, blocksize=1280):
    """Vide l'audio accumule pendant que JARVIS parlait."""
    try:
        while getattr(stream, "read_available", 0) >= blocksize:
            stream.read(blocksize)
    except Exception:
        pass


def listen_with_sounddevice(stream, recognizer, ambient=120.0, threshold=320.0, timeout=None, max_seconds=5):
    """Capture vocale ultra-reactive (blocs 80ms, arret apres ~240ms de silence, 0 dependance NumPy)."""
    rate = 16000
    blocksize = 1280  # 80 ms par bloc
    pre_buffer = deque(maxlen=4)
    frames = []
    started = False
    silent_blocks = 0
    wait_blocks = 0
    max_wait_blocks = int(timeout * 12.5) if timeout else None
    max_speech_blocks = int(max_seconds * 12.5)

    drain_stream(stream, blocksize)
    while True:
        data, _ = stream.read(blocksize)
        raw = bytes(data)
        rms = chunk_rms(raw)

        if not started:
            pre_buffer.append(raw)
            if rms >= threshold:
                started = True
                frames.extend(pre_buffer)
                silent_blocks = 0
            else:
                ambient = ambient * 0.96 + rms * 0.04
                threshold = max(240.0, min(1600.0, ambient * 2.1))
                wait_blocks += 1
                if max_wait_blocks is not None and wait_blocks >= max_wait_blocks:
                    return ""
        else:
            frames.append(raw)
            silence_limit = max(threshold * 0.85, ambient * 1.45)
            if rms < silence_limit:
                silent_blocks += 1
            else:
                silent_blocks = 0
            if (silent_blocks >= 3 and len(frames) >= 6) or len(frames) >= max_speech_blocks:
                break

    raw_bytes = b"".join(frames)
    if not raw_bytes:
        return ""
    audio_data = sr.AudioData(raw_bytes, rate, 2)
    return recognizer.recognize_google(audio_data, language="fr-FR").strip()


def run_keyboard_loop(brain):
    speak(f"Mode clavier actif, {HONORIFIC}. Tapez votre demande puis Entree (ou 'quitter').")
    while True:
        try:
            txt = input("Vous : ").strip()
        except EOFError:
            break
        if txt.lower() in ("quitter", "exit", "stop"):
            speak(f"A votre service, {HONORIFIC}.")
            break
        if txt:
            speak(brain.handle_utterance(txt))


def process_transcript(brain, transcript, followup_fn):
    print(f"[Vous] {transcript}")
    low = transcript.lower()
    if brain.pending_confirmation:
        speak(brain.handle_utterance(transcript))
        time.sleep(0.05)
        return
    if WAKE_WORD in low:
        idx = low.find(WAKE_WORD) + len(WAKE_WORD)
        cmd = transcript[idx:].strip(" ,.:;!?")
        if not cmd:
            speak(f"Oui, {HONORIFIC} ?")
            time.sleep(0.05)
            cmd = followup_fn()
        if cmd:
            speak(brain.handle_utterance(cmd))
            time.sleep(0.05)


def run_voice_loop(brain):
    recognizer = sr.Recognizer()
    recognizer.pause_threshold = 0.35
    recognizer.non_speaking_duration = 0.2

    if HAS_PYGAME:
        try:
            if not pygame.mixer.get_init():
                pygame.mixer.init()
        except Exception:
            pass

    prewarm_tts_cache()

    if HAS_PYAUDIO:
        try:
            with sr.Microphone() as source:
                recognizer.adjust_for_ambient_noise(source, duration=0.4)
                speak(f"JARVIS est actif, {HONORIFIC}. Dites {WAKE_WORD} suivi de votre demande.")
                time.sleep(0.05)
                err_count = 0
                while True:
                    try:
                        audio = recognizer.listen(source, timeout=None, phrase_time_limit=6)
                        transcript = recognizer.recognize_google(audio, language="fr-FR").strip()
                        err_count = 0
                        if not transcript:
                            continue

                        def _pyaudio_followup():
                            audio2 = recognizer.listen(source, timeout=5, phrase_time_limit=6)
                            return recognizer.recognize_google(audio2, language="fr-FR").strip()

                        process_transcript(brain, transcript, _pyaudio_followup)
                    except (sr.UnknownValueError, sr.WaitTimeoutError):
                        err_count = 0
                        continue
                    except KeyboardInterrupt:
                        speak(f"A votre service, {HONORIFIC}.")
                        return
                    except Exception as exc:
                        err_count += 1
                        print(f"[Micro] {exc}")
                        if err_count >= 4:
                            print("[Micro] Trop d'erreurs micro, bascule en mode clavier.")
                            break
                        time.sleep(1)
        except Exception as exc:
            print(f"[Micro PyAudio] {exc}")

    if HAS_SOUNDDEVICE:
        try:
            with sd.RawInputStream(samplerate=16000, channels=1, dtype="int16", blocksize=1280) as stream:
                ambient, threshold = calibrate_sounddevice_threshold(stream)
                speak(f"JARVIS est actif, {HONORIFIC}. Dites {WAKE_WORD} suivi de votre demande.")
                time.sleep(0.05)
                err_count = 0
                while True:
                    try:
                        transcript = listen_with_sounddevice(stream, recognizer, ambient=ambient, threshold=threshold)
                        err_count = 0
                        if not transcript:
                            continue

                        def _sd_followup():
                            return listen_with_sounddevice(
                                stream, recognizer, ambient=ambient, threshold=threshold, timeout=5
                            )

                        process_transcript(brain, transcript, _sd_followup)
                    except (sr.UnknownValueError, sr.WaitTimeoutError):
                        err_count = 0
                        continue
                    except KeyboardInterrupt:
                        speak(f"A votre service, {HONORIFIC}.")
                        return
                    except Exception as exc:
                        err_count += 1
                        print(f"[Micro] {exc}")
                        if err_count >= 4:
                            print("[Micro] Micro inaccessible, bascule en mode clavier.")
                            break
                        time.sleep(1)
        except Exception as exc:
            print(f"[Micro SoundDevice] {exc}")

    run_keyboard_loop(brain)


def main():
    os.makedirs(CONFIG_DIR, exist_ok=True)
    start_bridge_server()
    brain = JarvisBrain()

    if not get_api_key():
        print("")
        print("Optionnel : entrez votre cle API Gemini (ou Entree pour commandes locales) :")
        try:
            k = input("Cle API : ").strip()
            if k:
                with open(KEY_FILE, "w", encoding="utf-8") as f:
                    f.write(k)
                brain.api_key = k
        except EOFError:
            pass

    if HAS_SR and (HAS_PYAUDIO or HAS_SOUNDDEVICE):
        run_voice_loop(brain)
    else:
        run_keyboard_loop(brain)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("\n[ERREUR CRITIQUE]")
        traceback.print_exc()
        input("\nAppuyez sur Entree pour fermer...")
