import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

export type ListeningMode = 'direct' | 'wakeword';

interface UseVoiceAssistantOptions {
  wakeWord: string;
  voiceEnabled: boolean;
  speechRate: number;
  listeningMode: ListeningMode;
  awaitingConfirmation: boolean;
  onCommand: (text: string) => void;
}

export function useVoiceAssistant(options: UseVoiceAssistantOptions) {
  const {
    wakeWord,
    voiceEnabled,
    speechRate,
    listeningMode,
    awaitingConfirmation,
    onCommand,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [speechSupported, setSpeechSupported] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const shouldKeepListeningRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const speakAbortRef = useRef<AbortController | null>(null);
  const playbackCtxRef = useRef<AudioContext | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const latestPropsRef = useRef({
    wakeWord,
    listeningMode,
    awaitingConfirmation,
    onCommand,
  });
  latestPropsRef.current = {
    wakeWord,
    listeningMode,
    awaitingConfirmation,
    onCommand,
  };

  useEffect(() => {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    if (!win.SpeechRecognition && !win.webkitSpeechRecognition) {
      setSpeechSupported(false);
    }
  }, []);

  const unlockAudio = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;

      if (!playbackCtxRef.current || playbackCtxRef.current.state === 'closed') {
        playbackCtxRef.current = new AudioCtx();
      }
      const ctx = playbackCtxRef.current;
      if (ctx.state === 'suspended') {
        void ctx.resume();
      }
      // Joue un tampon silencieux d'1 échantillon pour déverrouiller l'audio dans l'iframe
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    const onGesture = () => unlockAudio();
    window.addEventListener('pointerdown', onGesture, { passive: true });
    window.addEventListener('keydown', onGesture, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [unlockAudio]);

  const stopAudioMeter = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);

  const startAudioMeter = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const ctx = new AudioContext();
      audioContextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 128;
      source.connect(analyser);
      analyserRef.current = analyser;

      const buffer = new Uint8Array(analyser.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(buffer);
        let sum = 0;
        for (let i = 0; i < buffer.length; i++) {
          sum += buffer[i];
        }
        const avg = sum / buffer.length / 255;
        setAudioLevel(avg);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // Si l'API WebAudio échoue mais SpeechRecognition fonctionne, on ignore silencieusement
    }
  }, []);

  const stopListening = useCallback(() => {
    shouldKeepListeningRef.current = false;
    setIsListening(false);
    setInterimTranscript('');
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    stopAudioMeter();
  }, [stopAudioMeter]);

  const startListening = useCallback(() => {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SpeechRec) {
      setSpeechSupported(false);
      setVoiceError(
        'La reconnaissance vocale Web Speech API n’est pas prise en charge par ce navigateur. Utilisez Chrome ou Edge.'
      );
      return;
    }

    setVoiceError(null);
    shouldKeepListeningRef.current = true;
    setIsListening(true);
    void startAudioMeter();

    const rec = new SpeechRec();
    rec.lang = 'fr-FR';
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript?.trim() ?? '';
        if (result.isFinal) {
          setInterimTranscript('');
          if (!text) continue;

          const {
            wakeWord: ww,
            listeningMode: mode,
            awaitingConfirmation: awaiting,
            onCommand: dispatch,
          } = latestPropsRef.current;

          if (mode === 'wakeword' && !awaiting) {
            const lower = text.toLowerCase();
            const cleanWake = ww.trim().toLowerCase() || 'jarvis';
            const idx = lower.indexOf(cleanWake);
            if (idx === -1) {
              continue;
            }
            const afterWake = text.slice(idx + cleanWake.length).replace(/^[,.\s:!?]+/, '').trim();
            if (afterWake) {
              dispatch(afterWake);
            } else {
              dispatch('Bonjour Jarvis');
            }
          } else {
            dispatch(text);
          }
        } else {
          interim += (interim ? ' ' : '') + text;
        }
      }
      if (interim) {
        setInterimTranscript(interim);
      }
    };

    rec.onerror = (ev: SpeechRecognitionErrorEventLike) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        setVoiceError(
          'Accès au microphone refusé. Autorisez le microphone dans les paramètres du navigateur.'
        );
        stopListening();
      } else if (ev.error !== 'no-speech' && ev.error !== 'aborted') {
        setVoiceError(`Erreur reconnaissance vocale : ${ev.error}`);
      }
    };

    rec.onend = () => {
      if (shouldKeepListeningRef.current) {
        try {
          rec.start();
        } catch {
          // Redémarrage différé si déjà actif
          setTimeout(() => {
            if (shouldKeepListeningRef.current && recognitionRef.current === rec) {
              try {
                rec.start();
              } catch {
                stopListening();
              }
            }
          }, 250);
        }
      }
    };

    recognitionRef.current = rec;
    try {
      rec.start();
    } catch (err) {
      setVoiceError(
        err instanceof Error ? err.message : 'Impossible de démarrer le microphone.'
      );
      stopListening();
    }
  }, [startAudioMeter, stopListening]);

  const stopSpeaking = useCallback(() => {
    if (speakAbortRef.current) {
      speakAbortRef.current.abort();
      speakAbortRef.current = null;
    }
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop();
        activeSourceRef.current.disconnect();
      } catch {
        // ignore
      }
      activeSourceRef.current = null;
    }
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  const speakBrowserFallback = useCallback(
    (text: string) => {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setIsSpeaking(false);
        return;
      }
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'fr-FR';
        utterance.rate = speechRate;
        utterance.pitch = 0.94;

        const voices = window.speechSynthesis.getVoices();
        const preferred =
          voices.find(
            (v) => v.lang.toLowerCase().startsWith('fr') && /henri|thomas|paul|google/i.test(v.name)
          ) || voices.find((v) => v.lang.toLowerCase().startsWith('fr'));
        if (preferred) {
          utterance.voice = preferred;
        }

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);

        window.speechSynthesis.speak(utterance);
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
      } catch {
        setIsSpeaking(false);
      }
    },
    [speechRate]
  );

  const runSpeak = useCallback(
    (rawText: string, ignoreVoiceToggle = false) => {
      if ((!voiceEnabled && !ignoreVoiceToggle) || !rawText.trim() || typeof window === 'undefined') {
        return;
      }
      const cleanText = rawText
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/#+\s*/g, '')
        .trim();

      if (!cleanText) return;

      stopSpeaking();
      unlockAudio();

      const ctrl = new AbortController();
      speakAbortRef.current = ctrl;
      setIsSpeaking(true);

      fetch('/api/jarvis/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText, voice: 'fr-FR-HenriNeural' }),
        signal: ctrl.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
          const arrayBuffer = await res.arrayBuffer();
          if (ctrl.signal.aborted) return;

          const ctx = playbackCtxRef.current;
          if (ctx && ctx.state !== 'closed') {
            if (ctx.state === 'suspended') {
              await ctx.resume();
            }
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
            if (ctrl.signal.aborted) return;

            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.playbackRate.value = speechRate;
            source.connect(ctx.destination);
            activeSourceRef.current = source;

            source.onended = () => {
              if (activeSourceRef.current === source) {
                activeSourceRef.current = null;
                setIsSpeaking(false);
              }
            };

            source.start(0);
            return;
          }

          // Repli HTMLAudioElement si AudioContext indisponible
          const blob = new Blob([arrayBuffer], { type: 'audio/mpeg' });
          const url = URL.createObjectURL(blob);
          audioUrlRef.current = url;
          const audio = new Audio(url);
          audio.playbackRate = speechRate;
          audioElementRef.current = audio;

          audio.onended = () => {
            setIsSpeaking(false);
            if (audioUrlRef.current) {
              URL.revokeObjectURL(audioUrlRef.current);
              audioUrlRef.current = null;
            }
            audioElementRef.current = null;
          };
          audio.onerror = () => {
            setIsSpeaking(false);
            speakBrowserFallback(cleanText);
          };

          await audio.play();
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          speakBrowserFallback(cleanText);
        });
    },
    [speechRate, speakBrowserFallback, stopSpeaking, unlockAudio, voiceEnabled]
  );

  const speak = useCallback(
    (text: string) => runSpeak(text, false),
    [runSpeak]
  );

  const forceSpeak = useCallback(
    (text: string) => runSpeak(text, true),
    [runSpeak]
  );

  useEffect(() => {
    return () => {
      stopListening();
      stopSpeaking();
      if (playbackCtxRef.current && playbackCtxRef.current.state !== 'closed') {
        playbackCtxRef.current.close().catch(() => {});
      }
    };
  }, [stopListening, stopSpeaking]);

  return {
    isListening,
    isSpeaking,
    interimTranscript,
    voiceError,
    speechSupported,
    audioLevel,
    analyserNode: analyserRef.current,
    startListening,
    stopListening,
    speak,
    forceSpeak,
    stopSpeaking,
    unlockAudio,
  };
}
