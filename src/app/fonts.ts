import { Space_Grotesk, Instrument_Sans, JetBrains_Mono } from "next/font/google";

/** Display / headings — docs/DESIGN_SYSTEM.md §Typography */
export const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

/** UI / body */
export const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-instrument-sans",
  display: "swap",
});

/** Data, readouts, code — always tabular-nums */
export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const fontVariables = [
  spaceGrotesk.variable,
  instrumentSans.variable,
  jetbrainsMono.variable,
].join(" ");
