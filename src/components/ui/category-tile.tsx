import {
  Brain,
  CalendarDots,
  ChatCenteredDots,
  CurrencyCircleDollar,
  FolderSimple,
  Globe,
  HandPalm,
  Monitor,
  Plugs,
  PlugsConnected,
  Robot,
  Sparkle,
  TerminalWindow,
  WarningOctagon,
  WindowsLogo,
  Wrench,
} from "@phosphor-icons/react/dist/ssr";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/cn";
import styles from "./category-tile.module.css";

/**
 * Meaning-coloured icon tiles (DESIGN_SYSTEM §Colour). The category set is the
 * tool taxonomy from chat/parts/tool-meta plus a few semantic roles; the hue
 * comes from `data-cat` → `--cat` (tokens.css), so every surface that shows a
 * category — trace cards, the rail log, the sidebar, the palette — agrees.
 */
export type TileCategory =
  | "screen"
  | "browser"
  | "shell"
  | "rdp"
  | "files"
  | "connector"
  | "mcp"
  | "memory"
  | "schedule"
  | "human"
  | "other"
  | "think"
  | "agent"
  | "money"
  | "error";

export const CATEGORY_ICONS: Record<TileCategory, Icon> = {
  screen: Monitor,
  browser: Globe,
  shell: TerminalWindow,
  rdp: WindowsLogo,
  files: FolderSimple,
  connector: Plugs,
  mcp: PlugsConnected,
  memory: Brain,
  schedule: CalendarDots,
  human: HandPalm,
  other: Wrench,
  think: Sparkle,
  agent: Robot,
  money: CurrencyCircleDollar,
  error: WarningOctagon,
};

export const THOUGHT_ICON = ChatCenteredDots;

export interface CategoryTileProps {
  cat: TileCategory;
  size?: "xs" | "sm" | "md" | "lg";
  /** Overrides the category's default glyph. */
  icon?: Icon;
  /** Animated sheen while the thing it labels is running. */
  active?: boolean;
  className?: string;
}

const PX = { xs: 11, sm: 13, md: 16, lg: 20 } as const;

export function CategoryTile({ cat, size = "md", icon, active, className }: CategoryTileProps) {
  const Glyph = icon ?? CATEGORY_ICONS[cat];
  return (
    <span
      className={cn(styles.tile, styles[size], active && styles.active, className)}
      data-cat={cat}
      aria-hidden
    >
      <Glyph size={PX[size]} weight="duotone" />
    </span>
  );
}
