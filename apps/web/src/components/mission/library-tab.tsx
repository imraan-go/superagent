"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { DownloadSimple, FileText, Image as ImageIcon } from "@phosphor-icons/react/dist/ssr";
import { Modal, Panel, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { formatBytes, isImageMime } from "@/lib/uploads";
import type { FileInfo } from "@/lib/uploads";
import styles from "./library-tab.module.css";

/**
 * This chat's files: owner uploads and the screenshots the agent's tools took.
 * Images open in a lightbox (arrow keys move through them); other files
 * download. Refreshes while a run is active so new screenshots appear live.
 */
export function LibraryTab({ chatId, running }: { chatId?: string | null; running: boolean }) {
  const [openId, setOpenId] = useState<string | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ["chat-files", chatId],
    queryFn: () => api.listChatFiles(chatId ?? ""),
    enabled: Boolean(chatId),
    refetchInterval: running ? 4000 : false,
  });

  const files = data?.files ?? [];
  const images = files.filter((f) => isImageMime(f.mime));
  const current = images.find((f) => f.id === openId) ?? null;

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const i = images.findIndex((f) => f.id === current.id);
      const next = images[(i + (e.key === "ArrowRight" ? 1 : -1) + images.length) % images.length];
      if (next) setOpenId(next.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, images]);

  return (
    <Panel title="Library">
      {!chatId ? (
        <p className={styles.muted}>Start a chat. Uploads and screenshots collect here.</p>
      ) : isPending ? (
        <div className={styles.grid}>
          <Skeleton height={88} />
          <Skeleton height={88} />
        </div>
      ) : files.length === 0 ? (
        <p className={styles.muted}>
          Nothing yet. Attach a file to a message, or let the agent take a screenshot.
        </p>
      ) : (
        <ul className={styles.grid}>
          {files.map((file) => (
            <li key={file.id}>
              <Tile file={file} onOpen={() => setOpenId(file.id)} />
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={current !== null}
        onClose={() => setOpenId(null)}
        title={current?.name ?? ""}
        description={current ? `${current.origin === "tool" ? "Agent screenshot" : "Upload"} · ${formatBytes(current.bytes)}` : undefined}
        footer={
          current && (
            <a className={styles.download} href={`/api/uploads/${current.id}`} download={current.name}>
              <DownloadSimple size={14} /> Download
            </a>
          )
        }
      >
        {current && (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.full} src={`/api/uploads/${current.id}`} alt={current.name} />
        )}
      </Modal>
    </Panel>
  );
}

function Tile({ file, onOpen }: { file: FileInfo; onOpen: () => void }) {
  // A thumbnail that fails to load (file pruned, route down) falls back to the
  // document tile so the grid never shows a broken-image icon.
  const [broken, setBroken] = useState(false);
  if (isImageMime(file.mime) && !broken) {
    return (
      <button type="button" className={styles.tile} onClick={onOpen} aria-label={`Open ${file.name}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/uploads/${file.id}`} alt=""
          loading="lazy"
          decoding="async"
          className={styles.thumb}
          onError={() => setBroken(true)}
        />
        <span className={styles.badge}>
          <ImageIcon size={11} /> {file.origin === "tool" ? "screen" : "upload"}
        </span>
      </button>
    );
  }
  return (
    <a className={styles.tile} href={`/api/uploads/${file.id}`} download={file.name}>
      <span className={styles.doc}>
        <FileText size={22} weight="duotone" />
        <span className={styles.docName}>{file.name}</span>
        <span className={styles.docMeta}>{formatBytes(file.bytes)}</span>
      </span>
    </a>
  );
}
