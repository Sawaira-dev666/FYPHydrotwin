// Speech uses the browser's built-in text-to-speech (English). Nothing is sent anywhere.

export const voiceSupported = () => typeof window !== "undefined" && "speechSynthesis" in window;

if (voiceSupported()) {
  window.speechSynthesis.getVoices(); // starts loading the voice list
}

export function stopSpeaking() {
  if (voiceSupported()) window.speechSynthesis.cancel();
}

function pickVoice() {
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang.toLowerCase() === "en-gb") ||
    voices.find((v) => v.lang.toLowerCase().startsWith("en")) ||
    null
  );
}

// returns { ok: true } or { ok: false, reason }
export function speak(text) {
  if (!voiceSupported()) return { ok: false, reason: "unsupported" };
  const synth = window.speechSynthesis;
  synth.cancel();
  const voice = pickVoice();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voice?.lang || "en-GB";
  if (voice) u.voice = voice;
  u.rate = 0.95;
  synth.speak(u);
  return { ok: true };
}
