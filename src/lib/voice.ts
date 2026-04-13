/**
 * Voice interaction state machine for Noted.
 *
 * States:
 *   idle       → default, mic button shows mic icon
 *   listening  → actively capturing speech, pulsing indicator
 *   processing → speech ended, waiting for AI response
 *   responding → AI response received, briefly shows checkmark
 *
 * Transitions:
 *   idle → listening       (user presses mic button)
 *   listening → processing (speech ends / user presses mic again)
 *   processing → responding (AI returns a response)
 *   responding → idle      (after 1.5s timeout)
 *   any → idle             (cancel / error)
 *
 * Future: idle → listening via wake word ("Hey Noted")
 */

export type VoiceState = "idle" | "listening" | "processing" | "responding";

export interface VoiceConfig {
  enabled: boolean;        // master toggle
  wakeWordEnabled: boolean; // future — always false for now
  autoSend: boolean;       // auto-send after speech ends (vs populate input)
  lang: string;            // recognition language
}

export const DEFAULT_VOICE_CONFIG: VoiceConfig = {
  enabled: true,
  wakeWordEnabled: false,
  autoSend: true,
  lang: "en-US",
};

/**
 * Check if the Web Speech API is available in the current browser.
 */
export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === "undefined") return false;
  return !!(
    (window as unknown as Record<string, unknown>).SpeechRecognition ||
    (window as unknown as Record<string, unknown>).webkitSpeechRecognition
  );
}
