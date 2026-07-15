import { computed, reactive, ref } from "vue";
import { defineStore } from "pinia";
import { cancelUpload, completeUpload, initializeUpload } from "../api/files";
import type { UploadTask } from "../types/file";
import { expireSession, getAuthToken } from "../utils/request";

const RESUME_STORAGE_KEY = "filehub.upload-resume-map";
const SETTINGS_STORAGE_KEY = "filehub.transfer-settings";
const CONTENT_HASH_STORAGE_KEY = "filehub.content-hash-map";
const DEFAULT_CLIENT_HASH_MAX_BYTES = 64 * 1024 * 1024;
const MAX_CACHED_CONTENT_HASHES = 256;
const SHA256_PATTERN = /^[a-f\d]{64}$/;

const configuredHashLimit = Number(import.meta.env.VITE_CLIENT_HASH_MAX_BYTES);
const clientHashMaxBytes =
  Number.isSafeInteger(configuredHashLimit) && configuredHashLimit >= 0
    ? configuredHashLimit
    : DEFAULT_CLIENT_HASH_MAX_BYTES;

interface TransferSettings {
  concurrency: number;
  chunkRetries: number;
  autoStart: boolean;
}

interface ContentHashCacheEntry {
  hash: string;
  cachedAt: number;
}

const defaultSettings: TransferSettings = {
  concurrency: 2,
  chunkRetries: 2,
  autoStart: true,
};

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? ({ ...fallback, ...JSON.parse(value) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Uploading remains available when storage is disabled or full.
  }
}

function createTaskId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export const useUploadStore = defineStore("upload", () => {
  const tasks = ref<UploadTask[]>([]);
  const isPanelOpen = ref(false);
  const completedVersion = ref(0);
  const settings = reactive<TransferSettings>(
    readJson(SETTINGS_STORAGE_KEY, defaultSettings),
  );

  const runtimeFiles = new Map<string, File>();
  const activeRequests = new Map<string, XMLHttpRequest>();
  const processingIds = new Set<string>();
  const resumeRequested = new Set<string>();
  let activeCount = 0;

  const activeTasks = computed(() =>
    tasks.value.filter((task) =>
      [
        "queued",
        "hashing",
        "initializing",
        "uploading",
        "paused",
        "completing",
        "error",
      ].includes(task.status),
    ),
  );
  const runningCount = computed(
    () =>
      tasks.value.filter((task) =>
        ["hashing", "initializing", "uploading", "completing"].includes(
          task.status,
        ),
      ).length,
  );
  const aggregateProgress = computed(() => {
    const relevant = tasks.value.filter((task) => task.status !== "cancelled");
    const total = relevant.reduce((sum, task) => sum + task.fileSize, 0);
    if (!total) return 0;
    const uploaded = relevant.reduce(
      (sum, task) =>
        sum + (task.status === "success" ? task.fileSize : task.uploadedBytes),
      0,
    );
    return Math.min(100, Math.round((uploaded / total) * 100));
  });

  function addFiles(fileList: File[] | FileList, targetPath: string): void {
    const files = Array.from(fileList);
    for (const file of files) {
      const id = createTaskId();
      runtimeFiles.set(id, file);
      tasks.value.unshift({
        id,
        fileName: file.name,
        fileSize: file.size,
        targetPath,
        status: settings.autoStart ? "queued" : "paused",
        progress: 0,
        uploadedBytes: 0,
        speed: 0,
        uploadedChunks: [],
        instantUpload: false,
        createdAt: Date.now(),
      });
    }
    if (files.length) {
      isPanelOpen.value = true;
      pump();
    }
  }

  function pauseTask(id: string): void {
    const task = getTask(id);
    if (!task || ["success", "cancelled"].includes(task.status)) return;
    task.status = "paused";
    task.speed = 0;
    activeRequests.get(id)?.abort();
  }

  function resumeTask(id: string): void {
    const task = getTask(id);
    if (
      !task ||
      !runtimeFiles.has(id) ||
      ["success", "cancelled"].includes(task.status)
    )
      return;
    task.error = undefined;
    if (processingIds.has(id)) {
      task.status = "paused";
      resumeRequested.add(id);
      return;
    }
    task.status = "queued";
    pump();
  }

  function retryTask(id: string): void {
    resumeTask(id);
  }

  async function cancelTask(id: string): Promise<void> {
    const task = getTask(id);
    if (!task) return;
    task.status = "cancelled";
    task.speed = 0;
    activeRequests.get(id)?.abort();
    removeResumeId(task);
    if (task.uploadId) {
      await cancelUpload(task.uploadId).catch(() => undefined);
    }
  }

  function removeTask(id: string): void {
    activeRequests.get(id)?.abort();
    activeRequests.delete(id);
    runtimeFiles.delete(id);
    tasks.value = tasks.value.filter((task) => task.id !== id);
  }

  function clearFinished(): void {
    const removable = new Set(
      tasks.value
        .filter((task) => ["success", "cancelled"].includes(task.status))
        .map((task) => task.id),
    );
    removable.forEach((id) => {
      runtimeFiles.delete(id);
      activeRequests.delete(id);
    });
    tasks.value = tasks.value.filter((task) => !removable.has(task.id));
  }

  function updateSettings(next: Partial<TransferSettings>): void {
    Object.assign(settings, next);
    settings.concurrency = Math.min(
      4,
      Math.max(1, Number(settings.concurrency) || 1),
    );
    settings.chunkRetries = Math.min(
      5,
      Math.max(0, Number(settings.chunkRetries) || 0),
    );
    writeJson(SETTINGS_STORAGE_KEY, settings);
    pump();
  }

  function pump(): void {
    while (activeCount < settings.concurrency) {
      const task = tasks.value.find(
        (item) => item.status === "queued" && !processingIds.has(item.id),
      );
      if (!task) break;
      activeCount += 1;
      processingIds.add(task.id);
      void processTask(task).finally(() => {
        activeCount -= 1;
        processingIds.delete(task.id);
        if (resumeRequested.delete(task.id) && task.status === "paused") {
          task.status = "queued";
        }
        pump();
      });
    }
  }

  async function processTask(task: UploadTask): Promise<void> {
    const file = runtimeFiles.get(task.id);
    if (!file) {
      task.status = "error";
      task.error = "浏览器已释放文件内容，请重新选择同一文件以继续上传";
      return;
    }

    try {
      task.error = undefined;
      task.instantUpload = false;
      task.status = "hashing";
      const contentHash = await resolveContentHash(task, file);
      if (contentHash) task.contentHash = contentHash;
      if (isTaskStopped(task)) return;

      task.status = "initializing";
      const resumeId = readResumeMap()[fingerprint(task, file)];
      const session = await initializeUpload({
        path: task.targetPath,
        fileName: file.name,
        fileSize: file.size,
        lastModified: file.lastModified,
        resumeId,
        contentHash,
      });

      if (session.instantUpload) {
        if (resumeId) await cancelUpload(resumeId).catch(() => undefined);
        task.uploadId = undefined;
        task.chunkSize = undefined;
        task.totalChunks = undefined;
        task.uploadedChunks = [];
        finishUploadTask(
          task,
          file,
          session.file.name,
          session.contentHash,
          true,
        );
        return;
      }

      task.uploadId = session.uploadId;
      task.chunkSize = session.chunkSize;
      task.totalChunks = session.totalChunks;
      task.uploadedChunks = [...session.uploadedChunks];
      task.contentHash = session.contentHash || contentHash;
      writeResumeId(task, file, session.uploadId);
      updateCompletedProgress(task, file);

      if (isCancelled(task)) {
        removeResumeId(task, file);
        await cancelUpload(session.uploadId).catch(() => undefined);
        return;
      }
      if (isPaused(task)) return;

      for (let index = 0; index < session.totalChunks; index += 1) {
        if (isTaskStopped(task)) return;
        if (task.uploadedChunks.includes(index)) continue;

        task.status = "uploading";
        const start = index * session.chunkSize;
        const end = Math.min(file.size, start + session.chunkSize);
        const chunk = file.slice(start, end);
        await uploadChunkWithRetry(task, file, index, chunk);
        task.uploadedChunks.push(index);
        task.uploadedChunks.sort((a, b) => a - b);
        updateCompletedProgress(task, file);
      }

      if (isTaskStopped(task)) return;
      task.status = "completing";
      task.speed = 0;
      const result = await completeUpload(session.uploadId);
      finishUploadTask(task, file, result.name, result.contentHash, false);
    } catch (error) {
      if (isTaskStopped(task)) return;
      task.status = "error";
      task.speed = 0;
      task.error =
        error instanceof Error ? error.message : "上传失败，请稍后重试";
    }
  }

  function finishUploadTask(
    task: UploadTask,
    file: File,
    resultName: string,
    contentHash: string,
    instantUpload: boolean,
  ): void {
    task.status = "success";
    task.progress = 100;
    task.uploadedBytes = file.size;
    task.speed = 0;
    task.resultName = resultName;
    task.contentHash = contentHash;
    task.instantUpload = instantUpload;
    cacheContentHash(file, contentHash);
    removeResumeId(task, file);
    completedVersion.value += 1;
  }

  async function uploadChunkWithRetry(
    task: UploadTask,
    file: File,
    index: number,
    chunk: Blob,
  ): Promise<void> {
    let attempt = 0;
    while (true) {
      try {
        await uploadChunk(task, file, index, chunk);
        return;
      } catch (error) {
        if (isTaskStopped(task)) throw error;
        if (attempt >= settings.chunkRetries) throw error;
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
      }
    }
  }

  function uploadChunk(
    task: UploadTask,
    file: File,
    index: number,
    chunk: Blob,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!task.uploadId) {
        reject(new Error("上传会话尚未初始化"));
        return;
      }

      const xhr = new XMLHttpRequest();
      activeRequests.set(task.id, xhr);
      const formData = new FormData();
      formData.append("chunk", chunk, `${file.name}.part-${index}`);
      const completedBefore = uploadedBytes(task, file);
      let previousLoaded = 0;
      let previousTime = performance.now();

      xhr.open("POST", `/api/files/uploads/${task.uploadId}/chunks/${index}`);
      const token = getAuthToken();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const now = performance.now();
        const elapsedSeconds = Math.max((now - previousTime) / 1000, 0.05);
        const instantSpeed =
          Math.max(0, event.loaded - previousLoaded) / elapsedSeconds;
        task.speed = task.speed
          ? task.speed * 0.65 + instantSpeed * 0.35
          : instantSpeed;
        previousLoaded = event.loaded;
        previousTime = now;
        task.uploadedBytes = Math.min(
          file.size,
          completedBefore + event.loaded,
        );
        task.progress =
          file.size === 0
            ? 0
            : Math.min(99, (task.uploadedBytes / file.size) * 100);
      };

      xhr.onload = () => {
        activeRequests.delete(task.id);
        if (xhr.status === 401) {
          expireSession();
          reject(new Error("登录状态已过期"));
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
          return;
        }
        reject(
          new Error(parseXhrError(xhr) || `分片上传失败（HTTP ${xhr.status}）`),
        );
      };
      xhr.onerror = () => {
        activeRequests.delete(task.id);
        reject(
          new Error(
            navigator.onLine
              ? "网络连接异常，上传已保留，可重试继续"
              : "网络已断开，上传已保留",
          ),
        );
      };
      xhr.onabort = () => {
        activeRequests.delete(task.id);
        reject(new Error("上传已暂停"));
      };
      xhr.send(formData);
    });
  }

  function updateCompletedProgress(task: UploadTask, file: File): void {
    task.uploadedBytes = uploadedBytes(task, file);
    task.progress =
      file.size === 0
        ? 0
        : Math.min(99, (task.uploadedBytes / file.size) * 100);
  }

  function uploadedBytes(task: UploadTask, file: File): number {
    if (!task.chunkSize) return 0;
    return task.uploadedChunks.reduce((sum, index) => {
      const start = index * task.chunkSize!;
      return sum + Math.max(0, Math.min(task.chunkSize!, file.size - start));
    }, 0);
  }

  function isTaskStopped(task: UploadTask): boolean {
    return isPaused(task) || isCancelled(task);
  }

  function isPaused(task: UploadTask): boolean {
    return task.status === "paused";
  }

  function isCancelled(task: UploadTask): boolean {
    return task.status === "cancelled";
  }
  function getTask(id: string): UploadTask | undefined {
    return tasks.value.find((task) => task.id === id);
  }

  async function resolveContentHash(
    task: UploadTask,
    file: File,
  ): Promise<string | undefined> {
    if (task.contentHash && SHA256_PATTERN.test(task.contentHash))
      return task.contentHash;

    const cached = readContentHashMap()[contentFingerprint(file)];
    if (cached) return cached.hash;
    if (file.size > clientHashMaxBytes || !globalThis.crypto?.subtle)
      return undefined;

    try {
      const digest = await globalThis.crypto.subtle.digest(
        "SHA-256",
        await file.arrayBuffer(),
      );
      const hash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      cacheContentHash(file, hash);
      return hash;
    } catch {
      return undefined;
    }
  }

  function fingerprint(task: UploadTask, file: File): string {
    return `${task.targetPath}\u0000${file.name}\u0000${file.size}\u0000${file.lastModified}`;
  }

  function contentFingerprint(file: File): string {
    return `${file.name}\u0000${file.size}\u0000${file.lastModified}\u0000${file.type}\u0000${file.webkitRelativePath}`;
  }

  function readResumeMap(): Record<string, string> {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(RESUME_STORAGE_KEY) || "{}",
      ) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return {};
      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, string] => {
          return typeof entry[1] === "string" && entry[1].length > 0;
        }),
      );
    } catch {
      return {};
    }
  }

  function writeResumeId(task: UploadTask, file: File, uploadId: string): void {
    const map = readResumeMap();
    map[fingerprint(task, file)] = uploadId;
    writeJson(RESUME_STORAGE_KEY, map);
  }

  function removeResumeId(
    task: UploadTask,
    file = runtimeFiles.get(task.id),
  ): void {
    if (!file) return;
    const map = readResumeMap();
    delete map[fingerprint(task, file)];
    writeJson(RESUME_STORAGE_KEY, map);
  }

  function readContentHashMap(): Record<string, ContentHashCacheEntry> {
    try {
      const parsed = JSON.parse(
        localStorage.getItem(CONTENT_HASH_STORAGE_KEY) || "{}",
      ) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        return {};

      const entries = Object.entries(parsed).filter(
        (entry): entry is [string, ContentHashCacheEntry] => {
          const value = entry[1];
          if (!value || typeof value !== "object" || Array.isArray(value))
            return false;
          const candidate = value as Partial<ContentHashCacheEntry>;
          return (
            typeof candidate.hash === "string" &&
            SHA256_PATTERN.test(candidate.hash) &&
            typeof candidate.cachedAt === "number" &&
            Number.isFinite(candidate.cachedAt)
          );
        },
      );
      return Object.fromEntries(entries);
    } catch {
      return {};
    }
  }

  function cacheContentHash(file: File, hash: string): void {
    if (!SHA256_PATTERN.test(hash)) return;
    const map = readContentHashMap();
    map[contentFingerprint(file)] = { hash, cachedAt: Date.now() };
    const recentEntries = Object.entries(map)
      .sort(([, left], [, right]) => right.cachedAt - left.cachedAt)
      .slice(0, MAX_CACHED_CONTENT_HASHES);
    writeJson(CONTENT_HASH_STORAGE_KEY, Object.fromEntries(recentEntries));
  }

  function parseXhrError(xhr: XMLHttpRequest): string {
    try {
      const body = JSON.parse(xhr.responseText);
      return Array.isArray(body.message)
        ? body.message.join("；")
        : body.message || "";
    } catch {
      return "";
    }
  }

  return {
    tasks,
    settings,
    isPanelOpen,
    completedVersion,
    activeTasks,
    runningCount,
    aggregateProgress,
    addFiles,
    pauseTask,
    resumeTask,
    retryTask,
    cancelTask,
    removeTask,
    clearFinished,
    updateSettings,
  };
});
