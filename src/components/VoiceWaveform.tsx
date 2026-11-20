import { useEffect, useRef } from 'react';

interface VoiceWaveformProps {
  isListening: boolean;
  isSpeaking: boolean;
  isThinking: boolean;
  analyserNode: AnalyserNode | null;
}

export function VoiceWaveform({
  isListening,
  isSpeaking,
  isThinking,
  analyserNode,
}: VoiceWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = 360;
    const height = 72;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    let rafId = 0;
    let phase = 0;
    const freqData = analyserNode ? new Uint8Array(analyserNode.frequencyBinCount) : null;

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      const bars = 44;
      const gap = 4;
      const barWidth = (width - gap * (bars - 1)) / bars;
      const midY = height / 2;

      if (analyserNode && freqData && isListening) {
        analyserNode.getByteFrequencyData(freqData);
      }

      phase += isSpeaking ? 0.16 : isThinking ? 0.09 : 0.04;

      for (let i = 0; i < bars; i++) {
        let amplitude = 2;

        if (isListening && freqData && freqData.length > 0) {
          const binIndex = Math.min(
            freqData.length - 1,
            Math.floor((i / bars) * (freqData.length * 0.7))
          );
          const norm = freqData[binIndex] / 255;
          amplitude = Math.max(3, norm * (height * 0.78));
        } else if (isSpeaking) {
          const env = Math.sin((i / bars) * Math.PI);
          amplitude =
            4 +
            env *
              (12 +
                14 * Math.abs(Math.sin(phase + i * 0.35)) +
                8 * Math.abs(Math.cos(phase * 1.4 - i * 0.2)));
        } else if (isThinking) {
          const wave = Math.sin(phase * 1.6 + i * 0.28);
          amplitude = 4 + (wave * 0.5 + 0.5) * 14;
        } else {
          amplitude = 2;
        }

        const x = i * (barWidth + gap);
        const y = midY - amplitude / 2;

        if (isSpeaking) {
          ctx.fillStyle = '#38BDF8';
        } else if (isListening) {
          ctx.fillStyle = '#0EA5E9';
        } else if (isThinking) {
          ctx.fillStyle = '#7DD3FC';
        } else {
          ctx.fillStyle = '#334155';
        }

        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, amplitude, 2);
        ctx.fill();
      }

      rafId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [analyserNode, isListening, isSpeaking, isThinking]);

  return (
    <canvas
      ref={canvasRef}
      className="h-[72px] w-full max-w-[360px]"
      aria-label="Visualisation acoustique du microphone"
    />
  );
}
