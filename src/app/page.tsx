"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CloudArrowDownIcon,
  PlayIcon,
  TrashIcon,
  VideoCameraIcon,
} from "@heroicons/react/24/outline";

type Clip = {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  duration: number;
  start: number;
  end: number;
};

type ProgressState = {
  step: number;
  total: number;
};

const MIN_CLIP_LEN = 0.5;

const formatTime = (value: number) => {
  if (!Number.isFinite(value) || value < 0) {
    return "0:00";
  }
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

export default function Home() {
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [ffmpegLoading, setFfmpegLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const ffmpegInitPromise = useRef<Promise<void> | null>(null);
  const progressStateRef = useRef<ProgressState>({ step: 0, total: 1 });
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const outputUrlRef = useRef<string | null>(null);
  const clipsRef = useRef<Clip[]>([]);

  useEffect(() => {
    clipsRef.current = clips;
  }, [clips]);

  useEffect(() => {
    return () => {
      clipsRef.current.forEach((clip) => {
        URL.revokeObjectURL(clip.previewUrl);
      });
      if (outputUrlRef.current) {
        URL.revokeObjectURL(outputUrlRef.current);
      }
    };
  }, []);

  const ensureFFmpeg = useCallback(async () => {
    if (ffmpegReady && ffmpegRef.current) {
      return ffmpegRef.current;
    }

    if (!ffmpegRef.current) {
      const instance = new FFmpeg();
      instance.on("log", ({ message }) => {
        setLogs((prev) => {
          const next = [...prev, message];
          return next.slice(-12);
        });
      });
      instance.on("progress", ({ progress: clipProgress }) => {
        const { step, total } = progressStateRef.current;
        const base = total === 0 ? 0 : step / total;
        const incremental =
          clipProgress && Number.isFinite(clipProgress)
            ? clipProgress / Math.max(total, 1)
            : 0;
        setProgress(Math.min(1, base + incremental));
      });
      ffmpegRef.current = instance;
    }

    if (!ffmpegInitPromise.current) {
      setFfmpegLoading(true);
      ffmpegInitPromise.current = ffmpegRef.current
        .load()
        .then(() => {
          setFfmpegReady(true);
          setFfmpegLoading(false);
        })
        .catch((error) => {
          setFfmpegLoading(false);
          ffmpegInitPromise.current = null;
          throw error;
        });
    }

    await ffmpegInitPromise.current;
    return ffmpegRef.current!;
  }, [ffmpegReady]);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    setErrorMessage(null);
    const newClips: Clip[] = [];

    for (const file of Array.from(files)) {
      if (!file.type.startsWith("video")) {
        setErrorMessage("الملفات المضافة يجب أن تكون فيديو فقط.");
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      const duration = await new Promise<number>((resolve, reject) => {
        const probe = document.createElement("video");
        probe.preload = "metadata";
        probe.src = previewUrl;
        probe.onloadedmetadata = () => {
          resolve(Number.isFinite(probe.duration) ? probe.duration : 0);
        };
        probe.onerror = () => reject(new Error("تعذر قراءة بيانات الفيديو."));
      }).catch(() => 0);

      newClips.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        file,
        previewUrl,
        name: file.name,
        duration: duration > 0 ? duration : 0,
        start: 0,
        end: duration > 0 ? duration : 0,
      });
    }

    setClips((prev) => [...prev, ...newClips]);
    if (!selectedClipId && newClips.length > 0) {
      setSelectedClipId(newClips[0].id);
    }
  }, [selectedClipId]);

  const updateClip = useCallback((id: string, patch: Partial<Clip>) => {
    setClips((prev) =>
      prev.map((clip) => {
        if (clip.id !== id) return clip;
        const merged = { ...clip, ...patch };
        let start = Math.max(0, merged.start);
        let end = Math.min(merged.duration, merged.end);
        if (merged.duration <= MIN_CLIP_LEN) {
          start = 0;
          end = merged.duration;
        } else if (end - start < MIN_CLIP_LEN) {
          if (start + MIN_CLIP_LEN <= merged.duration) {
            end = start + MIN_CLIP_LEN;
          } else {
            start = Math.max(0, merged.duration - MIN_CLIP_LEN);
            end = merged.duration;
          }
        }
        return { ...merged, start, end };
      }),
    );
  }, []);

  const removeClip = useCallback((id: string) => {
    setClips((prev) => {
      const target = prev.find((clip) => clip.id === id);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
      }
      const next = prev.filter((clip) => clip.id !== id);
      if (selectedClipId === id) {
        setSelectedClipId(next[0]?.id ?? null);
      }
      return next;
    });
  }, [selectedClipId]);

  const moveClip = useCallback(
    (id: string, direction: "up" | "down") => {
      setClips((prev) => {
        const index = prev.findIndex((clip) => clip.id === id);
        if (index < 0) return prev;
        const targetIndex =
          direction === "up" ? Math.max(0, index - 1) : Math.min(prev.length - 1, index + 1);
        if (index === targetIndex) return prev;
        const next = [...prev];
        const [removed] = next.splice(index, 1);
        next.splice(targetIndex, 0, removed);
        return next;
      });
    },
    [],
  );

  const setFromVideoTime = useCallback(
    (clipId: string, field: "start" | "end") => {
      const video = videoRefs.current[clipId];
      if (!video) return;
      updateClip(clipId, { [field]: video.currentTime } as Partial<Clip>);
    },
    [updateClip],
  );

  const totalDuration = useMemo(() => {
    return clips.reduce((sum, clip) => sum + Math.max(0, clip.end - clip.start), 0);
  }, [clips]);

  const hasValidClips = useMemo(() => {
    if (!clips.length) return false;
    return clips.every((clip) => clip.end - clip.start >= MIN_CLIP_LEN);
  }, [clips]);

  const exportMontage = useCallback(async () => {
    if (!clips.length) {
      setErrorMessage("أضف مقاطعك أولاً قبل التصدير.");
      return;
    }
    if (!hasValidClips) {
      setErrorMessage("تأكد أن كل مقطع أطول من نصف ثانية.");
      return;
    }

    try {
      setIsProcessing(true);
      setErrorMessage(null);
      setProgress(0);
      setLogs([]);
      const ffmpeg = await ensureFFmpeg();
      const runId = `montage_${Date.now()}`;
      const trimmedNames: string[] = [];
      progressStateRef.current = {
        step: 0,
        total: clips.length + 1,
      };

      for (let index = 0; index < clips.length; index += 1) {
        const clip = clips[index];
        const inputName = `${runId}_input_${index}.mp4`;
        const trimmedName = `${runId}_trim_${index}.mp4`;
        const data = await fetchFile(clip.file);
        await ffmpeg.writeFile(inputName, data);
        const duration = Math.max(clip.end - clip.start, MIN_CLIP_LEN);
        const start = Math.max(clip.start, 0).toFixed(2);
        const clipDuration = duration.toFixed(2);
        await ffmpeg.exec([
          "-i",
          inputName,
          "-ss",
          start,
          "-t",
          clipDuration,
          "-vf",
          "scale=1280:-2",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "faststart",
          trimmedName,
        ]);
        trimmedNames.push(trimmedName);
        progressStateRef.current = {
          ...progressStateRef.current,
          step: index + 1,
        };
        setProgress(
          Math.min(
            1,
            progressStateRef.current.step / progressStateRef.current.total,
          ),
        );
      }

      const listFileName = `${runId}_list.txt`;
      const concatList = trimmedNames.map((name) => `file '${name}'`).join("\n");
      await ffmpeg.writeFile(listFileName, new TextEncoder().encode(concatList));
      await ffmpeg.exec([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFileName,
        "-c",
        "copy",
        `${runId}_output.mp4`,
      ]);
      progressStateRef.current = {
        ...progressStateRef.current,
        step: progressStateRef.current.total,
      };
      setProgress(1);
      const outputData = await ffmpeg.readFile(`${runId}_output.mp4`);
      if (outputUrlRef.current) {
        URL.revokeObjectURL(outputUrlRef.current);
      }
      const normalizedData =
        typeof outputData === "string"
          ? new TextEncoder().encode(outputData)
          : outputData;
      const videoBlob = new Blob(
        [normalizedData.slice()],
        { type: "video/mp4" },
      );
      const nextUrl = URL.createObjectURL(videoBlob);
      outputUrlRef.current = nextUrl;
      setOutputUrl(nextUrl);
    } catch (error) {
      console.error(error);
      setErrorMessage("حدث خطأ أثناء التصدير. حاول مرة أخرى.");
    } finally {
      setIsProcessing(false);
    }
  }, [clips, ensureFFmpeg, hasValidClips]);

  return (
    <div className="min-h-screen bg-slate-950 bg-[radial-gradient(circle_at_top,_#1f263a,_#080c17)] py-10 text-slate-100">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 md:px-8">
        <header className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <div className="flex items-center gap-3 text-xl font-semibold text-slate-100 md:text-2xl">
            <VideoCameraIcon className="h-8 w-8 text-purple-400" />
            <span>استوديو المونتاج - منتج فيديو متكامل داخل المتصفح</span>
          </div>
          <p className="max-w-3xl text-sm leading-6 text-slate-300 md:text-base">
            قم بتحميل عدة مقاطع، قص البداية والنهاية، أعد ترتيبها ثم صدّر مونتاج MP4 بدون الحاجة
            لأي برامج إضافية. كل المعالجة تتم محلياً داخل المتصفح باستخدام WebAssembly.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl border border-dashed border-purple-500/60 bg-purple-500/10 px-6 py-4 text-sm font-medium text-purple-100 transition hover:bg-purple-500/20 sm:w-auto">
              <input
                type="file"
                accept="video/*"
                multiple
                className="hidden"
                onChange={(event) => handleFiles(event.target.files)}
              />
              <CloudArrowDownIcon className="h-6 w-6" />
              <span>إضافة مقاطع الفيديو</span>
            </label>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
              <span className="rounded-full border border-white/10 px-4 py-1">
                المقاطع: {clips.length}
              </span>
              <span className="rounded-full border border-white/10 px-4 py-1">
                الطول الإجمالي: {formatTime(totalDuration)}
              </span>
              <span className="rounded-full border border-white/10 px-4 py-1">
                {ffmpegReady
                  ? "محرك FFmpeg جاهز"
                  : ffmpegLoading
                    ? "جاري تحميل محرك FFmpeg (~25MB)"
                    : "سيتم تحميل محرك FFmpeg عند أول تصدير"}
              </span>
            </div>
          </div>
        </header>

        {errorMessage && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
            {errorMessage}
          </div>
        )}

        <section className="flex flex-col gap-5 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <h2 className="text-lg font-semibold text-slate-100 md:text-xl">
            المقاطع المضافة
          </h2>
          {clips.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/10 bg-black/20 py-16 text-center text-sm text-slate-400">
              <VideoCameraIcon className="h-10 w-10 text-slate-500" />
              <p>ابدأ بإضافة مقاطع الفيديو الخاصة بك وسيظهر كل مقطع هنا للتحكم والتقطيع.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {clips.map((clip, index) => (
                <div
                  key={clip.id}
                  className={`flex flex-col gap-4 rounded-xl border bg-black/30 p-4 transition ${
                    selectedClipId === clip.id
                      ? "border-purple-400/70 shadow-[0_0_30px_rgba(168,85,247,0.25)]"
                      : "border-white/10"
                  }`}
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        className="text-right text-base font-semibold text-slate-100 hover:text-purple-200"
                        onClick={() => setSelectedClipId(clip.id)}
                      >
                        {index + 1}. {clip.name}
                      </button>
                      <p className="text-xs text-slate-400">
                        الطول الكامل: {formatTime(clip.duration)} — الجزء المحدد:{" "}
                        {formatTime(Math.max(clip.end - clip.start, 0))}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 self-end md:self-start">
                      <button
                        type="button"
                        className="rounded-full border border-white/10 p-2 text-slate-200 transition hover:border-purple-400/60 hover:text-purple-200 disabled:opacity-40"
                        onClick={() => moveClip(clip.id, "up")}
                        disabled={index === 0}
                        title="تحريك للأعلى"
                      >
                        <ArrowUpIcon className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-white/10 p-2 text-slate-200 transition hover:border-purple-400/60 hover:text-purple-200 disabled:opacity-40"
                        onClick={() => moveClip(clip.id, "down")}
                        disabled={index === clips.length - 1}
                        title="تحريك للأسفل"
                      >
                        <ArrowDownIcon className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-red-500/30 bg-red-500/10 p-2 text-red-200 transition hover:border-red-400 hover:bg-red-500/20"
                        onClick={() => removeClip(clip.id)}
                        title="حذف المقطع"
                      >
                        <TrashIcon className="h-5 w-5" />
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/40">
                      <video
                        controls
                        className="h-full w-full object-cover"
                        src={clip.previewUrl}
                        ref={(element) => {
                          videoRefs.current[clip.id] = element;
                        }}
                        onPlay={() => setSelectedClipId(clip.id)}
                      />
                    </div>

                    <div className="flex flex-col gap-4 text-sm">
                      <div className="grid gap-2 rounded-xl border border-white/10 bg-white/5 p-4">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-300">بداية المقطع (ثواني)</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              step="0.1"
                              min={0}
                              max={clip.duration}
                              value={clip.start.toFixed(1)}
                              onChange={(event) =>
                                updateClip(clip.id, {
                                  start: Number.parseFloat(event.target.value) || 0,
                                })
                              }
                              className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-right text-slate-100 focus:border-purple-500 focus:outline-none"
                            />
                            <button
                              className="whitespace-nowrap rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs text-purple-100 transition hover:bg-purple-500/20"
                              type="button"
                              onClick={() => setFromVideoTime(clip.id, "start")}
                            >
                              استخدم الزمن الحالي
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <label className="text-xs text-slate-300">نهاية المقطع (ثواني)</label>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              step="0.1"
                              min={clip.start + MIN_CLIP_LEN}
                              max={clip.duration}
                              value={clip.end.toFixed(1)}
                              onChange={(event) =>
                                updateClip(clip.id, {
                                  end: Number.parseFloat(event.target.value) || clip.duration,
                                })
                              }
                              className="w-full rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-right text-slate-100 focus:border-purple-500 focus:outline-none"
                            />
                            <button
                              className="whitespace-nowrap rounded-lg border border-purple-500/40 bg-purple-500/10 px-3 py-2 text-xs text-purple-100 transition hover:bg-purple-500/20"
                              type="button"
                              onClick={() => setFromVideoTime(clip.id, "end")}
                            >
                              استخدم الزمن الحالي
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-4 text-xs leading-5 text-slate-300">
                        <span>نصائح:</span>
                        <ul className="list-inside list-disc space-y-1">
                          <li>استعمل أزرار الزمن الحالي لمزامنة القص مع وضع التشغيل بالفيديو.</li>
                          <li>تحريك المقطع لأعلى أو لأسفل سيغيّر ترتيب عرضه في التصدير النهائي.</li>
                          <li>اترك على الأقل نصف ثانية كطول للمقطع بعد القص للحصول على نتيجة أفضل.</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {clips.length > 0 && (
          <section className="flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold md:text-xl">التصدير النهائي</h2>
                <p className="text-sm text-slate-300">
                  سيتم تحويل كل المقاطع إلى MP4 (H.264 + AAC) وتلصيقها بالترتيب المحدد.
                </p>
              </div>
              <button
                type="button"
                onClick={exportMontage}
                disabled={isProcessing || !hasValidClips}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-purple-500 to-indigo-500 px-6 py-3 text-sm font-semibold text-white shadow-lg transition hover:from-purple-400 hover:to-indigo-400 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <PlayIcon className="h-5 w-5" />
                {isProcessing ? "جاري تجهيز الفيديو..." : "تصدير الفيديو النهائي"}
              </button>
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/30 p-4">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-300">
                ترتيب المقاطع الزمني
              </span>
              <div className="flex h-3 overflow-hidden rounded-full border border-white/10">
                {clips.map((clip, index) => {
                  const clipLength = Math.max(clip.end - clip.start, 0);
                  const width =
                    totalDuration > 0
                      ? Math.max(clipLength / totalDuration, 0) * 100
                      : 100 / clips.length;
                  return (
                    <div
                      key={clip.id}
                      className="flex items-center justify-center bg-gradient-to-l from-purple-500/80 to-indigo-500/80 text-[10px] font-semibold text-white/90"
                      style={{ width: `${width}%` }}
                      title={`${index + 1}. ${clip.name}`}
                    >
                      <span className="px-2">{index + 1}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-slate-400">
                ملاحظة: العرض النسبي لكل شريحة يعكس طولها بعد القص داخل المخطط الزمني.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-black/40">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-purple-400 to-emerald-400 transition-all duration-300"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
              <span className="text-xs text-slate-300">
                التقدم: {Math.round(progress * 100)}%
              </span>
            </div>

            {outputUrl && (
              <div className="flex flex-col gap-3 rounded-xl border border-emerald-400/50 bg-emerald-400/10 p-4 text-sm text-emerald-100">
                <span>الفيديو جاهز للتنزيل والمراجعة.</span>
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-4">
                  <a
                    href={outputUrl}
                    download="montage.mp4"
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-300/60 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-50 transition hover:bg-emerald-500/30"
                  >
                    <CloudArrowDownIcon className="h-5 w-5" />
                    تحميل الفيديو
                  </a>
                  <video
                    controls
                    className="w-full max-w-md rounded-lg border border-white/10"
                    src={outputUrl}
                  />
                </div>
              </div>
            )}

            {logs.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-black/40 p-4 text-xs leading-5 text-slate-300">
                <p className="mb-2 font-semibold text-slate-200">سجل العمليات (FFmpeg):</p>
                <div className="max-h-40 space-y-1 overflow-y-auto font-mono text-[11px] text-slate-400">
                  {logs.map((entry, index) => (
                    <div key={`${entry}-${index}`} className="whitespace-pre-wrap">
                      {entry}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
