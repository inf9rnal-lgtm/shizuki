export type PrebuiltVoice = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr' | 'Echo' | 'Pirate' | 'Unicorn' | 'Santa' | 'Luna' | 'Aura' | 'Orion' | 'Nova' | 'Leo' | 'Lyra' | 'Orus' | 'Erinome' | 'Iapetus';
export const PREBUILT_VOICES: PrebuiltVoice[] = ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr', 'Echo', 'Pirate', 'Unicorn', 'Santa', 'Luna', 'Aura', 'Orion', 'Nova', 'Leo', 'Lyra', 'Orus', 'Erinome', 'Iapetus'];

export type Tone = 'Neutral' | 'Cheerful' | 'Sad' | 'Angry' | 'Excited';
export const TONES: Tone[] = ['Neutral', 'Cheerful', 'Sad', 'Angry', 'Excited'];

export interface Speaker {
  name: string;
  voice: PrebuiltVoice;
}

export interface ScriptSegment {
  id: number;
  speakerName: string;
  text: string;
  tone: Tone;
}