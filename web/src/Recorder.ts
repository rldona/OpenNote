import { useCallback, useEffect, useRef, useState } from 'react';

const PREFERRED = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/** Records the microphone; `onDone` receives the finished recording as a file. */
export function useRecorder(onDone: (file: File) => void) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const done = useRef(onDone);
  done.current = onDone;

  const release = () => {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    recorder.current = null;
    setRecording(false);
    setSeconds(0);
  };

  const start = useCallback(async () => {
    setError(null);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const mimeType = PREFERRED.find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      rec.onstop = () => {
        const type = (rec.mimeType || 'audio/webm').split(';')[0]!;
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
        if (chunks.length) done.current(new File(chunks, `recording-${stamp}.${ext}`, { type }));
        release();
      };
      recorder.current = rec;
      rec.start(1000);
      setRecording(true);
      timer.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (e) {
      release();
      setError((e as Error).name === 'NotAllowedError' ? 'Microphone access was denied' : (e as Error).message);
    }
  }, []);

  const stop = useCallback(() => recorder.current?.state === 'recording' && recorder.current.stop(), []);
  useEffect(() => release, []);

  return { recording, seconds, error, start, stop };
}
