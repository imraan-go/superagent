"use client";

import { useState } from "react";
import {
  ArrowClockwise,
  Gear,
  PaperPlaneRight,
  Trash,
} from "@phosphor-icons/react/dist/ssr";
import {
  Button,
  Dot,
  HoldToConfirm,
  IconButton,
  LiveGlyph,
  Modal,
  Panel,
  Readout,
  SegmentedSwitch,
  SettingRow,
  SettingSection,
  Skeleton,
  SkeletonText,
  ToastProvider,
  useToast,
} from "@/components/ui";
import type { ButtonVariant, DotStatus, LiveGlyphState } from "@/components/ui";
import styles from "./gallery.module.css";

const VARIANTS: ButtonVariant[] = [
  "primary",
  "secondary",
  "ghost",
  "outline",
  "danger",
  "attention",
];

const GLYPH_STATES: LiveGlyphState[] = [
  "idle",
  "thinking",
  "tool",
  "approval",
  "done",
  "error",
];

const DOT_STATES: DotStatus[] = ["ok", "live", "warn", "error", "idle", "pending"];

export function PrimitivesGallery() {
  return (
    <ToastProvider>
      <Gallery />
    </ToastProvider>
  );
}

function Gallery() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [mode, setMode] = useState<"agent" | "manage">("agent");
  const [modalOpen, setModalOpen] = useState(false);
  const [tokens, setTokens] = useState(12480);
  const toast = useToast();

  // Applied to the wrapper so both themes can be eyeballed without a reload.
  return (
    <div className={styles.page} data-theme={theme} data-mode={mode}>
      <header className={styles.topbar}>
        <h1 className={styles.brand}>Superagent — primitives</h1>
        <div className={styles.topbarControls}>
          <SegmentedSwitch
            label="Workspace mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "agent", label: "Agent" },
              { value: "manage", label: "Manage" },
            ]}
          />
          <SegmentedSwitch
            label="Theme"
            size="sm"
            value={theme}
            onChange={setTheme}
            options={[
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
          />
        </div>
      </header>

      <div className={styles.grid}>
        <Panel title="Button — variants × sizes">
          <div className={styles.stack}>
            {(["sm", "md", "lg"] as const).map((size) => (
              <div key={size} className={styles.row}>
                {VARIANTS.map((variant) => (
                  <Button key={variant} variant={variant} size={size}>
                    {variant}
                  </Button>
                ))}
              </div>
            ))}
            <div className={styles.row}>
              <Button variant="primary" loading>
                loading
              </Button>
              <Button variant="primary" disabled>
                disabled
              </Button>
              <Button variant="primary" iconLeft={<PaperPlaneRight size={15} />}>
                with icon
              </Button>
            </div>
            <Button variant="outline" block>
              block
            </Button>
          </div>
        </Panel>

        <Panel title="IconButton">
          <div className={styles.row}>
            {(["sm", "md", "lg"] as const).map((size) => (
              <IconButton key={size} size={size} label={`Settings ${size}`} icon={<Gear size={16} />} />
            ))}
            <IconButton label="Active" active icon={<Gear size={16} />} />
            <IconButton label="Pill" pill icon={<ArrowClockwise size={16} />} />
            <IconButton label="Danger" tone="danger" icon={<Trash size={16} />} />
            <IconButton label="Disabled" disabled icon={<Gear size={16} />} />
          </div>
        </Panel>

        <Panel title="LiveGlyph — all states">
          <div className={styles.row}>
            {GLYPH_STATES.map((state) => (
              <div key={state} className={styles.glyphCell}>
                <LiveGlyph state={state} size={28} />
                <span className={styles.caption}>{state}</span>
              </div>
            ))}
          </div>
          <div className={styles.row} style={{ marginTop: "var(--sp-4)" }}>
            <LiveGlyph state="thinking" size={20} />
            <LiveGlyph state="thinking" size={28} />
            <LiveGlyph state="thinking" size={96} />
          </div>
        </Panel>

        <Panel title="Readout — count-up on change">
          <div className={styles.row}>
            <Readout label="tokens in" value={tokens} />
            <Readout label="tokens out" value={3214} tone="signal" />
            <Readout label="cost today" value={0.4218} prefix="$" precision={4} tone="amber" />
            <Readout label="latency" value={428} unit="ms" size="sm" />
            <Readout label="streaming" value={940} estimate size="sm" />
            <Readout label="status" value="PAUSED" size="sm" tone="amber" />
          </div>
          <div className={styles.row} style={{ marginTop: "var(--sp-4)" }}>
            <Readout label="cpu" value={62.4} unit="%" size="lg" tone="ok" />
            <Button size="sm" onClick={() => setTokens((t) => t + 1820)}>
              add tokens
            </Button>
          </div>
        </Panel>

        <Panel title="Dot">
          <div className={styles.row}>
            {DOT_STATES.map((status) => (
              <div key={status} className={styles.glyphCell}>
                <Dot status={status} size="lg" label={status} />
                <span className={styles.caption}>{status}</span>
              </div>
            ))}
            <div className={styles.glyphCell}>
              <Dot status="live" size="lg" pulse label="live pulse" />
              <span className={styles.caption}>pulse</span>
            </div>
          </div>
        </Panel>

        <Panel title="HoldToConfirm" tone="attention" badge={<Dot status="warn" />}>
          <div className={styles.row}>
            <HoldToConfirm onConfirm={() => toast.push({ title: "Took control", tone: "warning" })}>
              Take control
            </HoldToConfirm>
            <HoldToConfirm
              tone="danger"
              size="sm"
              icon={<Trash size={14} />}
              onConfirm={() => toast.push({ title: "Deleted", tone: "error" })}
            >
              Delete
            </HoldToConfirm>
            <HoldToConfirm onConfirm={() => undefined} disabled>
              Disabled
            </HoldToConfirm>
          </div>
        </Panel>

        <Panel title="Panel tones" bodyFlush>
          <div className={styles.stack} style={{ padding: "var(--sp-4)" }}>
            <Panel title="live" tone="live" badge={<LiveGlyph state="thinking" size={16} />}>
              A panel owned by an active run.
            </Panel>
            <Panel title="attention" tone="attention" badge={<Dot status="warn" />}>
              Awaiting the owner.
            </Panel>
            <Panel title="critical" tone="critical" badge={<Dot status="error" />}>
              Something failed.
            </Panel>
            <Panel title="quiet" quiet>
              No surface, just grouping.
            </Panel>
          </div>
        </Panel>

        <Panel title="Skeleton">
          <div className={styles.stack}>
            <div className={styles.row}>
              <Skeleton shape="circle" width={34} height={34} />
              <Skeleton width={140} height={34} />
              <Skeleton shape="panel" width={120} height={60} />
            </div>
            <SkeletonText lines={4} />
          </div>
        </Panel>

        <Panel title="Modal + Toast">
          <div className={styles.row}>
            <Button variant="primary" onClick={() => setModalOpen(true)}>
              Open modal
            </Button>
            <Button onClick={() => toast.push({ title: "Run finished", message: "4 steps, $0.0182", tone: "success" })}>
              success
            </Button>
            <Button onClick={() => toast.push({ title: "Approval needed", message: "Post to LinkedIn", tone: "warning" })}>
              warning
            </Button>
            <Button
              onClick={() =>
                toast.push({
                  title: "Computer waking up",
                  message: "The desktop is restoring — retrying in 30 s.",
                  tone: "error",
                  action: { label: "Retry now", onClick: () => undefined },
                })
              }
            >
              error + action
            </Button>
          </div>
        </Panel>

        <Panel title="SettingRow">
          <SettingSection>
            <SettingRow label="Theme" description="Dark ink, paper, or follow the system.">
              <SegmentedSwitch
                label="Theme demo"
                size="sm"
                value={theme}
                onChange={setTheme}
                options={[
                  { value: "dark", label: "Dark" },
                  { value: "light", label: "Light" },
                ]}
              />
            </SettingRow>
            <SettingRow label="Check spelling" description="Placeholder control for the row layout.">
              <span style={{ color: "var(--text-3)", fontSize: "var(--fs-micro)" }}>Soon</span>
            </SettingRow>
          </SettingSection>
        </Panel>
      </div>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Confirm action"
        description="Esc, the backdrop and × all close this."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setModalOpen(false)}>
              Confirm
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, color: "var(--text-2)" }}>
          Native <code>&lt;dialog&gt;</code> gives focus trapping and an inert
          background without a portal.
        </p>
      </Modal>
    </div>
  );
}
